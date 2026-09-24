#!/usr/bin/env node
/**
 * The encrypted tunnel: a WebSocket in, a TCP connection to a provider's port
 * 443 out, bytes copied both ways. The page runs TLS itself (lm15-ts
 * `tunnelRelay`, rustls compiled to WebAssembly) and checks the provider's
 * certificate, so what crosses this process is ciphertext: it cannot read
 * tokens, prompts or replies, and it cannot impersonate the provider.
 *
 * What it still sees, stated: the page's origin and IP, which provider host
 * (the `host` query and TLS SNI), when, and how many bytes. What it cannot
 * enforce: paths. A tunnel allows a host, not an endpoint; the host list is
 * therefore the whole policy, and it is kept to the hosts lm15's login and
 * model routes need.
 *
 *   node relay/tunnel-local.mjs [--port 8789] [--allow-origin https://page.origin]
 *
 * Egress policy (lm15-contract spec/auth-managed-reserved.md AUTH-20): port
 * 443 only; hosts from the list only; the name is resolved here and the
 * connection goes to that address, refused if it is loopback, private,
 * link-local, CGNAT, multicast or otherwise not public (no DNS rebinding into
 * this machine's network). No log line is written about traffic.
 *
 * Minimal RFC 6455 server, no dependencies: binary frames only, masked from
 * the client as required, ping/pong/close handled, 1 MiB frame limit.
 */

import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP, connect } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Hosts, not paths: see the header. Derived from the forwarding relay's list so the two stay one policy.
const toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
const upstreams = /ALLOWED_UPSTREAMS = "([^"]+)"/.exec(toml)[1].split(",").map((e) => e.split("/")[0].trim().toLowerCase());
export const TUNNEL_HOSTS = new Set([...upstreams, "auth.openai.com", "api.x.ai", "api.individual.githubcopilot.com", "openrouter.ai", "auth.kimi.com"]);
TUNNEL_HOSTS.delete("api.typesafe.ai"); // not a login route; its relay row stays path-scoped

const defaultOrigins = /ALLOWED_ORIGINS = "([^"]+)"/.exec(toml)[1].split(",").map((s) => s.trim());
const args = process.argv;
const port = args.includes("--port") ? Number(args[args.indexOf("--port") + 1]) : 8789;
const origins = new Set([...defaultOrigins, ...args.flatMap((a, i) => (a === "--allow-origin" && args[i + 1] ? [new URL(args[i + 1]).origin] : []))]);

const MAX_TUNNELS = 64;
const IDLE_MS = 120_000;
const MAX_MS = 30 * 60_000;
const MAX_FRAME = 1024 * 1024;
let open = 0;

export function publicAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT / Tailscale
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff")) return false;
    if (v.startsWith("::ffff:")) return publicAddress(v.slice(7));
    return true;
  }
  return false;
}

function refuse(socket, status, text) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\ncontent-type: text/plain\r\ncontent-length: ${text.length}\r\nconnection: close\r\n\r\n${text}`);
}

function frame(opcode, payload) {
  const len = payload.length;
  const head = len < 126 ? Buffer.from([0x80 | opcode, len]) : len < 65536 ? Buffer.from([0x80 | opcode, 126, len >> 8, len & 255]) : (() => {
    const h = Buffer.alloc(10);
    h[0] = 0x80 | opcode;
    h[1] = 127;
    h.writeBigUInt64BE(BigInt(len), 2);
    return h;
  })();
  return Buffer.concat([head, payload]);
}

const server = createServer((req, res) => {
  res.writeHead(426, { "content-type": "text/plain" }).end("WebSocket only");
});

server.on("upgrade", async (req, socket) => {
  const origin = req.headers.origin;
  if (!origin || !origins.has(origin)) return refuse(socket, 403, "origin not allowed");
  const url = new URL(req.url, "http://tunnel.local");
  const host = (url.searchParams.get("host") ?? "").toLowerCase();
  if (url.pathname !== "/tunnel" || !TUNNEL_HOSTS.has(host)) return refuse(socket, 403, "host not allowed");
  if (req.headers.upgrade?.toLowerCase() !== "websocket" || !req.headers["sec-websocket-key"]) return refuse(socket, 400, "not a websocket");
  if (open >= MAX_TUNNELS) return refuse(socket, 503, "busy");
  let address;
  try {
    const found = await lookup(host, { all: true });
    address = found.find((a) => publicAddress(a.address))?.address;
    if (!address || found.some((a) => !publicAddress(a.address))) return refuse(socket, 403, "address not public");
  } catch {
    return refuse(socket, 502, "cannot resolve");
  }

  const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nconnection: Upgrade\r\nsec-websocket-accept: ${accept}\r\n\r\n`);
  open++;
  const upstream = connect({ host: address, port: 443 });
  upstream.setNoDelay(true);
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    open--;
    clearTimeout(idle);
    clearTimeout(lifetime);
    upstream.destroy();
    if (!socket.destroyed) socket.end(frame(0x8, Buffer.alloc(0)));
  };
  let idle = setTimeout(finish, IDLE_MS);
  const lifetime = setTimeout(finish, MAX_MS);
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(finish, IDLE_MS);
  };

  const pending = [];
  let connected = false;
  upstream.on("connect", () => {
    connected = true;
    for (const chunk of pending.splice(0)) upstream.write(chunk);
  });
  upstream.on("data", (chunk) => {
    touch();
    socket.write(frame(0x2, chunk));
  });
  upstream.on("close", finish);
  upstream.on("error", finish);

  let buffer = Buffer.alloc(0);
  let fragments = [];
  socket.on("data", (chunk) => {
    touch();
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) return;
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let len = buffer[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_FRAME)) return finish();
        len = Number(big);
        offset = 10;
      }
      if (!masked || len > MAX_FRAME) return finish(); // RFC 6455: client frames are masked
      if (buffer.length < offset + 4 + len) return;
      const mask = buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buffer = buffer.subarray(offset + 4 + len);
      if (opcode === 0x8) return finish();
      if (opcode === 0x9) { socket.write(frame(0xa, payload)); continue; }
      if (opcode === 0xa) continue;
      if (opcode === 0x1) return finish(); // text frames are not tunnel data
      if (opcode === 0x2 || opcode === 0x0) {
        fragments.push(payload);
        if (!fin) continue;
        const data = Buffer.concat(fragments);
        fragments = [];
        if (connected) upstream.write(data); else pending.push(data);
      }
    }
  });
  socket.on("close", finish);
  socket.on("error", finish);
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port, "127.0.0.1", () => {
    console.log(`lm15 tunnel (local) on ws://127.0.0.1:${port}/tunnel; pages at ${[...origins].join(", ")}; hosts: ${[...TUNNEL_HOSTS].sort().join(", ")}`);
  });
}

export { server };

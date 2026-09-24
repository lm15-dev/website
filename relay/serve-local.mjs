#!/usr/bin/env node
/**
 * Run the relay Worker (worker.js) on this machine, for trying relay changes
 * before they are deployed. Same code, same allow-lists (read from
 * wrangler.toml), served over plain HTTP on loopback.
 *
 *   node relay/serve-local.mjs [--port 8787] [--allow-origin https://host.tailnet.ts.net:10443]
 *
 * `--allow-origin` (repeatable) adds a page origin to wrangler.toml's list for
 * this local run only, e.g. a playground published over Tailscale Serve.
 *
 * Then, in a playground served on localhost, point the page at it once:
 *   localStorage["lm15.playground.relay-url"] = "http://127.0.0.1:8787"
 * (relay.ts honors that override only on loopback pages.)
 *
 * Differences from the deployed relay, stated: requests leave from this
 * machine's address, not Cloudflare's, so a provider that treats Cloudflare
 * Workers differently (bot checks) can answer differently here. Nothing is
 * logged, as in the Worker: this script prints only its own address.
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { handle } from "./worker.js";

const toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
const vars = Object.fromEntries([...toml.matchAll(/^([A-Z_]+) = "([^"]*)"$/gm)].map((m) => [m[1], m[2]]));
const portIndex = process.argv.indexOf("--port");
const port = portIndex > 0 ? Number(process.argv[portIndex + 1]) : 8787;
const extraOrigins = process.argv.flatMap((arg, i) => (arg === "--allow-origin" && process.argv[i + 1] ? [new URL(process.argv[i + 1]).origin] : []));
if (extraOrigins.length) vars.ALLOWED_ORIGINS = [vars.ALLOWED_ORIGINS, ...extraOrigins].filter(Boolean).join(",");

const server = createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) for (const v of value) headers.append(name, v);
      else if (value !== undefined) headers.set(name, value);
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      headers,
      ...(hasBody ? { body: Readable.toWeb(req), duplex: "half" } : {}),
    });
    const response = await handle(request, vars);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) {
      for await (const chunk of response.body) res.write(chunk);
    }
    res.end();
  } catch {
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end('{"error":{"code":"local_relay","message":"the local relay failed"}}');
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`lm15 relay (local) on http://127.0.0.1:${port}${extraOrigins.length ? `; also serving pages at ${extraOrigins.join(", ")}` : ""}`);
});

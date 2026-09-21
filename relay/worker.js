/**
 * The lm15 playground relay: a Cloudflare Worker that forwards a browser's
 * request to one of a few provider APIs that refuse browser origins, and
 * adds the CORS headers those APIs withhold. Nothing else.
 *
 * Shape: `https://<relay>/<upstream-host>/<path>?<query>` forwards to
 * `https://<upstream-host>/<path>?<query>` with the same method, body and
 * headers (minus the browser-only ones), and streams the reply back with
 * `Access-Control-Allow-Origin` set to the caller's origin.
 *
 * What it refuses, by name: an origin outside the allow-list (403 `origin`),
 * an upstream outside the allow-list (403 `upstream`, never an open proxy),
 * a request without an origin (403), a URL with credentials (400). It keeps
 * no log and no state: `console` is never called, no storage binding is
 * bound, and the key travels only as the `Authorization` header the page
 * sent. Cloudflare's own edge logging is off for this Worker (wrangler.toml
 * `observability.logs.enabled = false`).
 *
 * The page decides when to use it (playground/relay.ts): only after the
 * user enabled the relay for that provider, and only for providers whose
 * direct call the browser refused.
 */

const DEFAULT_UPSTREAMS = "api.typesafe.ai";
const DEFAULT_ORIGINS = "https://lm15.dev,https://www.lm15.dev";

/** Headers the relay never forwards: browser-only, hop-by-hop, or Cloudflare's own. */
const DROP_REQUEST = new Set([
  "host", "origin", "referer", "cookie", "connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade",
  "proxy-authorization", "proxy-connection", "content-length", "accept-encoding",
  "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor", "cf-worker", "x-forwarded-for", "x-forwarded-proto", "x-real-ip", "true-client-ip",
]);
const DROP_RESPONSE = new Set([
  "connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length", "set-cookie", "strict-transport-security",
  "access-control-allow-origin", "access-control-allow-credentials", "access-control-allow-headers", "access-control-allow-methods", "access-control-expose-headers", "access-control-max-age",
]);

function list(value, fallback) {
  return new Set((value ?? fallback).split(",").map((s) => s.trim()).filter(Boolean));
}

/**
 * Loopback origins on any port are local development, and so is a Tailscale
 * address (100.64.0.0/10: a page served on someone's own WireGuard mesh, as
 * the playground is when opened from another machine); everything else must
 * be listed. The relay still only reaches the listed upstreams, with the
 * caller's own key, so a private page gains nothing it could not do itself.
 */
export function originAllowed(origin, allowed) {
  if (!origin) return false;
  if (allowed.has(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:") return false;
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") return true;
    const tailscale = /^100\.(\d+)\.\d+\.\d+$/.exec(url.hostname);
    return tailscale !== null && Number(tailscale[1]) >= 64 && Number(tailscale[1]) <= 127;
  } catch {
    return false;
  }
}

function refuse(status, code, detail) {
  return new Response(JSON.stringify({ error: { code, message: detail } }), { status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-lm15-relay": code } });
}

function corsHeaders(origin) {
  return { "access-control-allow-origin": origin, "vary": "Origin", "x-lm15-relay": "1" };
}

/** `/<host>/<path>` → the upstream URL, or undefined when the path names no host. */
export function upstreamUrl(requestUrl) {
  const url = new URL(requestUrl);
  const [, host, ...rest] = url.pathname.split("/");
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) return undefined;
  return new URL(`https://${host}/${rest.join("/")}${url.search}`);
}

export async function handle(request, env = {}, upstreamFetch = fetch) {
  const origins = list(env.ALLOWED_ORIGINS, DEFAULT_ORIGINS);
  const upstreams = list(env.ALLOWED_UPSTREAMS, DEFAULT_UPSTREAMS);
  const origin = request.headers.get("origin");
  if (!originAllowed(origin, origins)) return refuse(403, "origin", "this relay serves the lm15 playground only");
  const target = upstreamUrl(request.url);
  if (!target) return refuse(404, "path", "use /<upstream-host>/<path>");
  if (!upstreams.has(target.hostname)) return refuse(403, "upstream", `${target.hostname} is not a provider this relay forwards to`);
  if (target.username || target.password) return refuse(400, "url", "no credentials in the URL");

  if (request.method === "OPTIONS") {
    const asked = request.headers.get("access-control-request-headers");
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(origin),
        "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
        "access-control-allow-headers": asked || "authorization, content-type",
        "access-control-max-age": "86400",
      },
    });
  }

  const headers = new Headers();
  for (const [name, value] of request.headers) if (!DROP_REQUEST.has(name.toLowerCase())) headers.set(name, value);
  headers.set("accept-encoding", "identity"); // the page's SDK asks for identity too: streams must not be buffered by a codec
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream;
  try {
    upstream = await upstreamFetch(target.toString(), { method: request.method, headers, body: hasBody ? request.body : undefined, redirect: "manual", ...(hasBody ? { duplex: "half" } : {}) });
  } catch (e) {
    return refuse(502, "upstream_unreachable", `${target.hostname}: ${e instanceof Error ? e.message : String(e)}`);
  }
  const out = new Headers();
  for (const [name, value] of upstream.headers) if (!DROP_RESPONSE.has(name.toLowerCase())) out.set(name, value);
  for (const [name, value] of Object.entries(corsHeaders(origin))) out.set(name, value);
  out.set("access-control-expose-headers", "*");
  out.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}

export default { fetch: (request, env) => handle(request, env) };

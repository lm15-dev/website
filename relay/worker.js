/**
 * The lm15 playground relay: a Cloudflare Worker that forwards a browser's
 * request to one of a few provider endpoints that refuse browser origins, and
 * adds the CORS headers those endpoints withhold. Nothing else.
 *
 * Upstreams are listed as a host, or a host and a path prefix
 * (`github.com/login/device/code`, `chatgpt.com/backend-api/codex/`): a
 * sign-in endpoint on a large site must not open the whole site. Which
 * endpoints a page cannot reach directly is lm15-contract
 * auth/managed/browser.json; the page asks the person before using the relay,
 * per stage (sign-in, model list, model calls), and says what crosses it.
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

/** A page cannot set User-Agent. It may name one here; the relay sends it upstream as User-Agent and drops the page's own. */
export const USER_AGENT_HEADER = "x-lm15-user-agent";
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
 * `host` allows every path on that host; `host/prefix` allows the path equal to
 * the prefix, or under it when the prefix ends with `/`. Dot segments are
 * already resolved by URL parsing, so `/login/device/code/../../x` cannot escape.
 */
export function upstreamAllowed(target, allowed) {
  for (const entry of allowed) {
    const slash = entry.indexOf("/");
    const host = slash < 0 ? entry : entry.slice(0, slash);
    if (host.toLowerCase() !== target.hostname.toLowerCase()) continue;
    if (slash < 0) return true;
    const prefix = entry.slice(slash);
    if (prefix.endsWith("/") ? target.pathname.startsWith(prefix) : target.pathname === prefix) return true;
  }
  return false;
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

/**
 * A refusal an allowed page can read: without CORS headers the browser shows
 * the page only "fetch failed", hiding which rule refused it. An origin that
 * is not allowed gets no CORS headers (it is not served at all).
 */
function refuse(status, code, detail, origin) {
  return new Response(JSON.stringify({ error: { code, message: detail } }), {
    status,
    headers: {
      "content-type": "application/json", "cache-control": "no-store", "x-lm15-relay": code,
      ...(origin ? { "access-control-allow-origin": origin, "access-control-expose-headers": "x-lm15-relay", vary: "Origin" } : {}),
    },
  });
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
  if (!target) return refuse(404, "path", "use /<upstream-host>/<path>", origin);
  if (!upstreamAllowed(target, upstreams)) return refuse(403, "upstream", `${target.hostname}${target.pathname} is not an endpoint this relay forwards to`, origin);
  if (target.username || target.password) return refuse(400, "url", "no credentials in the URL", origin);

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
  const userAgent = headers.get(USER_AGENT_HEADER);
  if (userAgent !== null) {
    headers.delete(USER_AGENT_HEADER);
    headers.set("user-agent", userAgent);
  }
  headers.set("accept-encoding", "identity"); // the page's SDK asks for identity too: streams must not be buffered by a codec
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream;
  try {
    upstream = await upstreamFetch(target.toString(), { method: request.method, headers, body: hasBody ? request.body : undefined, redirect: "manual", ...(hasBody ? { duplex: "half" } : {}) });
  } catch (e) {
    return refuse(502, "upstream_unreachable", `${target.hostname}: ${e instanceof Error ? e.message : String(e)}`, origin);
  }
  const out = new Headers();
  for (const [name, value] of upstream.headers) if (!DROP_RESPONSE.has(name.toLowerCase())) out.set(name, value);
  for (const [name, value] of Object.entries(corsHeaders(origin))) out.set(name, value);
  out.set("access-control-expose-headers", "*");
  // no-transform: Cloudflare's edge would otherwise compress the body (zstd, br) for the browser, and the
  // page's SDK refuses a Content-Encoding it did not ask for (it asks for identity, so streams are never buffered).
  out.set("cache-control", "no-store, no-transform");
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}

export default { fetch: (request, env) => handle(request, env) };

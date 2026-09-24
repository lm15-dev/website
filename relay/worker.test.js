import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, originAllowed, upstreamUrl } from "./worker.js";

const env = { ALLOWED_UPSTREAMS: "api.typesafe.ai", ALLOWED_ORIGINS: "https://lm15.dev" };
const req = (path, { headers, ...init } = {}) => new Request(`https://relay.example${path}`, { ...init, headers: { origin: "https://lm15.dev", ...(headers ?? {}) } });

test("origins: the listed site and loopback on any port; nothing else, and never an absent origin", () => {
  const allowed = new Set(["https://lm15.dev"]);
  assert.equal(originAllowed("https://lm15.dev", allowed), true);
  assert.equal(originAllowed("http://localhost:4321", allowed), true);
  assert.equal(originAllowed("http://127.0.0.1:8080", allowed), true);
  assert.equal(originAllowed("http://100.86.49.54:4173", allowed), true, "a Tailscale address is the person's own machine");
  assert.equal(originAllowed("http://100.127.255.1", allowed), true);
  assert.equal(originAllowed("http://100.128.0.1:4173", allowed), false, "just outside 100.64.0.0/10");
  assert.equal(originAllowed("http://100.63.0.1", allowed), false);
  assert.equal(originAllowed("https://100.86.49.54", allowed), false, "https there is not the playground's own server");
  assert.equal(originAllowed("http://10.0.0.5:4173", allowed), false, "an ordinary LAN address is not listed");
  assert.equal(originAllowed("https://evil.example", allowed), false);
  assert.equal(originAllowed("http://lm15.dev.evil.example", allowed), false);
  assert.equal(originAllowed(null, allowed), false);
});

test("the path names the upstream host; the rest, the query included, goes verbatim", () => {
  assert.equal(upstreamUrl("https://relay.example/api.typesafe.ai/v1/systemone?x=1").toString(), "https://api.typesafe.ai/v1/systemone?x=1");
  assert.equal(upstreamUrl("https://relay.example/"), undefined);
  assert.equal(upstreamUrl("https://relay.example/not a host/x"), undefined);
});

test("refusals are by name: origin, upstream, path", async () => {
  const bad = await handle(new Request("https://relay.example/api.typesafe.ai/v1/models", { headers: { origin: "https://evil.example" } }), env);
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get("x-lm15-relay"), "origin");
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
  const open = await handle(req("/api.openai.com/v1/models"), env);
  assert.equal(open.status, 403);
  assert.equal((await open.json()).error.code, "upstream");
  assert.equal((await handle(req("/"), env)).status, 404);
});

test("preflight answers the asked headers for an allowed origin and upstream", async () => {
  const res = await handle(req("/api.typesafe.ai/v1/systemone", { method: "OPTIONS", headers: { "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } }), env);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://lm15.dev");
  assert.equal(res.headers.get("access-control-allow-headers"), "authorization,content-type");
  assert.match(res.headers.get("access-control-allow-methods"), /POST/);
});

test("a request is forwarded with its method, body and authorization, minus browser-only headers; the reply streams back with CORS headers and no caching", async () => {
  let seen;
  const upstream = async (url, init) => {
    seen = { url, init, headers: Object.fromEntries(init.headers), body: await new Response(init.body).text() };
    return new Response('{"answers":{}}', { status: 200, headers: { "content-type": "application/json", "x-typesafe-request-id": "r-1", "access-control-allow-origin": "https://console.typesafe.ai", "set-cookie": "a=b" } });
  };
  const res = await handle(req("/api.typesafe.ai/v1/systemone?trace=1", {
    method: "POST",
    body: '{"model":"jev-latest"}',
    headers: { authorization: "Bearer sk-user", "content-type": "application/json", cookie: "session=x", referer: "https://lm15.dev/playground/", "cf-connecting-ip": "1.2.3.4" },
  }), env, upstream);
  assert.equal(seen.url, "https://api.typesafe.ai/v1/systemone?trace=1");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.body, '{"model":"jev-latest"}');
  assert.equal(seen.headers.authorization, "Bearer sk-user");
  assert.equal(seen.headers["content-type"], "application/json");
  assert.equal(seen.headers.origin, undefined);
  assert.equal(seen.headers.cookie, undefined);
  assert.equal(seen.headers.referer, undefined);
  assert.equal(seen.headers["cf-connecting-ip"], undefined);
  assert.equal(seen.headers["accept-encoding"], "identity");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '{"answers":{}}');
  assert.equal(res.headers.get("access-control-allow-origin"), "https://lm15.dev");
  assert.equal(res.headers.get("access-control-expose-headers"), "*");
  assert.equal(res.headers.get("x-typesafe-request-id"), "r-1");
  assert.equal(res.headers.get("set-cookie"), null);
  assert.equal(res.headers.get("cache-control"), "no-store, no-transform", "no-transform keeps the edge from compressing a body the SDK asked for as identity");
  assert.equal(res.headers.get("vary"), "Origin");
});

test("an unreachable upstream is a 502 with the host named; an upstream error status passes through untouched", async () => {
  const down = await handle(req("/api.typesafe.ai/v1/models"), env, async () => { throw new Error("connect timeout"); });
  assert.equal(down.status, 502);
  assert.match((await down.json()).error.message, /api.typesafe.ai: connect timeout/);
  const denied = await handle(req("/api.typesafe.ai/v1/models"), env, async () => new Response('{"detail":{"error_type":"authentication_error"}}', { status: 401 }));
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("access-control-allow-origin"), "https://lm15.dev");
});

test("an upstream may be a host and a path: the endpoint, never the rest of the site", async () => {
  const { upstreamAllowed } = await import("./worker.js");
  const allowed = new Set(["github.com/login/device/code", "chatgpt.com/backend-api/codex/", "api.typesafe.ai"]);
  const at = (u) => upstreamAllowed(new URL(u), allowed);
  assert.equal(at("https://github.com/login/device/code"), true);
  assert.equal(at("https://github.com/login/device/codex"), false);
  assert.equal(at("https://github.com/login/device/code/more"), false);
  assert.equal(at("https://github.com/settings/tokens"), false);
  assert.equal(at("https://github.com/login/device/code/../../../settings"), false, "dot segments are resolved before the check");
  assert.equal(at("https://chatgpt.com/backend-api/codex/responses"), true);
  assert.equal(at("https://chatgpt.com/backend-api/conversation"), false);
  assert.equal(at("https://api.typesafe.ai/anything"), true);
  const refused = await handle(req("/github.com/settings/tokens"), { ALLOWED_UPSTREAMS: "github.com/login/device/code" });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error.code, "upstream");
});

test("a page's x-lm15-user-agent becomes the upstream User-Agent; the page's own is not sent", async () => {
  let seen;
  const upstream = async (url, init) => {
    seen = Object.fromEntries(init.headers);
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  await handle(req("/auth.x.ai/oauth2/token", { method: "POST", body: "a=1", headers: { "user-agent": "Mozilla/5.0", "x-lm15-user-agent": "lm15/1.0.0", "content-type": "application/x-www-form-urlencoded" } }), { ALLOWED_UPSTREAMS: "auth.x.ai/oauth2/token", ALLOWED_ORIGINS: "https://lm15.dev" }, upstream);
  assert.equal(seen["user-agent"], "lm15/1.0.0");
  assert.equal(seen["x-lm15-user-agent"], undefined);
});

test("the deployed allow-list names every relay endpoint the SDK's login profiles route through", async () => {
  const { readFileSync } = await import("node:fs");
  const toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
  const listed = new Set(/ALLOWED_UPSTREAMS = "([^"]+)"/.exec(toml)[1].split(","));
  const { upstreamAllowed } = await import("./worker.js");
  for (const url of [
    "https://auth.x.ai/oauth2/device/code", "https://auth.x.ai/oauth2/token", "https://platform.claude.com/v1/oauth/token",
    "https://github.com/login/device/code", "https://github.com/login/oauth/access_token", "https://api.github.com/copilot_internal/v2/token",
    "https://auth.meta.com/oidc/device/authorization/", "https://auth.meta.com/oidc/device/token/", "https://api.meta.ai/muse-code/key",
    "https://chatgpt.com/backend-api/codex/responses", "https://chatgpt.com/backend-api/codex/models", "https://api.kimi.com/coding/v1/messages",
  ]) assert.equal(upstreamAllowed(new URL(url), listed), true, url);
});

test("an allowed page can read why the relay refused (endpoint, path, unreachable); an unknown origin still gets no CORS", async () => {
  const upstream = await handle(req("/github.com/settings"), { ALLOWED_UPSTREAMS: "github.com/login/device/code", ALLOWED_ORIGINS: "https://lm15.dev" });
  assert.equal(upstream.status, 403);
  assert.equal(upstream.headers.get("access-control-allow-origin"), "https://lm15.dev");
  const down = await handle(req("/api.typesafe.ai/v1/models"), env, async () => { throw new Error("connect refused"); });
  assert.equal(down.status, 502);
  assert.equal(down.headers.get("access-control-allow-origin"), "https://lm15.dev");
  const stranger = await handle(new Request("https://relay.example/api.typesafe.ai/v1/models", { headers: { origin: "https://evil.example" } }), env);
  assert.equal(stranger.headers.get("access-control-allow-origin"), null);
});

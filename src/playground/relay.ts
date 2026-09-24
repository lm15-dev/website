/**
 * The relay: the one exception to "a key never leaves this page except to
 * its provider". Some provider APIs refuse browser origins outright (TypeSafe
 * answers `Disallowed CORS origin` to lm15.dev); for those, and only after
 * the user enabled it for that provider on this device, the page sends the
 * request through `relay/worker.js` — a Cloudflare Worker we run that adds
 * the missing CORS headers and keeps no log. The page never guesses: it
 * tries the provider directly first, and offers the relay when the browser
 * refused the call in the way a CORS block looks (a network error with no
 * status). What passes through is stated in the prompt, in words.
 *
 * The permission is per provider and lives in this browser's local storage;
 * the More menu lists and revokes it. The SDK needs nothing new: a relayed
 * provider is the same adapter with `baseUrl` pointing at the relay.
 */

import { adapterFor } from "lm15/browser";

/** The deployed Worker (relay/README.md). Empty until deployed: the page then explains instead of offering. */
export const RELAY_URL = "https://lm15-relay.mrive052.workers.dev";

/**
 * A page served from this person's own machines: loopback, or their Tailscale
 * network (a MagicDNS name under .ts.net, or an address in 100.64.0.0/10),
 * the same private hosts the relay and the demo server already trust.
 */
export function privatePageHost(hostname: string): boolean {
  if (["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return true;
  if (/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/i.test(hostname)) return true;
  const m = /^100\.(\d+)\.\d+\.\d+$/.exec(hostname);
  return m !== null && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

/**
 * Where the relay is. On a private host (the local playground, the browser
 * tests, a playground opened from another of this person's machines over
 * Tailscale) `localStorage["lm15.playground.relay-url"]` may point at another
 * relay, so a developer can try their own; on the public site the constant is
 * the only source — a stored override of where keys go would be one more
 * thing a page script could change.
 */
export function relayUrl(): string {
  try {
    if (privatePageHost(location.hostname)) return localStorage.getItem("lm15.playground.relay-url") ?? RELAY_URL;
  } catch {
    // no window (tests), no storage
  }
  return RELAY_URL;
}

/** Providers whose API refuses browser origins, with the date it was checked. The prompt names the provider; the list only shapes the wording. */
export const BROWSER_BLOCKED: Readonly<Record<string, string>> = Object.freeze({ typesafe: "2026-09-18" });

const STORAGE_KEY = "lm15.playground.relay";

function read(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function write(set: Set<string>): void {
  try {
    if (set.size === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify([...set].sort()));
  } catch {
    // Storage unavailable (private mode, disabled): the permission lasts this page load only.
  }
}

const session = new Set<string>();

export function relayAvailable(): boolean {
  return relayUrl() !== "";
}

export function relayed(provider: string): boolean {
  return relayAvailable() && (session.has(provider) || read().has(provider));
}

export function relayedProviders(): string[] {
  return [...new Set([...session, ...read()])].sort();
}

export function enableRelay(provider: string, remember: boolean): void {
  session.add(provider);
  if (remember) write(new Set([...read(), provider]));
}

export function disableRelay(provider: string): void {
  session.delete(provider);
  const stored = read();
  stored.delete(provider);
  write(stored);
}

export function disableAllRelays(): void {
  session.clear();
  write(new Set());
}

/** The provider's own API root, as the SDK would call it directly. */
export function directBaseUrl(provider: string): string {
  return adapterFor(provider, { apiKey: "unused" }).baseUrl;
}

/** `https://<relay>/<provider-host>[/<root-path>]`: the same paths the SDK appends, under the relay. */
export function relayBaseUrl(provider: string, relay = relayUrl()): string {
  const direct = new URL(directBaseUrl(provider));
  return `${relay.replace(/\/$/, "")}/${direct.host}${direct.pathname.replace(/\/$/, "")}`;
}

/**
 * What a CORS refusal looks like from inside a page: the browser reports a
 * network failure with no status and no body (the reply existed; the page
 * was not allowed to read it). Any real network fault looks the same — the
 * prompt says so, and the user decides.
 */
export function looksBrowserBlocked(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.name}: ${error.message}`;
  if (/status|HTTP \d{3}/i.test(text)) return false;
  // The SDK's FetchTransport says "<METHOD> <url>: request failed" and keeps the browser's TypeError as the cause.
  const cause = (error as { cause?: unknown }).cause;
  const causeText = cause instanceof Error ? `${cause.name}: ${cause.message}` : "";
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|: request failed$/i.test(text) || /^TypeError: (failed to fetch|networkerror|load failed)/i.test(causeText);
}

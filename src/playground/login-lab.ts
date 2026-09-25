/**
 * The sign-in lab: finds out, in a real browser, which account logins LM15
 * can run from a web page (lm15-contract auth/managed/browser.json holds the
 * header evidence; this page produces the receipts).
 *
 * It uses the SDK's login mechanics directly (`loginMethods`, `runLogin`,
 * `runRenewal`, `loginAdapter`). The page decides only two things:
 *
 * - **Relay consent, per stage** (proposed AUTH-21 promotion, contract
 *   changes/2026-09-24): sign-in traffic, model lists and model calls are
 *   agreed to separately, each after the page says what crosses the relay.
 *   Nothing is relayed that the person did not tick; the SDK refuses a
 *   page-blocked step before sending it rather than guessing.
 * - **Where sign-ins live:** in this tab's memory only. Reloading forgets them.
 *   (Encrypted device storage exists for keys; sign-ins will join it once the
 *   managed-Auth store is ported, so the two never share one list by accident.)
 *
 * Every auth exchange and model call is logged with the SDK's secret-free
 * record (host, path, direct or relay, status, OAuth word) and can be copied
 * as a receipt. No token, code or prompt text enters the log.
 */

import {
  AuthOperationError, Message, TlsEngine, loginAdapter, loginMethods, loginProviders, loginWay, pathRelay, renewalDue, runLogin, runRenewal, tunnelRelay,
  type AuthUI, type ExchangeRecord, type LoginMethod, type LoginOutcome, type ManualCodePrompt, type Notice, type Prompt, type RelayConfig, type RelayStage,
} from "lm15/browser";
import { privatePageHost, relayUrl, tunnelUrl } from "./relay.ts";

/** The rustls module ships beside the SDK (dist/tls); loaded only when the tunnel is chosen. */
let tlsEngine: Promise<TlsEngine> | undefined;
function tls(): Promise<TlsEngine> {
  tlsEngine ??= TlsEngine.load(new URL("./tls/lm15-tls.wasm", import.meta.resolve("lm15/browser")));
  return tlsEngine;
}

const RETURN_CHANNEL = "lm15-login-return";

// ─── The return leg of a page redirect ────────────────────────────────

/**
 * If this page load is a provider sending the person back (OpenRouter appends
 * `?code=` to the playground's address, dropping any fragment), hand the
 * address to the tab that is waiting and take the one-time code out of this
 * tab's address bar and history. Runs on import, before the playground starts.
 * The waiting tab's SDK validates the address; a code that is not its own
 * fails at the exchange (PKCE), so a forged return signs nobody in.
 */
function takeReturn(): boolean {
  if (typeof location === "undefined" || !new URLSearchParams(location.search).has("code")) return false;
  const href = location.href;
  history.replaceState(null, "", location.pathname);
  try {
    const channel = new BroadcastChannel(RETURN_CHANNEL);
    channel.postMessage({ href });
    channel.close();
  } catch {
    // No BroadcastChannel: the person pastes the address instead (the waiting tab asks for it).
  }
  return true;
}
export const returnedHere = takeReturn();

// ─── Small DOM helpers ───────────────────────────────────────────────

type Child = Node | string | null | undefined | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    if (k === "text") node.textContent = String(v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

// ─── The log ─────────────────────────────────────────────────────────

interface ModelRecord {
  readonly provider: string;
  readonly stage: "catalog" | "inference";
  readonly host: string;
  readonly via: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly ms: number;
}
type LogEntry = ({ kind: "auth" } & ExchangeRecord) | ({ kind: "model" } & ModelRecord) | { kind: "outcome"; provider: string; method: string; result: string; detail: string };

const STAGE_LABEL: Readonly<Record<RelayStage, string>> = { auth: "sign-in traffic", catalog: "model lists", inference: "model calls" };
/** What an encrypted tunnel can see, whatever the stage. */
const TUNNEL_SEES = "which provider you reach, when, and how much data moves. Not your codes, tokens, prompts or replies: this page encrypts them for the provider itself (rustls, compiled to WebAssembly) and checks the provider's certificate, so the tunnel cannot read or impersonate. The encryption runs in this page's code, so you still trust whoever serves this page.";

const RELAY_CROSSES: Readonly<Record<RelayStage, string>> = {
  auth: "sign-in codes, device codes, and your access and refresh tokens. Whoever runs the relay could act as you until you sign out or revoke access.",
  catalog: "your access token or key.",
  inference: "your access token or key, your prompts and the replies.",
};

const DEFAULT_MODELS: Readonly<Record<string, string>> = {
  xai: "grok-4-fast", "claude-code": "claude-sonnet-4-5", "openai-codex": "gpt-5.5", "github-copilot": "gpt-4.1",
  openrouter: "openai/gpt-4.1-mini", "kimi-code": "kimi-for-coding", meta: "muse-spark-1.3",
};

export class LoginLab {
  readonly #dialog: HTMLDialogElement;
  readonly #consent = new Set<RelayStage>();
  /** How consented stages travel: a forwarding relay (reads them) or the encrypted tunnel (cannot). */
  #mode: "forward" | "tunnel" = "forward";
  readonly #sessions = new Map<string, LoginOutcome>();
  readonly #log: LogEntry[] = [];
  #attempt: AbortController | undefined;
  #steps!: HTMLElement;
  #methods!: HTMLElement;
  #sessionsBox!: HTMLElement;
  #logBox!: HTMLElement;

  constructor(dialog: HTMLDialogElement) {
    this.#dialog = dialog;
    this.#render();
  }

  open(): void {
    this.#renderMethods();
    this.#dialog.showModal();
  }

  #relay(): RelayConfig | undefined {
    if (this.#consent.size === 0) return undefined;
    if (this.#mode === "tunnel" && tunnelUrl()) return tunnelRelay(tunnelUrl(), { stages: [...this.#consent], tls: tls() });
    const url = relayUrl();
    if (!url) return undefined;
    return pathRelay(url, { stages: [...this.#consent], userAgentHeader: "x-lm15-user-agent" });
  }

  #env(): { platform: "browser"; relay?: RelayConfig } {
    const relay = this.#relay();
    return relay ? { platform: "browser", relay } : { platform: "browser" };
  }

  #crosses(stage: RelayStage): string {
    return this.#mode === "tunnel" && tunnelUrl() ? "Encrypted end to end; see above." : `What crosses it: ${RELAY_CROSSES[stage]}`;
  }

  // ─── Layout ──────────────────────────────────────────────────────

  #render(): void {
    const close = el("button", { class: "quiet", "aria-label": "Close", type: "button", text: "✕" });
    close.addEventListener("click", () => this.#dialog.close());
    const intro = el("p", { class: "setting-help" });
    const tunnelNote = el("p", { class: "setting-help lab-tunnel-note" });
    const describeMode = (): void => {
      const tunnel = this.#mode === "tunnel" && tunnelUrl();
      intro.textContent = tunnel
        ? `Some sign-in and model endpoints do not let a web page read their replies. For those, and only if you tick a box below, this page sends the request through the lm15 encrypted tunnel (${new URL(tunnelUrl()).host}). Anything else goes straight from this page to the provider.`
        : `Some sign-in and model endpoints do not let a web page read their replies. For those, and only if you tick a box below, this page sends the request through the lm15 relay (${relayUrl() || "not deployed"}): a small server lm15 runs, which keeps no log. Anything else goes straight from this page to the provider.`;
      // One statement of what the tunnel sees: it is the same for every kind of traffic.
      tunnelNote.hidden = !tunnel;
      tunnelNote.textContent = tunnel ? `What the tunnel sees, whatever you tick: ${TUNNEL_SEES}` : "";
    };
    const consent = el("fieldset", { class: "lab-consent" }, el("legend", { text: "The lm15 relay" }), intro);
    const stageTexts: Array<[RelayStage, HTMLElement]> = [];
    if (tunnelUrl()) {
      const choice = el("div", { class: "lab-mode", role: "radiogroup", "aria-label": "How the relay carries requests" });
      for (const [mode, label] of [["forward", "Forwarding relay: it reads and forwards each request"], ["tunnel", "Encrypted tunnel (prototype): it only passes encrypted bytes along"]] as const) {
        const radio = el("input", { type: "radio", name: "lab-relay-mode", value: mode, ...(mode === this.#mode ? { checked: true } : {}) });
        radio.addEventListener("change", () => {
          if (!radio.checked) return;
          this.#mode = mode;
          for (const [stage, span] of stageTexts) span.textContent = this.#crosses(stage);
          describeMode();
          addressRow.hidden = this.#mode === "tunnel";
          this.#renderMethods();
        });
        choice.append(el("label", { class: "checkbox" }, radio, label));
      }
      consent.append(choice, tunnelNote);
    }
    for (const stage of ["auth", "catalog", "inference"] as const) {
      const box = el("input", { type: "checkbox" });
      box.addEventListener("change", () => {
        if (box.checked) this.#consent.add(stage); else this.#consent.delete(stage);
        this.#renderMethods();
      });
      const text = el("span", { text: this.#crosses(stage) });
      stageTexts.push([stage, text]);
      consent.append(el("label", { class: "checkbox lab-check" }, box, el("span", {}, el("b", { text: `Relay ${STAGE_LABEL[stage]}. ` }), text)));
    }
    consent.append(el("p", { class: "setting-help", text: "Your choice lasts until this tab closes." }));
    const addressRow = el("label", { class: "lab-relay-address" });
    if (privatePageHost(location.hostname)) {
      // A playground on this person's own machines may use their own relay (relay.ts explains why only here).
      const address = el("input", { type: "url", value: relayUrl(), spellcheck: "false", "aria-label": "Relay address", class: "lab-relay-url" });
      address.addEventListener("change", () => {
        const value = address.value.trim().replace(/\/$/, "");
        try {
          if (value) localStorage.setItem("lm15.playground.relay-url", new URL(value).origin);
          else localStorage.removeItem("lm15.playground.relay-url");
        } catch {
          address.setCustomValidity("Not a URL");
          address.reportValidity();
          return;
        }
        address.setCustomValidity("");
        address.value = relayUrl();
        this.#renderMethods();
      });
      addressRow.append("Forwarding relay address (this page is on a private address, so you may use your own relay): ", address);
      addressRow.hidden = this.#mode === "tunnel";
      consent.append(addressRow);
    }
    describeMode();

    this.#methods = el("div", { class: "lab-methods" });
    this.#steps = el("div", { class: "lab-steps", "aria-live": "polite" });
    this.#sessionsBox = el("div", { class: "lab-sessions" });
    this.#logBox = el("div", { class: "lab-log" });
    const copy = el("button", { class: "text-button", type: "button", text: "Copy receipt" });
    copy.addEventListener("click", () => void navigator.clipboard.writeText(this.#receipt()).then(() => { copy.textContent = "Copied"; setTimeout(() => (copy.textContent = "Copy receipt"), 1500); }));
    const clear = el("button", { class: "text-button", type: "button", text: "Clear log" });
    clear.addEventListener("click", () => { this.#log.length = 0; this.#renderLog(); });

    this.#dialog.replaceChildren(
      el("div", { class: "dialog-heading" }, el("h2", { id: "login-lab-title", text: "Sign-in lab (experimental)" }), close),
      el("p", { class: "setting-help", text: "Try signing in with an account (a subscription, or OpenRouter's key approval) from this web page, then make one small model call. Nothing here is a supported feature yet: this page is how we find out what works. Sign-ins stay in this tab's memory; reloading forgets them. A test call may count against your subscription or credits." }),
      consent,
      el("h3", { text: "Ways to sign in" }), this.#methods,
      this.#steps,
      el("h3", { text: "Signed in, in this tab" }), this.#sessionsBox,
      el("div", { class: "lab-log-heading" }, el("h3", { text: "What happened" }), el("span", {}, clear, " ", copy)), this.#logBox,
    );
    this.#renderSessions();
    this.#renderLog();
  }

  #renderMethods(): void {
    const env = this.#env();
    const rows: HTMLElement[] = [];
    for (const provider of loginProviders(env)) {
      for (const method of loginMethods(provider.id, env)) {
        const button = el("button", { type: "button", class: "primary lab-start", text: "Sign in" });
        button.disabled = method.availability === "unavailable" || this.#attempt !== undefined;
        button.addEventListener("click", () => void this.#start(provider.id, method));
        const relayNeeds = method.needsRelay.length ? `Needs the relay for ${method.needsRelay.map((s) => STAGE_LABEL[s]).join(", ")}.` : "No relay needed.";
        rows.push(el("div", { class: "lab-method", "data-availability": method.availability },
          el("div", { class: "lab-method-main" },
            el("b", { text: `${provider.label} · ` }), method.label,
            el("div", { class: "setting-help", text: `${method.availability === "unavailable" ? "Unavailable here: " : "Unverified in a browser. "}${method.availability === "unavailable" ? method.reason ?? "" : relayNeeds}${method.billingNote ? ` ${method.billingNote}` : ""}` })),
          button));
      }
    }
    this.#methods.replaceChildren(...rows);
  }

  #renderSessions(): void {
    if (this.#sessions.size === 0) {
      this.#sessionsBox.replaceChildren(el("p", { class: "setting-help", text: "Nothing yet." }));
      return;
    }
    const rows: HTMLElement[] = [];
    for (const [provider, outcome] of this.#sessions) {
      const expires = outcome.material.type === "oauth" && typeof outcome.material.expires === "number" ? new Date(outcome.material.expires) : undefined;
      const model = el("input", { type: "text", value: DEFAULT_MODELS[provider] ?? "", "aria-label": `Model for ${provider}`, list: `lab-models-${provider}`, spellcheck: "false" });
      const datalist = el("datalist", { id: `lab-models-${provider}` });
      const result = el("p", { class: "setting-help lab-result" });
      const list = el("button", { type: "button", class: "text-button", text: "List models" });
      const call = el("button", { type: "button", class: "text-button", text: "Send “Reply with exactly OK.”" });
      const renew = el("button", { type: "button", class: "text-button", text: "Renew now" });
      const forget = el("button", { type: "button", class: "text-button warm", text: "Sign out" });
      list.addEventListener("click", () => void this.#listModels(provider, datalist, result));
      call.addEventListener("click", () => void this.#call(provider, model.value.trim(), result));
      renew.addEventListener("click", () => void this.#renew(provider, result));
      forget.addEventListener("click", () => {
        this.#sessions.delete(provider);
        this.#renderSessions();
      });
      renew.disabled = outcome.renewal === "none";
      rows.push(el("div", { class: "lab-session" },
        el("div", {}, el("b", { text: outcome.label }), el("span", { class: "setting-help", text: ` · ${outcome.methodId} · ${expires ? `expires ${expires.toLocaleTimeString()}${renewalDue(outcome.material) ? " (renewal due)" : ""}` : outcome.material.type === "api_key" ? "a key; no expiry set here" : "expiry unknown"}` })),
        el("div", { class: "lab-session-actions" }, model, datalist, list, call, renew, forget),
        result));
    }
    this.#sessionsBox.replaceChildren(...rows);
  }

  #renderLog(): void {
    if (this.#log.length === 0) {
      this.#logBox.replaceChildren(el("p", { class: "setting-help", text: "Each request appears here: where it went, directly or through the relay, and what came back. No token, code or message text is recorded." }));
      return;
    }
    const table = el("table", {}, el("thead", {}, el("tr", {}, ...["Provider", "Step", "Endpoint", "Way", "Result", "ms"].map((h) => el("th", { text: h })))));
    const body = el("tbody");
    for (const entry of this.#log) {
      if (entry.kind === "outcome") {
        body.append(el("tr", { class: `lab-outcome ${entry.result}` }, el("td", { text: entry.provider }), el("td", { colspan: "5", text: `${entry.method}: ${entry.result}${entry.detail ? ` — ${entry.detail}` : ""}` })));
        continue;
      }
      const way = entry.via === "direct" ? "direct" : entry.via === "tunnel" || entry.via.startsWith("https://") && tunnelUrl() && new URL(tunnelUrl()).host === new URL(entry.via).host ? "tunnel" : "relay";
      const result = entry.kind === "auth"
        ? entry.failure ? `failed: ${entry.failure}` : `HTTP ${entry.status}${entry.oauthError ? ` ${entry.oauthError}` : ""}`
        : entry.detail;
      body.append(el("tr", { "data-ok": String(entry.kind === "auth" ? !entry.failure && entry.status !== null && entry.status < 400 : entry.ok) },
        el("td", { text: entry.provider }), el("td", { text: entry.stage }), el("td", { text: entry.kind === "auth" ? `${entry.method} ${entry.host}${entry.path}` : entry.host }),
        el("td", { text: way }), el("td", { text: result }), el("td", { text: String(entry.ms) })));
    }
    table.append(body);
    this.#logBox.replaceChildren(table);
  }

  #receipt(): string {
    return JSON.stringify({
      tool: "lm15 playground sign-in lab",
      date: new Date().toISOString(),
      origin: location.origin,
      browser: navigator.userAgent,
      relay: this.#relay() ? { origin: this.#relay()!.origin, encrypted: this.#relay()!.encrypted === true, stages: [...this.#consent] } : null,
      entries: this.#log,
    }, null, 2);
  }

  #record(entry: LogEntry): void {
    this.#log.push(entry);
    this.#renderLog();
  }

  // ─── A login attempt ─────────────────────────────────────────────

  async #start(provider: string, method: LoginMethod): Promise<void> {
    const controller = new AbortController();
    this.#attempt = controller;
    this.#renderMethods();
    const cancel = el("button", { type: "button", class: "text-button warm", text: "Cancel" });
    cancel.addEventListener("click", () => controller.abort());
    const feed = el("div", { class: "lab-feed" });
    this.#steps.replaceChildren(el("div", { class: "lab-attempt" }, el("div", { class: "lab-attempt-heading" }, el("b", { text: `Signing in: ${provider} · ${method.label}` }), cancel), feed));
    try {
      const outcome = await runLogin(provider, method.id, {
        ...this.#env(), ui: this.#ui(feed), signal: controller.signal, allowUnverified: true,
        // An address with no trailing slash to lose: OpenRouter drops one (2026-09-24), and /playground (no slash)
        // is a 404 on the dev server. /playground/index.html is the same page everywhere.
        pageReturnUrl: `${location.origin}${location.pathname.endsWith("/") ? `${location.pathname}index.html` : location.pathname}`,
        onExchange: (record) => this.#record({ kind: "auth", ...record }),
      });
      this.#sessions.set(provider, outcome);
      this.#record({ kind: "outcome", provider, method: method.id, result: "signed-in", detail: outcome.label });
      feed.append(el("p", { class: "lab-ok", text: `Signed in: ${outcome.label}. Try a model call below.` }));
      this.#renderSessions();
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      this.#record({ kind: "outcome", provider, method: method.id, result: aborted ? "cancelled" : "failed", detail: aborted ? "" : describe(error) });
      feed.append(el("p", { class: aborted ? "setting-help" : "field-error", text: aborted ? "Cancelled." : describe(error) }));
    } finally {
      cancel.remove();
      this.#attempt = undefined;
      this.#renderMethods();
    }
  }

  /** The AuthUI the SDK talks to: notices appended to the feed, prompts rendered inline. */
  #ui(feed: HTMLElement): AuthUI {
    return {
      notify: (notice: Notice) => feed.append(renderNotice(notice)),
      prompt: (prompt: Prompt, { signal }) => promptInline(feed, prompt, signal),
    };
  }

  // ─── After sign-in ───────────────────────────────────────────────

  async #withModelRecord<T>(provider: string, stage: "catalog" | "inference", run: () => Promise<T>, host: string, via: string): Promise<T> {
    const started = performance.now();
    try {
      const value = await run();
      this.#record({ kind: "model", provider, stage, host, via, ok: true, detail: "ok", ms: Math.round(performance.now() - started) });
      return value;
    } catch (error) {
      this.#record({ kind: "model", provider, stage, host, via, ok: false, detail: describe(error), ms: Math.round(performance.now() - started) });
      throw error;
    }
  }

  async #adapter(provider: string, stage: "catalog" | "inference") {
    let outcome = this.#sessions.get(provider)!;
    if (renewalDue(outcome.material)) outcome = await this.#renewOutcome(provider);
    const env = this.#env();
    const adapter = loginAdapter(outcome, { ...env, stage });
    const way = loginWay(outcome, stage, env);
    const via = way.via === "direct" ? "direct" : way.encrypted ? "tunnel" : "relay";
    const url = new URL(adapter.baseUrl);
    const host = via === "relay" ? url.pathname.split("/")[1] ?? url.host : url.host;
    return { adapter, host, via };
  }

  async #listModels(provider: string, datalist: HTMLDataListElement, result: HTMLElement): Promise<void> {
    result.className = "setting-help lab-result";
    result.textContent = "Listing models…";
    try {
      const { adapter, host, via } = await this.#adapter(provider, "catalog");
      const models = await this.#withModelRecord(provider, "catalog", () => adapter.listModels(), host, via);
      datalist.replaceChildren(...models.map((m) => el("option", { value: m.id })));
      result.textContent = `${models.length} models: ${models.slice(0, 12).map((m) => m.id).join(", ")}${models.length > 12 ? ", …" : ""}`;
    } catch (error) {
      result.className = "field-error lab-result";
      result.textContent = describe(error);
    }
  }

  async #call(provider: string, model: string, result: HTMLElement): Promise<void> {
    result.className = "setting-help lab-result";
    if (!model) {
      result.textContent = "Type a model name first (List models shows this account's).";
      return;
    }
    result.textContent = "Calling…";
    try {
      const { adapter, host, via } = await this.#adapter(provider, "inference");
      // Codex refuses an output cap (MAP-13 rule 4), so the test call sets none there.
      const config = provider === "openai-codex" ? {} : { maxTokens: 32 };
      const response = await this.#withModelRecord(provider, "inference", () => adapter.complete({ model, messages: [Message.user("Reply with exactly OK.")], config }), host, via);
      result.textContent = `${model} answered: “${response.text ?? ""}”${response.usage ? ` · ${response.usage.inputTokens ?? "?"} in / ${response.usage.outputTokens ?? "?"} out tokens` : ""}`;
    } catch (error) {
      result.className = "field-error lab-result";
      result.textContent = describe(error);
    }
  }

  async #renewOutcome(provider: string): Promise<LoginOutcome> {
    const renewed = await runRenewal(this.#sessions.get(provider)!, { ...this.#env(), onExchange: (record) => this.#record({ kind: "auth", ...record }) });
    this.#sessions.set(provider, renewed);
    this.#record({ kind: "outcome", provider, method: "renewal", result: "renewed", detail: "" });
    return renewed;
  }

  async #renew(provider: string, result: HTMLElement): Promise<void> {
    result.className = "setting-help lab-result";
    result.textContent = "Renewing…";
    try {
      await this.#renewOutcome(provider);
      this.#renderSessions();
    } catch (error) {
      this.#record({ kind: "outcome", provider, method: "renewal", result: "failed", detail: describe(error) });
      if (error instanceof AuthOperationError && (error.reason === "credential_rejected" || error.reason === "indeterminate")) this.#sessions.delete(provider);
      this.#renderSessions();
      const box = this.#sessionsBox.querySelector(".lab-result") ?? result;
      box.className = "field-error lab-result";
      box.textContent = describe(error);
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof AuthOperationError) return `${error.message} [${error.reason}${error.stage ? `, ${error.stage}` : ""}]`;
  const relay = relayUrl();
  if (error instanceof Error && relay && error.message.includes(new URL(relay).host)) {
    return `${error.name}: ${error.message}. This request went through the relay at ${new URL(relay).origin}; check the relay address in the box above (and that the relay allows this page).`;
  }
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function renderNotice(notice: Notice): HTMLElement {
  switch (notice.type) {
    case "auth_url": {
      const open = el("button", { type: "button", class: "primary", text: "Open the sign-in page" });
      // A new tab: this one keeps the attempt (and its secrets) in memory.
      open.addEventListener("click", () => window.open(notice.url, "_blank"));
      return el("div", { class: "lab-notice" }, el("p", { text: notice.instructions }), open);
    }
    case "device_code": {
      const copy = el("button", { type: "button", class: "text-button", text: "Copy code" });
      copy.addEventListener("click", () => void navigator.clipboard.writeText(notice.userCode));
      return el("div", { class: "lab-notice" },
        el("p", {}, "Open ", el("a", { href: notice.verificationUrl, target: "_blank", rel: "noopener noreferrer", text: new URL(notice.verificationUrl).host }), " and enter this code:"),
        el("p", { class: "lab-code" }, el("code", { text: notice.userCode }), " ", copy),
        el("p", { class: "setting-help", text: `Valid for about ${Math.round(notice.expiresInS / 60)} minutes. This page checks every ${notice.intervalS} seconds and continues by itself.` }));
    }
    case "progress":
      return el("p", { class: "setting-help", text: notice.message });
    case "info":
      return el("p", { class: "setting-help lab-info", text: notice.message });
  }
}

/** Render one prompt inline; resolve with the answer, or reject when the SDK abandons it. */
function promptInline(feed: HTMLElement, prompt: Prompt, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const form = el("form", { class: "lab-prompt" });
    let channel: BroadcastChannel | undefined;
    const done = (): void => {
      form.remove();
      channel?.close();
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      done();
      reject(new DOMException("prompt abandoned", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (prompt.type === "select") {
      form.append(el("p", { text: prompt.label }));
      for (const option of prompt.options) {
        const b = el("button", { type: "button", text: option.label });
        b.addEventListener("click", () => { done(); resolve(option.id); });
        form.append(b);
      }
      feed.append(form);
      return;
    }
    const input = el("input", { type: prompt.type === "secret" ? "password" : "text", autocomplete: "off", spellcheck: "false", "aria-label": prompt.label, placeholder: prompt.type === "manual_code" ? prompt.accepted : "" });
    form.append(el("label", { text: prompt.label }), el("div", { class: "lab-prompt-row" }, input, el("button", { type: "submit", class: "primary", text: "Continue" })));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      done();
      resolve(input.value);
    });
    if (prompt.type === "manual_code" && prompt.pageReturn) {
      const expected = new URL((prompt as ManualCodePrompt).pageReturn!.url);
      const samePage = (href: string): boolean => {
        try {
          const url = new URL(href);
          const norm = (p: string): string => p.replace(/\/index\.html$/, "/").replace(/\/+$/, "");
          return url.origin === expected.origin && norm(url.pathname) === norm(expected.pathname);
        } catch {
          return false;
        }
      };
      form.append(el("p", { class: "setting-help", text: "Waiting for the sign-in tab to come back to this page…" }));
      try {
        channel = new BroadcastChannel(RETURN_CHANNEL);
        channel.onmessage = (event: MessageEvent<{ href?: unknown }>) => {
          const href = event.data?.href;
          // The SDK validates the address in full; this only ignores returns meant for another page.
          if (typeof href === "string" && samePage(href)) {
            done();
            resolve(href);
          }
        };
      } catch {
        // No BroadcastChannel: paste the address instead.
      }
    }
    feed.append(form);
    input.focus();
  });
}

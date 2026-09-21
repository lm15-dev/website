/** The playground: a chat or a judge set, its settings, and the same request in four languages that actually run. */
import { Message, parseJson, stringifyJson, text as textPart, type Request } from "lm15/browser";
import { CONNECTIONS } from "./connections.ts";
import { Credentials } from "./credentials.ts";
import { renderCode } from "./code-view.ts";
import { comment, dim, finish, replaceAll, unmarked, type Code } from "./marks.ts";
import type { Progress } from "./runtimes/progress.ts";
import { DEFAULT_SETTINGS, EXAMPLE_API_KEY, EXAMPLE_DRAFT, LANGUAGES, buildRequest, createClient, exampleConversation, exampleGo, exampleJavascript, examplePython, exampleRust, fuzzyScore, judgmentsOnly, keyPage, keyless, slashCommand, turnSource, type Connection, type PickerKind, type Settings, type Wire } from "./experience.ts";
import { JudgeView } from "./judge-ui.ts";
import type { JudgeSource } from "./judge.ts";
import { disableAllRelays, enableRelay, looksBrowserBlocked, relayAvailable, relayed, relayedProviders } from "./relay.ts";
import { Picker, type PickOption, type PickResult } from "./picker.ts";
import { javascriptRuntime } from "./runtimes/javascript.ts";
import { displayError } from "./error-display.ts";
import type { Runtime, RuntimeId } from "./runtimes/index.ts";
import { pythonRuntime } from "./runtimes/python.ts";
import { rustRuntime } from "./runtimes/rust.ts";
import { goRuntime } from "./runtimes/go.ts";
import { compareWires } from "./wire.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const prompt = $<HTMLTextAreaElement>("prompt");
const send = $<HTMLButtonElement>("send");
const stop = $<HTMLButtonElement>("stop");
const remember = $<HTMLInputElement>("remember");
const automatic = $<HTMLInputElement>("automatic-models");
const systemInput = $<HTMLTextAreaElement>("system");
const temperatureInput = $<HTMLInputElement>("temperature");
const moreMenu = $<HTMLDetailsElement>("more-menu");
const maxTokensInput = $<HTMLInputElement>("max-tokens");
const reasoningInput = $<HTMLSelectElement>("reasoning");
const relayDialog = $<HTMLDialogElement>("relay-dialog");

const RUNTIMES: Record<RuntimeId, Runtime> = { javascript: javascriptRuntime, python: pythonRuntime, rust: rustRuntime, go: goRuntime };
const connection: Connection = { provider: "openai", model: "gpt-4.1-mini", endpoint: "http://localhost:1234/v1" };
const settings: Settings = { ...DEFAULT_SETTINGS };
const credentials = new Credentials();
const keyRevision = new Map<string, number>();
interface Catalogue { ids: string[]; status: string; loading: boolean; error?: string }
const catalogues = new Map<string, Catalogue>();
let messages: Message[] = [];
let generation = 0;
let active: AbortController | undefined;
let runtime: RuntimeId = "javascript";
let runtimeVersion = 0;
let loadingRuntime = false;
let copyTimer: ReturnType<typeof setTimeout> | undefined;
type Mode = "chat" | "judge";
let mode: Mode = "chat";
const judgeDefault = CONNECTIONS.find(choice => choice.id === "typesafe")!;
// Session-only selections: Judge starts with Jev; Chat keeps its own model.
// Mutate `connection` in place because the shared controls and JudgeView hold it.
const modeConnections: Record<Mode, Connection> = {
  chat: { ...connection },
  judge: { provider: judgeDefault.id, model: judgeDefault.model, endpoint: connection.endpoint },
};
let judge: JudgeView;
/** The code panel shows the program, or the request that program puts on the wire (built by the selected runtime, never sent). */
let codeView: "code" | "request" = "code";
/** The control under the pointer or the caret: its value is lit in the code (marks carry the source name). */
let lit: string | undefined;
let pinned: string | undefined; // the focused control keeps its light while the pointer wanders
/** An edited turn that became empty: nothing can be built from it until it has text again. */
let transcriptError = "";
/** What the provider list says in red: a missing key, an example key, a failed save. Cleared by the next good key. */
let keyError = "";
const savingKey = new Set<string>();

const picker = new Picker(options, (kind, id) => {
  if (kind === "commands") {
    if (id === "settings") openSettings();
    else if (id === "model" && automatic.checked) void discover();
    return;
  }
  if (kind === "provider") selectProvider(id);
  else selectModel(id);
  prompt.focus();
});

// ─── Rendering ────────────────────────────────────────────────────────

function notify(text = "") { $("alert").textContent = text; $("alert").hidden = !text; }
function notifyKey(text = ""): void { keyError = text; picker.update(); }
/** A textarea that is as tall as its text, up to its CSS max-height: no resize handle to drag. */
function autosize(area: HTMLTextAreaElement): void {
  area.style.height = "auto";
  area.style.height = `${area.scrollHeight + area.offsetHeight - area.clientHeight}px`; // content plus its own border
}
/** The code panel folds away when the conversation needs the room; the choice is kept for next time. */
function setCodeCollapsed(collapsed: boolean, persist = true): void {
  document.body.dataset.code = collapsed ? "collapsed" : "open";
  const toggle = $("toggle-code");
  toggle.setAttribute("aria-expanded", String(!collapsed));
  toggle.textContent = collapsed ? "Show code" : "Hide";
  toggle.title = collapsed ? "Show the code panel" : "Hide the code panel";
  if (persist) { try { localStorage.setItem("lm15.playground.code", collapsed ? "collapsed" : "open"); } catch { /* not remembered */ } }
}
function setView(view: string): void {
  document.body.dataset.view = view;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view-target]")) button.setAttribute("aria-pressed", String(button.dataset.viewTarget === view));
}
function updateControls(): void {
  const busy = Boolean(active) || (judge?.busy() ?? false);
  send.disabled = Boolean(active) || loadingRuntime || !RUNTIMES[runtime].loaded() || !prompt.value.trim();
  send.textContent = loadingRuntime ? `Loading ${RUNTIMES[runtime].label}…` : RUNTIMES[runtime].loaded() ? "Send" : `${RUNTIMES[runtime].label} not loaded`;
  stop.disabled = !active;
  $("code-tabs").dataset.state = loadingRuntime ? "loading" : RUNTIMES[runtime].loaded() ? "ready" : "error";
  $("code-tabs").setAttribute("aria-busy", String(loadingRuntime));
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-language]")) tab.disabled = busy;
  // Mode switches restore that mode's model; a judgments-only selection
  // must not trap the user in Judge. Nothing switches mode mid-run.
  for (const button of document.querySelectorAll<HTMLButtonElement>(".mode-switch button")) {
    button.disabled = busy;
    button.title = "";
  }
  judge?.refresh();
}
/** Chat and Judge share one key card and one code panel: the elements move; nothing is duplicated. */
function setMode(next: Mode, remember = false): void {
  const changed = next !== mode;
  if (changed) {
    modeConnections[mode] = { ...connection };
    Object.assign(connection, modeConnections[next]);
    notify(); notifyKey();
  }
  mode = next;
  document.body.dataset.mode = next;
  $("chat-view").hidden = next === "judge";
  $("judge-view").hidden = next === "chat";
  for (const button of document.querySelectorAll<HTMLButtonElement>(".mode-switch button")) button.setAttribute("aria-pressed", String(button.dataset.mode === next));
  const codePanel = $("code-panel");
  if (next === "judge") $("judge-code-slot").append(codePanel);
  else $("chat-view").append(codePanel);
  const labels: Record<string, string> = next === "judge" ? { settings: "Questions", chat: "Results", code: "Code" } : { settings: "Questions", chat: "Chat", code: "Code" };
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view-target]")) button.textContent = labels[button.dataset.viewTarget!]!;
  if (next === "chat" && document.body.dataset.view === "settings") setView("chat"); // Chat has no third view
  if (remember) { try { localStorage.setItem("lm15.playground.mode", next); } catch { /* not remembered */ } }
  refreshStatus();
  if (changed && automatic.checked) void discover();
}
/** The key lives beside its provider: open that list and put the caret in this provider's key field. */
function openConnection(): void {
  if (keyless(connection.provider) && connection.provider !== "custom") { openSettings(); return; }
  if (picker.current !== "provider") picker.open("provider");
  picker.focusTrailing(connection.provider);
}
function scrollChat(): void { const area = $("chat-scroll"); area.scrollTop = area.scrollHeight; }
function redact(text: string): string {
  for (const key of credentials.providers().map((p) => credentials.get(p)!)) if (key.length > 3) text = text.split(key).join("[redacted]");
  return text;
}
function redactCode(code: Code): Code {
  for (const key of credentials.providers().map((p) => credentials.get(p)!)) if (key.length > 3) code = replaceAll(code, key, "[redacted]");
  return code;
}
/** The wire as text: the request line, the headers dimmed, the body as the SDK wrote it. */
function wireCode(text: string, headerCount: number): Code {
  // A raw control character in a body (never in JSON, which escapes them) shows as U+FFFD rather than passing for a mark.
  const lines = text.replace(/[\u0001-\u0007]/g, "\uFFFD").split("\n");
  // Lines 2 .. 1+headerCount are the headers (line 1 is blank after the request line).
  return finish(lines.map((line, i) => (i >= 2 && i < 2 + headerCount ? dim(line) : line)).join("\n"));
}
function errorMessage(error: unknown): string {
  const named = displayError(error);
  return redact(named) + (looksBrowserBlocked(error) ? (relayed(connection.provider) ? "\nThe relay could not be reached." : "\nThe provider may block browser access, or the network failed.") : "");
}
function currentChoice() { return CONNECTIONS.find((choice) => choice.id === connection.provider)!; }
function cacheKey(): string { return `${connection.provider}:${connection.endpoint}:${keyRevision.get(connection.provider) ?? 0}`; }
function draft(): string {
  const text = prompt.value.trim();
  if (text && !slashCommand(text)) return text;
  return messages.length > 2 ? "Your next message" : EXAMPLE_DRAFT;
}

let codeVersion = 0;
async function updateCode(): Promise<void> {
  const version = ++codeVersion;
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-language]")) tab.setAttribute("aria-pressed", String(tab.dataset.language === runtime));
  const text = redact(draft());
  let code: Code = unmarked("");
  const invalidMax = !maxTokensInput.validity.valid;
  const invalidTemperature = !temperatureInput.validity.valid;
  maxTokensInput.setAttribute("aria-invalid", String(invalidMax));
  temperatureInput.setAttribute("aria-invalid", String(invalidTemperature));
  let error = invalidTemperature ? "Temperature must be 0 to 2 in steps of 0.1, or empty for the provider default." : invalidMax ? "Max tokens must be a whole number from 1 to 100000, or empty for the provider default." : transcriptError;
  $("settings-error").hidden = !error;
  $("settings-error").textContent = error;
  try {
    if (mode === "judge") code = judge.code(runtime);
    else {
      if (error) throw new Error(error);
      if (runtime === "javascript") code = exampleJavascript(connection, settings, messages, text);
      else if (runtime === "python") code = examplePython(connection, settings, messages, text);
      else if (runtime === "go") code = exampleGo(connection, settings, messages, text);
      else code = exampleRust(connection, settings, messages, text);
    }
  } catch (error) {
    code = finish(comment(`// ${redact(error instanceof Error ? error.message : String(error))}`));
  }
  if (version !== codeVersion) return;
  $("copy-status").textContent = "";
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-code-view]")) button.setAttribute("aria-pressed", String(button.dataset.codeView === codeView));
  $("code-scroll").dataset.view = codeView;
  if (codeView === "code") {
    renderCode($("code"), redactCode(code));
    spotlight(lit, false);
    $("copy-code").textContent = "Copy code";
    $("request-note").hidden = true;
    return;
  }
  $("copy-code").textContent = "Copy request";
  await updateRequestView(version, error, text);
}

/** The wire: what the selected runtime's SDK builds for the current turn or input, with the key blanked. Nothing is sent. */
async function updateRequestView(version: number, settingsError: string, text: string): Promise<void> {
  const note = $("request-note");
  const show = (message: string, body = "") => { if (version !== codeVersion) return; note.textContent = message; note.hidden = false; renderCode($("code"), unmarked(body)); };
  const chosen = RUNTIMES[runtime];
  if (loadingRuntime || !chosen.loaded()) return show(`${chosen.label} is not loaded yet; the request is built by the runtime that would send it.`);
  let request: Request, which: string, source: JudgeSource | undefined;
  try {
    if (mode === "judge") {
      const current = judge.currentRequest();
      if (!current) return show("Add an input to see its request.");
      request = current.request; which = current.label; source = current.source;
    } else {
      if (settingsError) return show(settingsError);
      request = buildRequest(connection, settings, messages, text); which = "this turn";
    }
  } catch (e) { return show(errorMessage(e)); }
  // Without a key, the example key stands in, as in the code; a real key is blanked, never shown.
  const key = credentials.get(connection.provider) ?? EXAMPLE_API_KEY;
  try {
    const wire = await chosen.wire(connection, key, request, source);
    if (version !== codeVersion) return;
    const lines = [`${wire.method} ${wire.url}`, "", ...wire.headers.map(([k, v]) => `${k}: ${v}`), ""];
    let body = wire.body;
    try { body = stringifyJson(parseJson(wire.body), { indent: 2 }); } catch { /* not JSON: as is */ }
    lines.push(body);
    note.textContent = `Built by ${chosen.label} for ${which}, not sent.${credentials.get(connection.provider) ? " Your key is blanked here." : " The example key stands in for yours."}`;
    note.hidden = false;
    renderCode($("code"), wireCode(redact(lines.join("\n").split(key).join("[your key]")), wire.headers.length));
  } catch (e) {
    show(`${chosen.label} cannot build this request: ${errorMessage(e)}`);
  }
}

/** A real key is present for this provider (the example key is a placeholder, never a credential). */
function hasKey(provider: string): boolean { const key = credentials.get(provider); return Boolean(key) && key !== EXAMPLE_API_KEY; }
/** One line of key state for a provider, as the picker row and the More list say it. */
function keyState(provider: string): string {
  const state = hasKey(provider) ? (credentials.remembered(provider) ? "Key ready (remembered on this device)" : "Key ready (this tab)") : keyless(provider) ? "Local connection" : "";
  return state + (relayed(provider) ? " · via the relay" : "");
}
function refreshStatus(): void {
  $("provider-name").textContent = currentChoice().label;
  $("model-name").textContent = connection.model || "Choose model";
  $("provider-button").title = `${currentChoice().label}${keyState(connection.provider) ? ` · ${keyState(connection.provider)}` : ""}`; $("model-button").title = connection.model;
  const relays = relayedProviders();
  $("relayed").textContent = relays.length ? `${relays.map((id) => CONNECTIONS.find((c) => c.id === id)?.label ?? id).join(", ")} — requests to ${relays.length === 1 ? "this provider go" : "these providers go"} through the lm15 relay.` : "None. Every request goes from this page straight to its provider.";
  $("forget-relays").hidden = relays.length === 0;
  $("loaded").textContent = credentials.providers().map((id) => `${CONNECTIONS.find((c) => c.id === id)?.label ?? id}${credentials.remembered(id) ? " (remembered)" : ""}`).join(", ") || "None";
  const catalogue = catalogues.get(cacheKey());
  $("model-status").textContent = catalogue?.status ?? (automatic.checked ? "Model IDs load when this connection is ready." : "Automatic model discovery is off.");
  $("model-status").title = catalogue?.error ?? "";
  updateControls();
  void updateCode();
  picker.update();
}

function reset(): void {
  generation++; active?.abort(); active = undefined; messages = exampleConversation(); transcriptError = "";
  $("transcript").replaceChildren(); $("usage").textContent = ""; $("fidelity").textContent = "";
  for (const message of messages) {
    const role = message.role === "user" ? "user" : "assistant";
    const text = message.parts.map((part) => part.type === "text" ? part.text : "").join("");
    turn(`Example ${role}`, text, role).parentElement!.dataset.example = "true";
  }
  updateControls();
}

// ─── Connection ───────────────────────────────────────────────────────

function credentialsChanged(): void {
  notifyKey();
  keyRevision.set(connection.provider, (keyRevision.get(connection.provider) ?? 0) + 1);
  reset(); refreshStatus();
}
function selectProvider(id: string): void {
  const choice = CONNECTIONS.find((candidate) => candidate.id === id);
  if (!choice) return;
  // Save the actual chat selection before moving to a judgments-only provider.
  if (judgmentsOnly(id) && mode === "chat") setMode("judge", true);
  if (id !== connection.provider) {
    connection.provider = id; connection.model = choice.model; reset(); notify(); notifyKey();
  }
  refreshStatus();
  if (automatic.checked) void discover();
}
function selectModel(id: string): void {
  if (connection.model !== id) { connection.model = id; reset(); notify(); }
  refreshStatus();
}
function openSettings(): void { if (matchMedia("(max-width: 1100px)").matches) setView("chat"); systemInput.focus(); systemInput.scrollIntoView({ block: "nearest" }); }

// ─── Keys, beside their providers ─────────────────────────────────────

/** Save what was pasted for one provider; that provider becomes the current one, and the row shows the key masked. */
function submitKey(provider: string, input: HTMLInputElement): void {
  const key = input.value.trim();
  if (savingKey.has(provider)) return;
  if (!key || key === EXAMPLE_API_KEY) {
    input.setAttribute("aria-invalid", "true");
    notifyKey(key === EXAMPLE_API_KEY ? "That is an example key. Paste your own provider key." : `Paste your ${CONNECTIONS.find((c) => c.id === provider)?.label ?? provider} API key.`);
    picker.focusTrailing(provider);
    return;
  }
  savingKey.add(provider); input.disabled = true;
  void credentials.set(provider, key, remember.checked).then(() => {
    savingKey.delete(provider);
    keyRevision.set(provider, (keyRevision.get(provider) ?? 0) + 1);
    keyError = "";
    // Pasting a key beside a provider is choosing that provider.
    if (provider === connection.provider) { reset(); notify(); refreshStatus(); if (automatic.checked) void discover(); }
    else selectProvider(provider);
  }).catch(() => {
    savingKey.delete(provider);
    notifyKey("Could not save this key. Try again, or uncheck Remember keys on this device.");
    picker.focusTrailing(provider);
  });
}
/** What sits at the right of a provider's row: its key, masked, with Forget; or a field to paste one; or, for local servers, the address. */
function keyControl(provider: string): HTMLElement {
  const box = document.createElement("div"); box.className = "key-slot";
  if (provider === "custom") {
    const endpoint = document.createElement("input"); endpoint.type = "url"; endpoint.value = connection.endpoint; endpoint.placeholder = "http://localhost:1234/v1";
    endpoint.setAttribute("aria-label", "Custom API root"); endpoint.title = "Changing the address clears its key.";
    endpoint.addEventListener("change", () => {
      if (connection.endpoint === endpoint.value.trim()) return;
      connection.endpoint = endpoint.value.trim();
      void credentials.forget("custom").then(() => credentialsChanged());
    });
    box.append(endpoint); return box;
  }
  if (keyless(provider)) { const local = document.createElement("span"); local.className = "key-local"; local.textContent = "Local"; box.append(local); return box; }
  if (hasKey(provider)) {
    const mask = document.createElement("span"); mask.className = "key-mask"; mask.textContent = "••••••••"; mask.title = keyState(provider);
    mask.setAttribute("aria-label", keyState(provider));
    const forget = document.createElement("button"); forget.type = "button"; forget.className = "text-button warm key-forget"; forget.textContent = "Forget";
    forget.setAttribute("aria-label", `Forget the ${CONNECTIONS.find((c) => c.id === provider)?.label ?? provider} key`);
    forget.addEventListener("click", () => {
      keyRevision.set(provider, (keyRevision.get(provider) ?? 0) + 1);
      void credentials.forget(provider).then(() => { if (connection.provider === provider) credentialsChanged(); else refreshStatus(); });
    });
    box.append(mask, forget); return box;
  }
  const input = document.createElement("input"); input.type = "password"; input.autocomplete = "off"; input.spellcheck = false;
  input.placeholder = "Paste API key"; input.setAttribute("aria-label", `${CONNECTIONS.find((c) => c.id === provider)?.label ?? provider} API key`);
  if (keyError && provider === connection.provider) input.setAttribute("aria-invalid", "true");
  input.addEventListener("input", () => { input.removeAttribute("aria-invalid"); if (keyError) { keyError = ""; $("picker-status").textContent = ""; $("picker-status").classList.remove("is-error"); } });
  input.addEventListener("change", () => submitKey(provider, input));
  input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); submitKey(provider, input); } });
  input.addEventListener("paste", () => setTimeout(() => submitKey(provider, input), 0));
  box.append(input);
  const page = keyPage(provider);
  if (page) { const link = document.createElement("a"); link.href = page; link.target = "_blank"; link.rel = "noopener noreferrer"; link.className = "key-page"; link.textContent = "Get a key"; box.append(link); }
  return box;
}

async function discover(force = false): Promise<void> {
  const selected = { ...connection };
  const cache = cacheKey();
  const existing = catalogues.get(cache);
  if (existing?.loading || (existing && !force)) return;
  const key = credentials.get(selected.provider);
  if ((!key || key === EXAMPLE_API_KEY) && !keyless(selected.provider)) { refreshStatus(); return; }
  const catalogue: Catalogue = { ids: [], status: "Loading model IDs…", loading: true };
  catalogues.set(cache, catalogue); refreshStatus();
  try {
    const lm = createClient(selected, key);
    if (!lm.supports.models) catalogue.status = "This provider doesn't list models here. Type an exact model ID instead.";
    else {
      const models = await lm.listModels();
      catalogue.ids = [...new Set(models.map((model) => model.id))];
      catalogue.status = `${catalogue.ids.length} model IDs listed · account access may differ`;
    }
  } catch (error) {
    catalogue.status = "Model discovery failed. You can still enter an exact model ID.";
    catalogue.error = errorMessage(error);
  } finally {
    catalogue.loading = false;
    if (cacheKey() === cache) refreshStatus();
  }
}

function options(kind: PickerKind, query: string): PickResult {
  let entries: PickOption[];
  let status: string;
  if (kind === "commands") {
    entries = [
      { id: "provider", label: "/provider", detail: "Change provider" },
      { id: "model", label: "/model", detail: "Search models or enter an ID" },
      { id: "settings", label: "/settings", detail: "System prompt and sampling" },
    ];
    status = "Commands configure the app. They are never sent to a model.";
  } else if (kind === "provider") {
    entries = CONNECTIONS.map((choice) => ({ id: choice.id, label: choice.label, detail: [judgmentsOnly(choice.id) ? "Judgments only · opens Judge" : "", relayed(choice.id) ? "via the relay" : ""].filter(Boolean).join(" · "), trailing: () => keyControl(choice.id) }));
    status = keyError;
  } else {
    const catalogue = catalogues.get(cacheKey());
    const listed = new Set(catalogue?.ids ?? []);
    entries = [...new Set([connection.model, ...listed, currentChoice().model])].filter(Boolean).map((id) => ({ id, label: id, detail: `${listed.has(id) ? "Listed by provider" : "Example or entered ID · unverified"}${id === connection.model ? " · current" : ""}` }));
    status = catalogue?.status ?? (credentials.get(connection.provider) ? "Type to search, or enter an exact model ID" : "Add this provider's key to discover models, or enter an ID");
  }
  const filtered = entries.map((entry, index) => ({ entry, index, score: Math.max(fuzzyScore(query, entry.id), fuzzyScore(query, entry.label)) }))
    .filter((hit) => Number.isFinite(hit.score)).sort((a, b) => b.score - a.score || a.index - b.index);
  const shown = filtered.slice(0, 30).map((hit) => hit.entry);
  if (kind === "model" && query.trim() && !entries.some((entry) => entry.id === query.trim())) shown.push({ id: query.trim(), label: `Use exact ID: ${query.trim()}`, detail: "Custom model ID · not verified" });
  if (filtered.length > 30) status += ` · showing 30 of ${filtered.length}; type to narrow`;
  if (!shown.length) status += " · no matches";
  return { options: shown, status, error: kind === "provider" && Boolean(keyError) };
}

// ─── Runtimes ─────────────────────────────────────────────────────────

/** The loading card over the code: what is happening, measured where it can be; or why it failed, with Retry. */
function showLoading(label: string, progress: Progress): void {
  const card = $("runtime-card"), bar = $("runtime-bar");
  card.hidden = false; card.dataset.state = "loading";
  $("code-body").dataset.loading = "";
  $("runtime-title").textContent = `Loading ${label}`;
  $("runtime-status").textContent = progress.detail ? `${progress.phase} · ${progress.detail}` : progress.phase;
  if (progress.fraction === undefined) { bar.removeAttribute("aria-valuenow"); bar.dataset.indeterminate = ""; bar.style.removeProperty("--fraction"); }
  else { delete bar.dataset.indeterminate; bar.setAttribute("aria-valuenow", String(Math.round(progress.fraction * 100))); bar.style.setProperty("--fraction", `${(progress.fraction * 100).toFixed(1)}%`); }
  bar.hidden = false;
  $("runtime-note").textContent = "Downloaded once; your browser keeps it for next time.";
  $("retry-runtime").hidden = true;
}
function showLoadFailure(label: string, reason: string): void {
  const card = $("runtime-card");
  card.hidden = false; card.dataset.state = "error";
  $("code-body").dataset.loading = "";
  // The title and the reason together read "Could not load Go: … " for a screen reader and the tests; the eye sees the title once.
  $("runtime-title").textContent = `Could not load ${label}`;
  $("runtime-status").textContent = `${reason}. Retry, or choose another language.`;
  $("runtime-bar").hidden = true;
  $("runtime-note").textContent = "";
  $("retry-runtime").hidden = false;
}
function hideLoading(): void {
  $("runtime-card").hidden = true;
  delete $("code-body").dataset.loading;
  $("runtime-status").textContent = "";
  $("retry-runtime").hidden = true;
}

async function selectRuntime(id: RuntimeId): Promise<void> {
  if (active) return;
  const version = ++runtimeVersion;
  runtime = id;
  try { localStorage.setItem("lm15.playground.runtime", id); } catch { /* storage is optional */ }
  const chosen = RUNTIMES[id];
  loadingRuntime = !chosen.loaded();
  hideLoading();
  refreshStatus();
  if (loadingRuntime) {
    showLoading(chosen.label, { phase: "Starting" });
    try {
      await chosen.load((progress) => { if (version === runtimeVersion && !progress.phase.startsWith(`${chosen.label} ready`)) showLoading(chosen.label, progress); });
    } catch (error) {
      if (version === runtimeVersion) showLoadFailure(chosen.label, redact(error instanceof Error ? error.message : String(error)));
    } finally {
      if (version === runtimeVersion) {
        loadingRuntime = false;
        if (chosen.loaded()) hideLoading();
        refreshStatus();
      }
    }
  }
}

/** The same request, built by every loaded runtime: identical bytes or a named difference. */
async function fidelity(request: Request): Promise<void> {
  const key = credentials.get(connection.provider);
  const wires: Array<[string, Wire]> = [];
  for (const rt of Object.values(RUNTIMES)) {
    if (!rt.loaded()) continue;
    try { wires.push([rt.label, await rt.wire(connection, key, request)]); } catch { /* an unloaded or refused runtime says nothing */ }
  }
  if (wires.length < 2) { $("fidelity").textContent = wires.length === 1 ? `Request built by ${wires[0]![0]}. Load another runtime to compare bytes.` : ""; return; }
  $("fidelity").textContent = compareWires(wires);
}

// ─── What you touch on the left lights up on the right ────────────────

/** Light every piece of code that came from `source`; scroll the first into view when the source changes. */
function spotlight(source: string | undefined, scroll = true): void {
  const changed = source !== lit;
  lit = source;
  for (const span of document.querySelectorAll("#code .lit")) span.classList.remove("lit");
  if (!source) return;
  const spans = document.querySelectorAll<HTMLElement>(`#code [data-source="${CSS.escape(source)}"]`);
  for (const span of spans) span.classList.add("lit");
  if (scroll && changed && spans[0]) spans[0].scrollIntoView({ block: "nearest" });
}
/** The source name of a control on the left: a static one carries it; a turn is named by its place in the transcript. */
function sourceOf(target: EventTarget | null): { control: HTMLElement; source: string } | undefined {
  if (!(target instanceof Element)) return;
  const control = target.closest<HTMLElement>("[data-source], .turn-text");
  if (!control) return;
  if (control.dataset["source"]) return { control, source: control.dataset["source"] };
  const article = control.closest<HTMLElement>("article");
  if (!article || article.hasAttribute("data-incomplete")) return;
  const live = [...$("transcript").querySelectorAll<HTMLElement>("article:not([data-incomplete])")];
  return { control, source: turnSource(live.indexOf(article)) };
}
for (const [element, source] of [[systemInput, "system"], [prompt, "draft"], [temperatureInput, "temperature"], [maxTokensInput, "maxTokens"], [reasoningInput, "reasoning"], [$("provider-button"), "provider"], [$("model-button"), "model"]] as const) element.dataset["source"] = source;
$("chat-panel").addEventListener("pointerover", (event) => { const hit = sourceOf(event.target); if (hit) spotlight(hit.source); });
$("chat-panel").addEventListener("pointerout", (event) => {
  const hit = sourceOf(event.target);
  if (hit && !(event.relatedTarget instanceof Node && hit.control.contains(event.relatedTarget))) spotlight(pinned);
});
$("chat-panel").addEventListener("focusin", (event) => { const hit = sourceOf(event.target); pinned = hit?.source; spotlight(pinned); });
$("chat-panel").addEventListener("focusout", (event) => { if (!sourceOf(event.relatedTarget)) { pinned = undefined; spotlight(undefined); } });

// ─── Chat ─────────────────────────────────────────────────────────────

/**
 * One turn of the transcript: a heading and the text, which is a textarea because every turn can be
 * rewritten — the next request is built from what the transcript says, not from what was once sent.
 * A turn that is streaming, or that failed, is read-only: it is not part of `messages`.
 */
function turn(who: string, text: string, role: "user" | "assistant" = who === "You" ? "user" : "assistant"): HTMLTextAreaElement {
  const article = document.createElement("article");
  article.dataset.role = role;
  const heading = document.createElement("div"); heading.className = "message-heading";
  const label = document.createElement("b"); label.textContent = who;
  const body = document.createElement("textarea"); body.className = "turn-text"; body.rows = 1; body.value = text; body.spellcheck = false;
  body.setAttribute("aria-label", `${who}: edit this ${role === "user" ? "message" : "reply"}`);
  body.addEventListener("input", () => { autosize(body); editTurn(article, body.value); });
  heading.append(label); article.append(heading, body); $("transcript").append(article);
  autosize(body);
  return body;
}
/** The transcript's live turns (not failed ones) are `messages`, in order: rewrite the one that changed. */
function editTurn(article: HTMLElement, value: string): void {
  const live = [...$("transcript").querySelectorAll<HTMLElement>("article:not([data-incomplete])")];
  const index = live.indexOf(article);
  const current = messages[index];
  if (!current) return;
  try {
    if (!value.trim()) throw new Error("empty");
    // The text is replaced; anything else the turn carried (reasoning, continuation state) stays as it was.
    const at = current.parts.findIndex((part) => part.type === "text");
    const kept = current.parts.filter((part) => part.type !== "text");
    const parts = [...kept.slice(0, Math.max(at, 0)), textPart(value), ...kept.slice(Math.max(at, 0))];
    messages = messages.with(index, Message.create({ role: current.role, parts, ...(current.continuation ? { continuation: current.continuation } : {}) }));
    transcriptError = ""; article.removeAttribute("data-invalid");
  } catch {
    transcriptError = "A turn cannot be empty. Put the text back, or start again with a new provider."; article.dataset["invalid"] = "true";
  }
  $("fidelity").textContent = "";
  updateControls(); void updateCode();
}

async function sendTurn(text: string): Promise<void> {
  if (active || loadingRuntime || !RUNTIMES[runtime].loaded()) return;
  if (!hasKey(connection.provider) && !keyless(connection.provider)) { openConnection(); notifyKey(`Add your ${currentChoice().label} API key to send a message.`); return; }
  if (!temperatureInput.reportValidity()) { temperatureInput.focus(); return; }
  if (!maxTokensInput.reportValidity()) { maxTokensInput.focus(); return; }
  if (!connection.model.trim()) { notify("Choose a model first."); return; }
  if (transcriptError) { notify(transcriptError); return; }
  const version = generation;
  const controller = new AbortController();
  active = controller; updateControls(); notify();
  const request = buildRequest(connection, settings, messages, text);
  const chosen = RUNTIMES[runtime];
  const asked = turn("You", text);
  const body = turn(`${currentChoice().label} · ${chosen.label}`, "");
  asked.readOnly = body.readOnly = true; body.placeholder = "Waiting for the provider…";
  body.parentElement!.classList.add("streaming");
  prompt.value = ""; autosize(prompt);
  if (matchMedia("(max-width: 1100px)").matches) setView("chat");
  scrollChat();
  const started = performance.now();
  let resend = false;
  try {
    const response = await chosen.stream(connection, credentials.get(connection.provider), request, controller.signal, (piece) => {
      if (version !== generation) return;
      const area = $("chat-scroll");
      const following = area.scrollHeight - area.scrollTop - area.clientHeight < 96;
      body.value += piece; autosize(body);
      if (following) scrollChat();
    });
    if (version !== generation) return;
    messages = [...request.messages, response.message];
    asked.readOnly = body.readOnly = false;
    const usage = response.usage;
    const adapted = response.adaptations.length ? ` · adapted: ${response.adaptations.map((a) => `${a.field} ${a.action}`).join(", ")}` : "";
    $("usage").textContent = `${response.finishReason} · input ${usage?.inputTokens ?? "unreported"} · output ${usage?.outputTokens ?? "unreported"} · ${Math.round(performance.now() - started)} ms · ${chosen.label}${adapted}`;
    $("usage").title = response.adaptations.map((a) => `${a.field}: ${a.reason}`).join("\n");
    void fidelity(request);
  } catch (error) {
    if (version !== generation) return;
    notify(controller.signal.aborted ? "Stopped. This incomplete turn is not included in the next request." : errorMessage(error));
    body.parentElement?.setAttribute("data-incomplete", "true");
    asked.parentElement?.setAttribute("data-incomplete", "true"); // neither turn is in `messages`
    if (!controller.signal.aborted && looksBrowserBlocked(error) && !relayed(connection.provider) && !keyless(connection.provider)) resend = await offerRelay();
  } finally {
    body.parentElement?.classList.remove("streaming"); body.placeholder = "";
    if (version === generation) { active = undefined; updateControls(); void updateCode(); }
  }
  if (resend && version === generation) {
    // The user allowed the relay: the failed turn leaves the transcript and the same text is sent again, through it.
    asked.parentElement?.remove();
    body.parentElement?.remove();
    void sendTurn(text);
  }
}

// ─── The relay (relay.ts) ─────────────────────────────────────────────

/** Ask once, in words, before any key goes through the relay. Resolves true when the user allowed it for this provider. */
function offerRelay(): Promise<boolean> {
  $("relay-provider").textContent = currentChoice().label;
  $("relay-unavailable").hidden = relayAvailable();
  $<HTMLButtonElement>("relay-allow").disabled = !relayAvailable();
  $<HTMLInputElement>("relay-remember").checked = false;
  return new Promise((resolve) => {
    const finish = (allowed: boolean) => {
      relayDialog.removeEventListener("close", onClose);
      if (allowed) { enableRelay(connection.provider, $<HTMLInputElement>("relay-remember").checked); refreshStatus(); }
      resolve(allowed);
    };
    const onClose = () => finish(relayDialog.returnValue === "allow");
    relayDialog.addEventListener("close", onClose);
    relayDialog.returnValue = "";
    relayDialog.showModal();
  });
}
$("relay-allow").addEventListener("click", () => relayDialog.close("allow"));
$("relay-cancel").addEventListener("click", () => relayDialog.close("cancel"));
$("relay-close").addEventListener("click", () => relayDialog.close("cancel"));
$("forget-relays").addEventListener("click", () => { disableAllRelays(); catalogues.clear(); refreshStatus(); });

// ─── Wiring ───────────────────────────────────────────────────────────

$("provider-button").addEventListener("click", () => picker.open("provider", connection.provider));
$("model-button").addEventListener("click", () => { picker.open("model", connection.model); if (automatic.checked) void discover(); });
// A textarea's natural height depends on its width and font: both change with the viewport.
addEventListener("resize", () => { for (const area of [prompt, systemInput, ...document.querySelectorAll<HTMLTextAreaElement>(".turn-text")]) autosize(area); });
moreMenu.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && moreMenu.open) { moreMenu.open = false; $("more-toggle").focus(); event.preventDefault(); }
});
moreMenu.addEventListener("focusout", (event) => { if (event.relatedTarget instanceof Node && !moreMenu.contains(event.relatedTarget)) moreMenu.open = false; });
document.addEventListener("click", (event) => { if (event.target instanceof Node && !moreMenu.contains(event.target)) moreMenu.open = false; });
$("retry-runtime").addEventListener("click", () => void selectRuntime(runtime));
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view-target]")) button.addEventListener("click", () => setView(button.dataset.viewTarget!));
$("forget").addEventListener("click", () => {
  for (const id of credentials.providers()) keyRevision.set(id, (keyRevision.get(id) ?? 0) + 1);
  void credentials.forgetAll().then(() => { catalogues.clear(); reset(); notify(); notifyKey(); refreshStatus(); });
});
$("toggle-code").addEventListener("click", () => setCodeCollapsed(document.body.dataset.code !== "collapsed"));
automatic.addEventListener("change", () => { refreshStatus(); if (automatic.checked) void discover(); });
$("list").addEventListener("click", () => void discover(true));
systemInput.addEventListener("input", () => { settings.system = systemInput.value; autosize(systemInput); void updateCode(); });
temperatureInput.addEventListener("input", () => {
  if (temperatureInput.validity.valid) settings.temperature = temperatureInput.value === "" ? null : temperatureInput.valueAsNumber;
  void updateCode();
});
maxTokensInput.addEventListener("input", () => { if (maxTokensInput.validity.valid) settings.maxTokens = maxTokensInput.value === "" ? null : maxTokensInput.valueAsNumber; void updateCode(); });
reasoningInput.addEventListener("change", () => { settings.reasoning = reasoningInput.value as Settings["reasoning"]; void updateCode(); });
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-code-view]")) button.addEventListener("click", () => { codeView = button.dataset.codeView as typeof codeView; void updateCode(); });
$("copy-code").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("code").textContent ?? ""); $("copy-status").textContent = "Copied"; $("copy-code").textContent = "Copied";
    clearTimeout(copyTimer); copyTimer = setTimeout(() => { $("copy-code").textContent = codeView === "request" ? "Copy request" : "Copy code"; }, 1800);
  }
  catch { $("copy-status").textContent = "Clipboard unavailable; select the code to copy it."; }
});
prompt.addEventListener("input", () => { autosize(prompt); updateControls(); void updateCode(); if (slashCommand(prompt.value)?.kind === "model" && automatic.checked) void discover(); });
prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing && !event.defaultPrevented) { event.preventDefault(); $<HTMLFormElement>("composer").requestSubmit(); }
});
$("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  if (picker.consume()) { void updateCode(); return; }
  const text = prompt.value.trim();
  if (text) void sendTurn(text);
});
stop.addEventListener("click", () => active?.abort());

// ─── Boot ─────────────────────────────────────────────────────────────

for (const { id, label } of LANGUAGES) {
  const tab = document.createElement("button"); tab.type = "button"; tab.dataset.language = id; tab.textContent = label; tab.setAttribute("aria-pressed", "false");
  tab.addEventListener("click", () => void selectRuntime(id));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = LANGUAGES.findIndex((item) => item.id === id);
    const next = event.key === "Home" ? 0 : event.key === "End" ? LANGUAGES.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + LANGUAGES.length) % LANGUAGES.length;
    const button = document.querySelector<HTMLButtonElement>(`[data-language="${LANGUAGES[next]!.id}"]`);
    if (button && !button.disabled) { button.focus(); button.click(); }
  });
  $("code-tabs").append(tab);
}
systemInput.value = DEFAULT_SETTINGS.system; autosize(systemInput);
maxTokensInput.value = "";
prompt.value = EXAMPLE_DRAFT; autosize(prompt);
reset();
judge = new JudgeView({
  connection,
  key: () => credentials.get(connection.provider),
  runtime: () => runtime,
  runtimes: RUNTIMES,
  runtimeReady: () => !loadingRuntime && RUNTIMES[runtime].loaded() && !active,
  runtimeLoading: () => (loadingRuntime ? `Loading ${RUNTIMES[runtime].label}…` : RUNTIMES[runtime].loaded() ? undefined : `${RUNTIMES[runtime].label} not loaded`),
  providerLabel: () => currentChoice().label,
  offerRelay,
  errorMessage,
  requireKey: () => {
    if (!hasKey(connection.provider) && !keyless(connection.provider)) { openConnection(); notifyKey(`Add your ${currentChoice().label} API key to judge.`); return false; }
    return true;
  },
  onBusy: () => updateControls(),
  pickProvider: () => picker.open("provider", connection.provider),
  pickModel: () => { picker.open("model", connection.model); if (automatic.checked) void discover(); },
  codeChanged: () => void updateCode(),
});
for (const button of document.querySelectorAll<HTMLButtonElement>(".mode-switch button")) button.addEventListener("click", () => { if (!button.disabled) setMode(button.dataset.mode as Mode, true); });
let remembered: string | null = null;
try { remembered = localStorage.getItem("lm15.playground.mode"); } catch { remembered = null; }
setMode(remembered === "judge" ? "judge" : "chat");
try { setCodeCollapsed(localStorage.getItem("lm15.playground.code") === "collapsed", false); } catch { setCodeCollapsed(false, false); }
try {
  const savedRuntime = localStorage.getItem("lm15.playground.runtime");
  const selected = LANGUAGES.find((item) => item.id === savedRuntime);
  if (selected) void selectRuntime(selected.id);
} catch { /* storage is optional */ }
$("remember-note").hidden = Credentials.available();
remember.disabled = !Credentials.available();
void credentials.load().then(() => { refreshStatus(); if (automatic.checked) void discover(); });
refreshStatus();

// Explicit, one-use local test handoff (npm run example:local). Keys never enter the code panel or persistent storage.
const token = new URLSearchParams(location.hash.slice(1)).get("local-test");
if (token) {
  history.replaceState(null, "", location.pathname + location.search);
  // Loopback, or a Tailscale address (100.64.0.0/10): the server refuses to hand keys over anywhere else too.
  const tailscale = /^100\.(\d+)\.\d+\.\d+$/.exec(location.hostname);
  const privateHost = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname) || (tailscale !== null && Number(tailscale[1]) >= 64 && Number(tailscale[1]) <= 127);
  if (!privateHost) notify("Local test credentials can only be loaded from localhost or a Tailscale address.");
  else void (async () => {
    try {
      const response = await fetch("/__lm15_test_credentials", { headers: { "X-LM15-Test-Token": token }, cache: "no-store" });
      if (!response.ok) throw new Error("Local test session expired. Restart the local demo to load keys.");
      const data = await response.json() as Record<string, string>;
      const rememberKeys = response.headers.get("X-LM15-Remember") === "1"; // the server was started with --remember-keys
      for (const choice of CONNECTIONS) { const key = data[choice.id]; if (typeof key === "string" && key) await credentials.set(choice.id, key, rememberKeys); }
      refreshStatus(); if (automatic.checked) void discover();
    } catch (error) { notify(errorMessage(error)); }
  })();
}


/**
 * Judge mode in the page: one state, the question form (a view over the
 * schema), one call, its result, the distribution popover, and what the
 * device remembers (the state and the questions; never a result).
 *
 * The rules are in judge.ts; this file only moves them onto the DOM.
 * The page's connection, key, runtime and relay are the host's (main.ts):
 * the two modes share one provider, one key, one set of language tabs.
 */

import { judgmentsInSchema, stringifyJson, type Judgment, type JsonObject, type JsonValue, type Request } from "@lm15/lm15/browser";
import { keyless, type Connection } from "./experience.ts";
import { comment, finish, type Code } from "./marks.ts";
import { EXAMPLE_SPEC, distribution, emptyState, exampleState, expectedLevel, freeName, judgeGo, judgeJavascript, judgePython, judgeRequest, judgeRust, parseProperties, parseStateObject, pickLabel, questionSource, readQuestions, stateIsBlank, verdictOf, withQuestion, withoutQuestion, type Echo, type JudgeSource, type JudgeSpec, type Option, type Question, type QuestionKind, type Shape, type StateValue, type Turn, type Verdict } from "./judge.ts";
import { looksBrowserBlocked, relayed } from "./relay.ts";
import type { Runtime, RuntimeId } from "./runtimes/index.ts";

export interface JudgeHost {
  readonly connection: Connection;
  key(): string | undefined;
  runtime(): RuntimeId;
  readonly runtimes: Readonly<Record<RuntimeId, Runtime>>;
  runtimeReady(): boolean;
  /** Why the runtime cannot run yet ("Loading Python…", "Go not loaded"), or nothing when it can: the Judge button says so. */
  runtimeLoading(): string | undefined;
  providerLabel(): string;
  /** Ask, in words, before any key goes through the relay; true when allowed for this provider. */
  offerRelay(): Promise<boolean>;
  errorMessage(error: unknown): string;
  /** A key must be present for this provider; the host says where and focuses it. */
  requireKey(): boolean;
  /** The run started or ended: the host locks what must not change mid-run (language tabs). */
  onBusy(busy: boolean): void;
  pickProvider(): void;
  pickModel(): void;
  /** The code panel must re-render (a question, the state or a setting changed). */
  codeChanged(): void;
  /** A textarea that is as tall as its text. */
  autosize(area: HTMLTextAreaElement): void;
}

const STORAGE = "lm15.playground.judge";
const STORAGE_VERSION = 2;
interface Stored { version: number; spec: JudgeSpec; state: Record<Shape, StateValue>; raw: boolean }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pct = (p: number) => `${Math.round(p * 100)}%`;

export class JudgeView {
  private spec: JudgeSpec = { ...EXAMPLE_SPEC };
  /** Each shape keeps its own state: switching shapes never loses what was typed. */
  private states: Record<Shape, StateValue> = { text: exampleState("text"), fields: exampleState("fields"), conversation: exampleState("conversation") };
  /** The `fields` state as typed, when it does not parse yet; the last good object stands in `states.fields`. */
  private objectError: string | undefined;
  private rawText = "";
  private rawMode = false;
  private outView: "answers" | "json" = "answers";
  private verdict: Verdict | undefined;
  /** The state or the questions changed since the verdict: it is shown greyed, and not echoed in the code. */
  private stale = false;
  private error: string | undefined;
  private running: AbortController | undefined;
  private generation = 0;
  private readonly host: JudgeHost;
  private lastProvider = "";

  constructor(host: JudgeHost) {
    this.host = host;
    this.restore();
    this.wire();
    this.renderAll();
  }

  private get state(): StateValue { return this.states[this.spec.shape]; }

  // ─── What the host asks ──────────────────────────────────────────

  /** The code panel's text for the current language: one call, with the answer echoed once there is one. */
  code(runtime: RuntimeId): Code {
    const error = this.questionsError() ?? this.stateError();
    if (error) return finish(comment(`// ${error}`));
    const echo: Echo | undefined = this.verdict && !this.stale ? { data: this.verdict.data, ...(this.verdict.probabilities ? { probabilities: this.verdict.probabilities } : {}), adaptations: this.verdict.adaptations } : undefined;
    if (runtime === "javascript") return judgeJavascript(this.host.connection, this.spec, this.state, echo);
    if (runtime === "python") return judgePython(this.host.connection, this.spec, this.state, echo);
    if (runtime === "go") return judgeGo(this.host.connection, this.spec, this.state, echo);
    return judgeRust(this.host.connection, this.spec, this.state, echo);
  }

  busy(): boolean { return this.running !== undefined; }

  /** The request the state makes, for the Request view; and what it was built from. */
  currentRequest(): { request: Request; source: JudgeSource; label: string } | undefined {
    if (this.questionsError() || this.stateError()) return undefined;
    return { request: judgeRequest(this.host.connection, this.spec, this.state), source: { spec: this.spec, value: this.state }, label: "this state" };
  }

  /** The provider, model, key or runtime changed. */
  refresh(): void {
    const provider = this.host.connection.provider;
    if (provider !== this.lastProvider) { this.lastProvider = provider; this.renderHint(); }
    $("judge-provider-name").textContent = this.host.providerLabel();
    $("judge-model-name").textContent = this.host.connection.model || "Choose model";
    $("judge-provider-button").title = this.host.providerLabel();
    $("judge-model-button").title = this.host.connection.model;
    this.renderRun();
  }

  /** The panel became visible or changed width: its textareas take the height of their text. */
  layout(): void { for (const ta of $("judge-panel").querySelectorAll("textarea")) this.host.autosize(ta); }

  /** Start over: the example question over the example state, no result. */
  reset(): void {
    this.running?.abort();
    this.spec = { ...EXAMPLE_SPEC };
    this.states = { text: exampleState("text"), fields: exampleState("fields"), conversation: exampleState("conversation") };
    this.objectError = undefined; this.rawMode = false; this.rawText = stringifyJson(this.spec.properties, { indent: 2 });
    this.verdict = undefined; this.stale = false; this.error = undefined;
    this.showAlert(); this.persist(); this.renderAll(); this.host.codeChanged();
  }

  // ─── Persistence ─────────────────────────────────────────────────

  private restore(): void {
    let stored: Stored | undefined;
    try { const text = localStorage.getItem(STORAGE); if (text) stored = JSON.parse(text) as Stored; } catch { stored = undefined; }
    if (stored?.version === STORAGE_VERSION && stored.spec && stored.state) {
      this.spec = { properties: stored.spec.properties, shape: stored.spec.shape };
      for (const shape of ["text", "fields", "conversation"] as const) if (stored.state[shape] !== undefined) this.states[shape] = stored.state[shape];
      this.rawMode = Boolean(stored.raw);
    }
    this.rawText = stringifyJson(this.spec.properties, { indent: 2 });
  }

  private persist(): void {
    const data: Stored = { version: STORAGE_VERSION, spec: this.spec, state: this.states, raw: this.rawMode };
    try { localStorage.setItem(STORAGE, JSON.stringify(data)); } catch { /* storage full or disabled: the page still works for this visit */ }
  }

  // ─── Questions ───────────────────────────────────────────────────

  private judgments(): Judgment[] {
    return [...judgmentsInSchema({ type: "object", properties: this.spec.properties }).values()];
  }

  private questionsError(): string | undefined {
    try { parseProperties(this.rawMode ? this.rawText : stringifyJson(this.spec.properties)); return undefined; }
    catch (e) { return (e as Error).message; }
  }

  private setProperties(properties: JsonObject): void {
    this.spec = { ...this.spec, properties };
    this.rawText = stringifyJson(properties, { indent: 2 });
    this.changed();
  }

  /** The state or the questions changed: a result on record is from before. */
  private changed(): void {
    if (this.verdict) this.stale = true;
    this.persist();
    this.renderResult();
    this.renderRun();
    this.host.codeChanged();
  }

  private renderQuestions(): void {
    const list = $("judge-question-list");
    const { questions, opaque } = readQuestions(this.spec.properties);
    list.replaceChildren(...questions.map((q) => this.questionCard(q)));
    if (opaque.length) {
      const note = document.createElement("p"); note.className = "setting-help";
      note.textContent = `${opaque.join(", ")}: not a judgment the form can show; kept as written. Edit it as JSON.`;
      list.append(note);
    }
    const raw = $("judge-raw"); raw.hidden = !this.rawMode;
    list.hidden = this.rawMode; $("judge-add-question").hidden = this.rawMode;
    const toggle = $("judge-raw-toggle"); toggle.textContent = this.rawMode ? "☰ Form" : "{ } JSON"; toggle.setAttribute("aria-pressed", String(this.rawMode));
    if (this.rawMode) { const ta = $<HTMLTextAreaElement>("judge-raw-json"); if (ta.value !== this.rawText) ta.value = this.rawText; this.renderRawStatus(); }
    const error = this.questionsError();
    $("judge-questions-error").hidden = !error || this.rawMode;
    $("judge-questions-error").textContent = error ?? "";
    document.body.dataset.judgeRaw = String(this.rawMode);
  }

  /** How a question can point into a structured state; nothing to say for a text. */
  private renderHint(): void {
    const hint = $("judge-paths-hint");
    hint.hidden = this.spec.shape === "text";
    const field = Object.keys(this.spec.shape === "fields" ? (this.state as Record<string, JsonValue>) : {})[0] ?? "note";
    hint.replaceChildren(...(this.spec.shape === "fields"
      ? this.hintNodes("A question can point at a field with backticks, e.g. ", `\`${field}\``, ". Without a path, Jev reads the whole object; a chat model gets the object as JSON text.")
      : this.hintNodes("On Jev the transcript is the state's `messages` array: a question can point at a turn with backticks, e.g. ", "`messages[1].content`", ". A chat model gets the turns as its conversation.")));
  }

  private hintNodes(before: string, code: string, after: string): Node[] {
    const c = document.createElement("code"); c.textContent = code;
    return [document.createTextNode(before), c, document.createTextNode(after)];
  }

  private renderRawStatus(): void {
    const status = $("judge-raw-status");
    try {
      const properties = parseProperties(this.rawText);
      const n = judgmentsInSchema({ type: "object", properties }).size;
      status.textContent = `✓ valid · ${n} judgment${n === 1 ? "" : "s"}`; status.className = "ok";
      $<HTMLTextAreaElement>("judge-raw-json").setAttribute("aria-invalid", "false");
    } catch (e) {
      status.textContent = (e as Error).message; status.className = "bad";
      $<HTMLTextAreaElement>("judge-raw-json").setAttribute("aria-invalid", "true");
    }
  }

  private questionCard(q: Question): HTMLElement {
    const card = document.createElement("details"); card.className = "question"; card.dataset.name = q.name; card.dataset.source = questionSource(q.name);
    if (this.openCards.has(q.name)) card.open = true;
    card.addEventListener("toggle", () => { if (card.open) this.openCards.add(q.name); else this.openCards.delete(q.name); });
    const summary = document.createElement("summary");
    const name = document.createElement("span"); name.className = "qname"; name.textContent = q.name;
    const kind = document.createElement("span"); kind.className = "qkind";
    kind.textContent = q.kind === "yesNo" ? "yes / no" : q.kind === "choice" ? `choice · ${q.options.length} option${q.options.length === 1 ? "" : "s"}` : `scale · ${q.options.length} level${q.options.length === 1 ? "" : "s"}`;
    summary.append(name, kind);
    const body = document.createElement("div"); body.className = "qbody";
    // Typing follows into the code at once (`live`, the card kept as it is); leaving the field settles it (`replaceQuestion`, the card re-drawn).
    let current = q;
    const badge = (c: Question) => { kind.textContent = c.kind === "yesNo" ? "yes / no" : c.kind === "choice" ? `choice · ${c.options.length} option${c.options.length === 1 ? "" : "s"}` : `scale · ${c.options.length} level${c.options.length === 1 ? "" : "s"}`; };
    const live = (next: Question): boolean => {
      if (next.name !== current.name && next.name in this.spec.properties) return false; // a taken name settles on blur, renamed apart
      let properties: JsonObject;
      try { properties = withQuestion(this.spec.properties, current.name, next); } catch { return false; } // the SDK refused the shape for now
      if (next.name !== current.name) { this.openCards.delete(current.name); this.openCards.add(next.name); card.dataset.name = next.name; card.dataset.source = questionSource(next.name); name.textContent = next.name; }
      current = next; badge(next);
      this.spec = { ...this.spec, properties }; this.rawText = stringifyJson(properties, { indent: 2 });
      if (this.verdict) this.stale = true;
      this.persist(); this.renderResult(); this.renderRun(); this.host.codeChanged(); this.showAlert();
      return true;
    };
    // Settling (blur) re-draws the card only when typing could not be applied as it went: a taken name gets a free one, a refused shape its reason.
    const settle = (next: Question) => { if (!live(next)) this.replaceQuestion(current.name, next); };
    const field = (label: string, value: string, apply: (q: Question, v: string) => Question, mono = false) => {
      const wrap = document.createElement("label"); wrap.className = "field"; wrap.textContent = label;
      const input = document.createElement("input"); input.value = value; if (mono) input.className = "mono";
      input.addEventListener("input", () => live(apply(current, input.value)));
      input.addEventListener("change", () => settle(apply(current, input.value)));
      wrap.append(input); return wrap;
    };
    body.append(field("Name", q.name, (c, v) => ({ ...c, name: v.trim() || c.name }), true));
    body.append(field("Question", q.question, (c, v) => ({ ...c, question: v })));
    if (q.kind !== "yesNo") {
      const label = document.createElement("p"); label.className = "field"; label.textContent = q.kind === "choice" ? "Options (key · optional description)" : "Levels, worst to best (title · optional description)";
      const list = document.createElement("ol"); list.className = "levels";
      // The rows are the form's: a blank row stays until it is filled or removed; the schema only ever holds the filled ones.
      const read = (): Option[] => [...list.querySelectorAll("li")].map((li) => ({ key: li.querySelector<HTMLInputElement>("input.key")!.value, description: li.querySelector<HTMLInputElement>("input.desc")!.value }));
      const apply = () => settle({ ...current, options: read() });
      const typed = () => live({ ...current, options: read() });
      const row = (o: Option, i: number) => {
        const li = document.createElement("li");
        const n = document.createElement("span"); n.className = "n"; n.textContent = q.kind === "score" ? String(i) : "";
        const key = document.createElement("input"); key.value = o.key; key.placeholder = q.kind === "choice" ? "key" : "title"; key.className = "key"; key.setAttribute("aria-label", `${q.kind === "choice" ? "Option" : "Level"} ${i + 1} ${q.kind === "choice" ? "key" : "title"}`);
        const desc = document.createElement("input"); desc.value = o.description; desc.placeholder = "description"; desc.className = "desc"; desc.setAttribute("aria-label", `${q.kind === "choice" ? "Option" : "Level"} ${i + 1} description`);
        key.addEventListener("input", typed); desc.addEventListener("input", typed);
        key.addEventListener("change", apply); desc.addEventListener("change", apply);
        const x = document.createElement("button"); x.type = "button"; x.className = "x"; x.textContent = "×"; x.title = "Remove"; x.setAttribute("aria-label", `Remove ${q.kind === "choice" ? "option" : "level"} ${i + 1}`);
        x.addEventListener("click", () => { li.remove(); apply(); });
        li.append(n, key, desc, x); return li;
      };
      q.options.forEach((o, i) => list.append(row(o, i)));
      const add = document.createElement("button"); add.type = "button"; add.className = "text-button"; add.textContent = q.kind === "choice" ? "+ option" : "+ level";
      add.addEventListener("click", () => { const li = row({ key: "", description: "" }, list.children.length); list.append(li); li.querySelector("input")!.focus(); });
      body.append(label, list, add);
    }
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button warm remove-question"; remove.textContent = "Remove question";
    remove.addEventListener("click", () => { this.openCards.delete(q.name); this.setProperties(withoutQuestion(this.spec.properties, q.name)); this.renderQuestions(); });
    body.append(remove);
    card.append(summary, body);
    return card;
  }
  private readonly openCards = new Set<string>();

  private replaceQuestion(previous: string, q: Question): void {
    if (q.name !== previous && q.name in this.spec.properties) q = { ...q, name: freeName(this.spec.properties, q.name) };
    try {
      if (previous !== q.name) { this.openCards.delete(previous); this.openCards.add(q.name); }
      this.setProperties(withQuestion(this.spec.properties, previous, q));
      this.showAlert();
    } catch (e) {
      // The SDK refused the shape (a scale with one level, a choice with none): the last valid schema stands and the reason is shown; the form keeps what was typed.
      this.showAlert((e as Error).message);
      return;
    }
    this.renderQuestions();
  }

  private addQuestion(kind: QuestionKind): void {
    const name = freeName(this.spec.properties, kind === "yesNo" ? "flag" : kind === "choice" ? "category" : "rating");
    const q: Question = kind === "yesNo" ? { name, kind, question: "", options: [] }
      : kind === "choice" ? { name, kind, question: "", options: [{ key: "a", description: "" }, { key: "b", description: "" }] }
      : { name, kind, question: "", options: [{ key: "low", description: "" }, { key: "medium", description: "" }, { key: "high", description: "" }] };
    this.openCards.add(name);
    this.setProperties(withQuestion(this.spec.properties, undefined, q));
    this.renderQuestions();
    $("judge-question-list").querySelector<HTMLInputElement>(`[data-name="${CSS.escape(name)}"] input`)?.select();
  }

  // ─── The state ───────────────────────────────────────────────────

  private setShape(shape: Shape): void {
    if (shape === this.spec.shape) return;
    this.spec = { ...this.spec, shape };
    for (const b of document.querySelectorAll<HTMLButtonElement>("#judge-shape button")) b.setAttribute("aria-pressed", String(b.dataset.shape === shape));
    this.renderState(); this.renderHint();
    this.changed();
  }

  private stateError(): string | undefined {
    if (this.spec.shape === "fields" && this.objectError) return this.objectError;
    if (stateIsBlank(this.state)) return "The state is empty: type something to judge.";
    return undefined;
  }

  private setState(value: StateValue): void {
    this.states[this.spec.shape] = value;
    this.error = undefined;
    this.changed();
  }

  /** The editor for the shape: a text, a JSON object, or a transcript of turns. */
  private renderState(): void {
    const el = $("judge-state");
    const value = this.state;
    if (typeof value === "string") {
      const ta = document.createElement("textarea"); ta.id = "judge-state-text"; ta.className = "state-text"; ta.rows = 1; ta.value = value; ta.placeholder = "The text to judge"; ta.setAttribute("aria-label", "State");
      ta.addEventListener("input", () => { this.host.autosize(ta); this.setState(ta.value); });
      el.replaceChildren(ta); this.host.autosize(ta);
    } else if (Array.isArray(value)) {
      const turns = value as readonly Turn[];
      const convo = document.createElement("div"); convo.className = "convo";
      turns.forEach((t, k) => {
        const msg = document.createElement("div"); msg.className = "msg";
        const role = document.createElement("span"); role.className = `role ${t.role}`; role.textContent = t.role;
        const ta = document.createElement("textarea"); ta.rows = 1; ta.value = t.content; ta.setAttribute("aria-label", `${t.role} turn ${k + 1}`);
        ta.addEventListener("input", () => { this.host.autosize(ta); this.setState(turns.map((x, j) => (j === k ? { ...x, content: ta.value } : x))); });
        const x = document.createElement("button"); x.type = "button"; x.className = "x"; x.textContent = "×"; x.setAttribute("aria-label", `Remove turn ${k + 1}`);
        x.addEventListener("click", () => { this.setState(turns.filter((_, j) => j !== k)); this.renderState(); });
        msg.append(role, ta, x); convo.append(msg);
      });
      const add = document.createElement("div"); add.className = "add-msg"; add.textContent = "+ ";
      for (const role of ["user", "assistant"] as const) {
        const b = document.createElement("button"); b.type = "button"; b.className = "text-button"; b.textContent = role;
        b.addEventListener("click", () => { this.setState([...turns, { role, content: "" }]); this.renderState(); $("judge-state").querySelector<HTMLTextAreaElement>(".msg:last-of-type textarea")?.focus(); });
        add.append(b, document.createTextNode(role === "user" ? " · " : ""));
      }
      convo.append(add); el.replaceChildren(convo);
      for (const ta of el.querySelectorAll("textarea")) this.host.autosize(ta);
    } else {
      const ta = document.createElement("textarea"); ta.id = "judge-state-json"; ta.className = "state-json"; ta.rows = 1; ta.spellcheck = false; ta.value = stringifyJson(value, { indent: 2 }); ta.setAttribute("aria-label", "State (JSON object)");
      ta.addEventListener("input", () => {
        this.host.autosize(ta);
        try { const object = parseStateObject(ta.value); this.objectError = undefined; ta.setAttribute("aria-invalid", "false"); this.setState(object); }
        catch (e) { this.objectError = (e as Error).message; ta.setAttribute("aria-invalid", "true"); this.changed(); }
      });
      el.replaceChildren(ta); this.host.autosize(ta);
    }
  }

  // ─── The result ──────────────────────────────────────────────────

  private renderResult(): void {
    const section = $("judge-result");
    const v = this.verdict;
    section.hidden = !v && !this.error;
    const note = $("judge-result-note");
    const answers = $("judge-answers");
    section.classList.toggle("stale", this.stale);
    if (!v) { answers.replaceChildren(); note.hidden = !this.error; note.textContent = this.error ?? ""; note.className = "out-meta bad"; $("judge-method").textContent = ""; return; }
    note.className = "out-meta";
    $("judge-method").textContent = `${v.provider} · ${v.model} · ${v.method ? v.method.replace(/_/g, " ") : "pick only — this wire does not measure a distribution"}`;
    if (this.outView === "json") {
      const pre = document.createElement("pre"); pre.textContent = stringifyJson({ data: v.data as JsonObject, ...(v.probabilities ? { probabilities: v.probabilities as unknown as JsonObject } : {}), ...(v.method ? { method: v.method } : {}), adaptations: v.adaptations.map((a) => ({ ...a })) }, { indent: 2 });
      answers.replaceChildren(pre);
    } else {
      const grid = document.createElement("div"); grid.className = "answers";
      for (const j of this.judgments()) {
        const ans = document.createElement("div"); ans.className = "ans";
        const name = document.createElement("span"); name.className = "q"; name.textContent = j.name;
        const line = document.createElement("div"); line.className = "line";
        const dist = distribution(j, v);
        if (dist) line.append(this.spark(j, dist, v));
        const pick = document.createElement("span"); pick.className = "pick"; pick.textContent = pickLabel(j, v.data[j.name]);
        const p = document.createElement("span"); p.className = "p";
        if (dist) {
          const top = Math.max(...dist.map((d) => d.p));
          const expected = expectedLevel(j, v);
          p.textContent = pct(top) + (expected !== undefined ? ` · expected ${expected.toFixed(1)}` : "");
        } else p.textContent = "pick only";
        pick.append(p); line.append(pick); ans.append(name, line); grid.append(ans);
      }
      answers.replaceChildren(grid);
    }
    const formatDropped = v.adaptations.some((a) => a.field === "config.response_format" && a.action === "dropped");
    const parts = [
      ...(this.stale ? ["from the previous state or questions · judge again"] : []),
      ...(formatDropped ? ["not a judgment: this wire took no schema, so the questions never reached the model; the text above happened to parse"] : []),
      ...v.adaptations.map((a) => `adapted: ${a.field} ${a.action}`),
    ];
    note.hidden = !parts.length; note.textContent = parts.join(" · "); note.className = formatDropped ? "out-meta bad" : "out-meta";
    note.title = v.adaptations.map((a) => `${a.field}: ${a.reason}`).join("\n");
    for (const b of document.querySelectorAll<HTMLButtonElement>("#judge-out-view button")) b.setAttribute("aria-pressed", String(b.dataset.view === this.outView));
  }

  private spark(j: Judgment, dist: Array<{ key: string; label: string; p: number }>, v: Verdict): HTMLElement {
    const el = document.createElement("span"); el.className = `spark ${j.kind}`; el.tabIndex = 0;
    const top = dist.reduce((best, d, i) => d.p > dist[best]!.p ? i : best, 0);
    const max = Math.max(...dist.map((d) => d.p), 1e-9);
    el.setAttribute("aria-label", `${j.name}: ${dist.map((d) => `${d.label} ${pct(d.p)}`).join(", ")}`);
    dist.forEach((d, i) => { const bar = document.createElement("i"); bar.style.height = `${Math.max(2, Math.round(d.p / max * 24))}px`; if (i === top) bar.className = "top"; bar.dataset.i = String(i); el.append(bar); });
    const show = (hi: number) => this.showPop(el, j, dist, v, hi);
    el.addEventListener("mouseover", (e) => show(e.target instanceof HTMLElement && e.target.dataset.i !== undefined ? Number(e.target.dataset.i) : -1));
    el.addEventListener("mouseleave", () => this.hidePop());
    el.addEventListener("focus", () => show(-1));
    el.addEventListener("blur", () => this.hidePop());
    el.addEventListener("click", (e) => { e.stopPropagation(); if ($("judge-pop").hidden) show(-1); else this.hidePop(); });
    el.addEventListener("keydown", (e) => { if (e.key === "Escape") { this.hidePop(); } });
    return el;
  }

  private showPop(anchor: HTMLElement, j: Judgment, dist: Array<{ key: string; label: string; p: number }>, v: Verdict, hi: number): void {
    const pop = $("judge-pop");
    const top = dist.reduce((best, d, i) => d.p > dist[best]!.p ? i : best, 0);
    const max = Math.max(...dist.map((d) => d.p), 1e-9);
    const head = document.createElement("div"); head.className = "ph"; head.textContent = `${j.name} · ${v.method ? v.method.replace(/_/g, " ") : "measured"}`;
    pop.replaceChildren(head, ...dist.map((d, i) => {
      const row = document.createElement("div"); row.className = `pr${i === top ? " top" : ""}${i === hi ? " hover" : ""}`;
      const k = document.createElement("span"); k.className = "k";
      if (j.kind === "ordered") { const n = document.createElement("span"); n.className = "n"; n.textContent = String(i); k.append(n); }
      k.append(document.createTextNode(d.label));
      const bar = document.createElement("i"); bar.style.width = `${d.p / max * 100}%`;
      const b = document.createElement("b"); b.textContent = pct(d.p);
      row.append(k, bar, b); return row;
    }));
    const expected = expectedLevel(j, v);
    if (expected !== undefined) { const foot = document.createElement("div"); foot.className = "pf"; foot.textContent = `expected level ${expected.toFixed(2)} of 0–${dist.length - 1} · Σ p·i`; pop.append(foot); }
    for (const bar of anchor.querySelectorAll("i")) bar.classList.toggle("hover", bar.dataset.i === String(hi));
    pop.hidden = false;
    const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    let x = r.left, y = r.top - h - 8;
    if (y < 8) y = r.bottom + 8;
    if (x + w > innerWidth - 8) x = innerWidth - 8 - w;
    pop.style.left = `${Math.max(8, x)}px`; pop.style.top = `${y}px`;
  }

  private hidePop(): void {
    $("judge-pop").hidden = true;
    for (const bar of document.querySelectorAll(".spark i.hover")) bar.classList.remove("hover");
  }

  // ─── The run ─────────────────────────────────────────────────────

  private renderRun(): void {
    const run = $<HTMLButtonElement>("judge-run");
    const loading = this.host.runtimeLoading();
    const why = this.questionsError() ?? this.stateError();
    run.textContent = this.running ? "Judging…" : loading ?? "Judge";
    run.disabled = Boolean(this.running) || !this.host.runtimeReady() || Boolean(why);
    run.title = why ?? "";
    $("judge-state-error").hidden = !(this.spec.shape === "fields" && this.objectError);
    $("judge-state-error").textContent = this.objectError ?? "";
    $<HTMLButtonElement>("judge-stop").disabled = !this.running;
    const v = this.verdict;
    const tokens = v && (v.inputTokens !== undefined || v.outputTokens !== undefined) ? ` · input ${v.inputTokens ?? "unreported"} · output ${v.outputTokens ?? "unreported"}` : "";
    $("judge-usage").textContent = v && !this.stale ? `judged${tokens} · ${v.ms} ms · ${v.runtime}` : "";
  }

  private showAlert(text = ""): void { const el = $("judge-alert"); el.textContent = text; el.hidden = !text; }

  /** One call over the state. */
  async run(): Promise<void> {
    if (this.running || !this.host.runtimeReady()) return;
    const why = this.questionsError() ?? this.stateError();
    if (why) { this.showAlert(why); return; }
    if (!this.host.requireKey()) return;
    if (!this.host.connection.model.trim()) { this.showAlert("Choose a model first."); return; }
    const controller = new AbortController();
    const generation = ++this.generation;
    this.running = controller; this.host.onBusy(true); this.showAlert(); this.error = undefined; this.renderRun();
    const runtime = this.host.runtimes[this.host.runtime()];
    const connection = { ...this.host.connection };
    const value = this.state, spec = this.spec;
    const request = judgeRequest(connection, spec, value);
    const started = performance.now();
    try {
      const response = await runtime.judge(connection, this.host.key(), request, controller.signal, { spec, value });
      if (generation !== this.generation) return;
      this.verdict = verdictOf(response, { ms: Math.round(performance.now() - started), provider: connection.provider, model: connection.model, runtime: runtime.label });
      this.stale = false; this.error = undefined;
    } catch (e) {
      if (generation !== this.generation) return;
      if (controller.signal.aborted) { this.showAlert("Stopped."); return; }
      if (looksBrowserBlocked(e) && !relayed(connection.provider) && !keyless(connection.provider) && await this.host.offerRelay()) {
        // Allowed: the same call again, through the relay.
        this.running = undefined; this.host.onBusy(false); this.renderRun();
        return void this.run();
      }
      this.error = this.host.errorMessage(e);
      this.showAlert(this.error);
    } finally {
      if (generation === this.generation) { this.running = undefined; this.host.onBusy(false); this.renderResult(); this.renderRun(); this.host.codeChanged(); }
    }
  }

  // ─── Wiring ──────────────────────────────────────────────────────

  private renderAll(): void {
    for (const b of document.querySelectorAll<HTMLButtonElement>("#judge-shape button")) b.setAttribute("aria-pressed", String(b.dataset.shape === this.spec.shape));
    $<HTMLTextAreaElement>("judge-raw-json").value = this.rawText;
    this.renderQuestions(); this.renderState(); this.renderHint(); this.renderResult(); this.renderRun();
  }

  private wire(): void {
    $("judge-run").addEventListener("click", () => void this.run());
    $("judge-stop").addEventListener("click", () => this.running?.abort());
    $("judge-provider-button").addEventListener("click", () => this.host.pickProvider());
    $("judge-model-button").addEventListener("click", () => this.host.pickModel());
    $("judge-shape").addEventListener("click", (e) => { const b = (e.target as Element).closest<HTMLButtonElement>("button[data-shape]"); if (b) this.setShape(b.dataset.shape as Shape); });
    $("judge-out-view").addEventListener("click", (e) => { const b = (e.target as Element).closest<HTMLButtonElement>("button[data-view]"); if (b) { this.outView = b.dataset.view as "answers" | "json"; this.renderResult(); } });
    $("judge-raw-toggle").addEventListener("click", () => {
      if (this.rawMode) {
        // Leaving JSON: the text must parse, or the form would show a stale schema.
        try { this.setProperties(parseProperties(this.rawText)); } catch (e) { this.renderRawStatus(); this.showAlert(`Fix the JSON first: ${(e as Error).message}`); return; }
      }
      this.rawMode = !this.rawMode; this.persist(); this.renderQuestions();
      if (this.rawMode) $("judge-raw-json").focus();
    });
    const raw = $<HTMLTextAreaElement>("judge-raw-json");
    raw.addEventListener("input", () => {
      this.rawText = raw.value; this.renderRawStatus();
      try { const properties = parseProperties(this.rawText); if (stringifyJson(properties) !== stringifyJson(this.spec.properties)) { this.spec = { ...this.spec, properties }; if (this.verdict) this.stale = true; this.persist(); this.renderResult(); this.renderRun(); } } catch { /* the status line says why; the last valid schema stands */ }
      this.host.codeChanged();
    });
    $("judge-raw-format").addEventListener("click", () => { try { this.rawText = stringifyJson(parseProperties(this.rawText), { indent: 2 }); raw.value = this.rawText; this.renderRawStatus(); } catch { /* status shows the error */ } });
    $<HTMLSelectElement>("judge-add-question").addEventListener("change", (e) => { const select = e.target as HTMLSelectElement; if (select.value) this.addQuestion(select.value as QuestionKind); select.value = ""; });
    document.addEventListener("click", (e) => { if (!(e.target instanceof Element && e.target.closest(".spark, #judge-pop"))) this.hidePop(); });
    $("judge-panel").querySelector(".chat-scroll")!.addEventListener("scroll", () => this.hidePop(), { passive: true });
  }
}

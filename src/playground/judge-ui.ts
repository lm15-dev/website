/**
 * Judge mode in the page: the question form (a view over the schema),
 * the inputs and their outputs as one table, the run loop, the
 * distribution popover, the exports, and what the device remembers.
 *
 * The rules are in judge.ts; this file only moves them onto the DOM.
 * The page's connection, key, runtime and relay are the host's (main.ts):
 * the two modes share one provider, one key, one set of language tabs.
 */

import { judgmentsInSchema, stringifyJson, type Judgment, type JsonObject, type JsonValue, type Request } from "lm15/browser";
import { keyless, type Connection } from "./experience.ts";
import { JEV_INSTRUCTIONS_KEY, JEV_TEXT_KEY, jevState, EXAMPLE_INPUTS, EXAMPLE_SPEC, EXAMPLE_FIELDS, distribution, emptyInput, expectedLevel, fieldText, fieldValue, freeName, inputIsBlank, inputSummary, judgeJavascript, judgePython, judgeRequest, judgeRust, parseCsv, parseInputs, parseProperties, pickLabel, readQuestions, toCsv, toJsonExport, verdictOf, withQuestion, withoutQuestion, type FieldDef, type InputValue, type JudgeSource, type JudgeSpec, type Option, type Question, type QuestionKind, type Shape, type Turn, type Verdict } from "./judge.ts";
import { looksBrowserBlocked, relayed } from "./relay.ts";
import type { Runtime, RuntimeId } from "./runtimes/index.ts";

export interface JudgeHost {
  readonly connection: Connection;
  key(): string | undefined;
  runtime(): RuntimeId;
  readonly runtimes: Readonly<Record<RuntimeId, Runtime>>;
  runtimeReady(): boolean;
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
  /** The code panel must re-render (a question, input or setting changed). */
  codeChanged(): void;
}

interface Row {
  readonly id: number;
  value: InputValue;
  verdict?: Verdict;
  error?: string;
  /** The value changed since its verdict, or it was never judged. */
  stale: boolean;
}

const STORAGE = "lm15.playground.judge";
const STORAGE_VERSION = 1;
type StoredRow = { value: InputValue; verdict?: Verdict };
interface Stored { version: number; spec: JudgeSpec; rows: Record<Shape, StoredRow[]>; raw: boolean; results: boolean }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pct = (p: number) => `${Math.round(p * 100)}%`;
const grow = (ta: HTMLTextAreaElement) => { ta.style.height = "auto"; ta.style.height = `${ta.scrollHeight}px`; };

export class JudgeView {
  private spec: JudgeSpec = { ...EXAMPLE_SPEC };
  private rows: Row[] = [];
  /** Each shape keeps its own inputs: switching shapes never loses a row. */
  private shelved: Record<Shape, Row[]> = { text: [], fields: [], conversation: [] };
  private nextId = 1;
  private rawText = "";
  private rawMode = false;
  private outView: "answers" | "json" = "answers";
  private selected: number | undefined;
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

  // ─── What the host asks ──────────────────────────────────────────

  /** The code panel's text for the current language: the whole set, one loop. */
  code(runtime: RuntimeId): string {
    const error = this.questionsError();
    if (error) return `// ${error}`;
    const inputs = this.rows.map((r) => r.value);
    if (runtime === "javascript") return judgeJavascript(this.host.connection, this.spec, inputs);
    if (runtime === "python") return judgePython(this.host.connection, this.spec, inputs);
    return judgeRust();
  }

  busy(): boolean { return this.running !== undefined; }

  /** The request one input makes — the selected row, else the first — for the Request view; which one it is, in words; and what it was built from. */
  currentRequest(): { request: Request; source: JudgeSource; label: string } | undefined {
    const rows = this.rows.filter((r) => !inputIsBlank(r.value));
    const row = rows.find((r) => r.id === this.selected) ?? rows[0];
    if (!row) return undefined;
    return { request: judgeRequest(this.host.connection, this.spec, row.value), source: { spec: this.spec, value: row.value }, label: `input ${this.rows.indexOf(row) + 1} of ${this.rows.length}` };
  }

  /** The provider, model, key or runtime changed. */
  refresh(): void {
    const provider = this.host.connection.provider;
    if (provider !== this.lastProvider) { this.lastProvider = provider; this.renderQuestions(); }
    $("judge-provider-name").textContent = this.host.providerLabel();
    $("judge-model-name").textContent = this.host.connection.model || "Choose model";
    $("judge-provider-button").title = this.host.providerLabel();
    $("judge-model-button").title = this.host.connection.model;
    this.renderCounts();
  }

  // ─── Persistence ─────────────────────────────────────────────────

  private restore(): void {
    let stored: Stored | undefined;
    try { const text = localStorage.getItem(STORAGE); if (text) stored = JSON.parse(text) as Stored; } catch { stored = undefined; }
    const thaw = (rows: StoredRow[] | undefined): Row[] => (rows ?? []).map((r) => ({ id: this.nextId++, value: r.value, ...(r.verdict ? { verdict: r.verdict } : {}), stale: !r.verdict }));
    if (stored?.version === STORAGE_VERSION && stored.spec && stored.rows) {
      this.spec = stored.spec;
      for (const shape of ["text", "fields", "conversation"] as const) this.shelved[shape] = thaw(stored.rows[shape]);
      this.rawMode = Boolean(stored.raw);
      if (stored.results === false) this.toggleResults(false);
    } else {
      for (const shape of ["text", "fields", "conversation"] as const) this.shelved[shape] = this.exampleRows(shape);
    }
    this.rows = this.shelved[this.spec.shape];
    this.rawText = stringifyJson(this.spec.properties, { indent: 2 });
  }

  /** What a shape starts with: the contract's wine notes, in that shape. */
  private exampleRows(shape: Shape): Row[] {
    if (shape === "text") return EXAMPLE_INPUTS.map((value) => ({ id: this.nextId++, value, stale: true }));
    if (shape === "fields") return EXAMPLE_INPUTS.slice(0, 2).map((note, i) => ({ id: this.nextId++, value: { note, price_eur: i === 0 ? 48 : 6 }, stale: true }));
    return [{ id: this.nextId++, value: [{ role: "user", content: "Something to lay down for ten years?" }, { role: "assistant", content: `The 2019 Pauillac: ${EXAMPLE_INPUTS[0]}` }], stale: true }];
  }

  private persist(): void {
    this.shelved[this.spec.shape] = this.rows;
    const freeze = (rows: Row[]): StoredRow[] => rows.map((r) => ({ value: r.value, ...(r.verdict && !r.stale ? { verdict: r.verdict } : {}) }));
    const data: Stored = { version: STORAGE_VERSION, spec: this.spec, rows: { text: freeze(this.shelved.text), fields: freeze(this.shelved.fields), conversation: freeze(this.shelved.conversation) }, raw: this.rawMode, results: $("judge-toggle-results").getAttribute("aria-expanded") !== "false" };
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
    for (const row of this.rows) row.stale = true;
    this.changed();
  }

  private changed(): void {
    this.persist();
    this.renderCounts();
    this.renderRows();
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
    const hint = $("judge-paths-hint");
    const jev = this.host.connection.provider === "typesafe";
    const instructions = Boolean(this.spec.instructions.trim());
    hint.hidden = this.spec.shape === "text" && !(jev && instructions);
    const field = this.spec.fields.length ? this.spec.fields[0]!.name : "note";
    // The state is the input verbatim (2026-09-19 D1); on Jev the page writes the instructions into it as a named key (D4), so every path is the input's own.
    hint.replaceChildren(...(this.spec.shape === "fields"
      ? this.hintNodes("Inputs have fields. A question can point at one with backticks, e.g. ", `\`${field}\``, jev && instructions ? `. On Jev the instructions ride beside them as \`${JEV_INSTRUCTIONS_KEY}\`. Without a path, Jev reads the whole object.` : ". Without a path, Jev reads the whole object; a chat model gets the object as JSON text.")
      : this.spec.shape === "conversation"
        ? this.hintNodes("Inputs are conversations. On Jev the transcript is the state's `messages` array: a question can point at a turn with backticks, e.g. ", "`messages[1].content`", instructions ? `; the instructions ride beside it as \`${JEV_INSTRUCTIONS_KEY}\`. A chat model gets the turns as its conversation.` : ". A chat model gets the turns as its conversation.")
        : this.hintNodes("Jev has no system prompt: the instructions ride in the state as ", `\`${JEV_INSTRUCTIONS_KEY}\``, ` and the text as \`${JEV_TEXT_KEY}\`; a question can point at either.`)));
    document.body.dataset.judgeRaw = String(this.rawMode);
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
    const card = document.createElement("details"); card.className = "question"; card.dataset.name = q.name;
    if (this.openCards.has(q.name)) card.open = true;
    card.addEventListener("toggle", () => { if (card.open) this.openCards.add(q.name); else this.openCards.delete(q.name); });
    const summary = document.createElement("summary");
    const name = document.createElement("span"); name.className = "qname"; name.textContent = q.name;
    const kind = document.createElement("span"); kind.className = "qkind";
    kind.textContent = q.kind === "yesNo" ? "yes / no" : q.kind === "choice" ? `choice · ${q.options.length} option${q.options.length === 1 ? "" : "s"}` : `scale · ${q.options.length} level${q.options.length === 1 ? "" : "s"}`;
    summary.append(name, kind);
    const body = document.createElement("div"); body.className = "qbody";
    const field = (label: string, value: string, apply: (v: string) => Question, mono = false) => {
      const wrap = document.createElement("label"); wrap.className = "field"; wrap.textContent = label;
      const input = document.createElement("input"); input.value = value; if (mono) input.className = "mono";
      input.addEventListener("change", () => this.replaceQuestion(q.name, apply(input.value)));
      wrap.append(input); return wrap;
    };
    body.append(field("Name", q.name, (v) => ({ ...q, name: v.trim() || q.name }), true));
    body.append(field("Question", q.question, (v) => ({ ...q, question: v })));
    if (q.kind !== "yesNo") {
      const label = document.createElement("p"); label.className = "field"; label.textContent = q.kind === "choice" ? "Options (key · optional description)" : "Levels, worst to best (title · optional description)";
      const list = document.createElement("ol"); list.className = "levels";
      // The rows are the form's: a blank row stays until it is filled or removed; the schema only ever holds the filled ones.
      const read = (): Option[] => [...list.querySelectorAll("li")].map((li) => ({ key: li.querySelector<HTMLInputElement>("input.key")!.value, description: li.querySelector<HTMLInputElement>("input.desc")!.value }));
      const apply = () => this.replaceQuestion(q.name, { ...q, options: read() });
      const row = (o: Option, i: number) => {
        const li = document.createElement("li");
        const n = document.createElement("span"); n.className = "n"; n.textContent = q.kind === "score" ? String(i) : "";
        const key = document.createElement("input"); key.value = o.key; key.placeholder = q.kind === "choice" ? "key" : "title"; key.className = "key"; key.setAttribute("aria-label", `${q.kind === "choice" ? "Option" : "Level"} ${i + 1} ${q.kind === "choice" ? "key" : "title"}`);
        const desc = document.createElement("input"); desc.value = o.description; desc.placeholder = "description"; desc.className = "desc"; desc.setAttribute("aria-label", `${q.kind === "choice" ? "Option" : "Level"} ${i + 1} description`);
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
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button danger remove-question"; remove.textContent = "Remove question";
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

  // ─── Inputs and outputs ──────────────────────────────────────────

  private setShape(shape: Shape): void {
    if (shape === this.spec.shape) return;
    this.shelved[this.spec.shape] = this.rows;
    const fields = shape === "fields" && this.spec.fields.length === 0 ? [...EXAMPLE_FIELDS] : this.spec.fields;
    this.spec = { ...this.spec, shape, fields };
    // A text is not an object: each shape keeps its own inputs, and comes back to them.
    this.rows = this.shelved[shape];
    this.selected = undefined;
    for (const b of document.querySelectorAll<HTMLButtonElement>("#judge-shape button")) b.setAttribute("aria-pressed", String(b.dataset.shape === shape));
    this.renderQuestions();
    this.renderFieldDefs();
    this.renderAdd();
    this.changed();
  }

  private renderFieldDefs(): void {
    const el = $("judge-field-defs");
    el.hidden = this.spec.shape !== "fields";
    if (el.hidden) return;
    const label = document.createElement("span"); label.className = "lbl"; label.textContent = "fields";
    el.replaceChildren(label, ...this.spec.fields.map((f, i) => {
      const chip = document.createElement("span"); chip.className = "fd";
      const name = document.createElement("span"); name.textContent = f.name;
      const type = document.createElement("select"); type.setAttribute("aria-label", `Type of ${f.name}`);
      for (const t of ["text", "number", "json"] as const) { const o = document.createElement("option"); o.value = t; o.textContent = t; o.selected = f.type === t; type.append(o); }
      type.addEventListener("change", () => this.setFields(this.spec.fields.map((x, k) => k === i ? { ...x, type: type.value as FieldDef["type"] } : x)));
      const x = document.createElement("button"); x.type = "button"; x.className = "x"; x.textContent = "×"; x.setAttribute("aria-label", `Remove field ${f.name}`);
      x.addEventListener("click", () => this.setFields(this.spec.fields.filter((_, k) => k !== i)));
      chip.append(name, type, x); return chip;
    }));
    const add = document.createElement("button"); add.type = "button"; add.className = "text-button"; add.textContent = "+ field";
    add.addEventListener("click", () => {
      const raw = prompt("Field name (a JSON key)", "");
      const name = raw?.trim();
      if (!name) return;
      if (this.spec.fields.some((f) => f.name === name)) { this.showAlert(`There is already a field named ${name}.`); return; }
      this.setFields([...this.spec.fields, { name, type: "text" }]);
    });
    el.append(add);
  }

  private setFields(fields: FieldDef[]): void {
    this.spec = { ...this.spec, fields };
    for (const row of this.rows) {
      const object = row.value as Record<string, JsonValue>;
      row.value = Object.fromEntries(fields.map((f) => [f.name, object[f.name] ?? (f.type === "number" ? null : f.type === "json" ? null : "")]));
      row.stale = true;
    }
    this.renderFieldDefs();
    this.renderQuestions();
    this.changed();
  }

  private renderAdd(): void {
    const el = $("judge-add");
    el.replaceChildren();
    if (this.spec.shape === "text") {
      const ta = document.createElement("textarea"); ta.id = "judge-new-text"; ta.rows = 2; ta.placeholder = "New input — one per line to add several"; ta.setAttribute("aria-label", "New inputs");
      const add = document.createElement("button"); add.type = "button"; add.id = "judge-add-inputs"; add.textContent = "Add input";
      const submit = () => { const values = parseInputs("text", ta.value, []); if (!values.length) return; this.addRows(values); ta.value = ""; };
      add.addEventListener("click", submit);
      ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } });
      el.append(ta, add);
      return;
    }
    const add = document.createElement("button"); add.type = "button"; add.id = "judge-add-inputs"; add.textContent = "+ Add input";
    add.addEventListener("click", () => this.addRows([emptyInput(this.spec.shape, this.spec.fields)], true));
    const paste = document.createElement("button"); paste.type = "button"; paste.id = "judge-paste-open"; paste.textContent = this.spec.shape === "fields" ? "Paste CSV / JSON…" : "Paste JSON…";
    paste.addEventListener("click", () => this.openPaste());
    const hint = document.createElement("span"); hint.className = "hint"; hint.textContent = this.spec.shape === "fields" ? "one object per input · CSV header = field names" : "one conversation per input";
    el.append(add, paste, hint);
  }

  private addRows(values: InputValue[], focus = false): void {
    for (const value of values) this.rows.push({ id: this.nextId++, value, stale: true });
    this.selected = this.rows[this.rows.length - 1]!.id;
    this.changed();
    if (focus) $("judge-rows").querySelector<HTMLTextAreaElement>("tr:last-child textarea")?.focus();
  }

  private openPaste(): void {
    const dialog = $<HTMLDialogElement>("judge-paste");
    $("judge-paste-help").textContent = this.spec.shape === "fields"
      ? `CSV with a header row naming the fields (${this.spec.fields.map((f) => f.name).join(", ")}), or a JSON array of objects.`
      : 'A JSON array: each item { "messages": [{ "role": "user" | "assistant", "content": "…" }] }, or an array of turns.';
    $<HTMLTextAreaElement>("judge-paste-text").value = "";
    $("judge-paste-error").hidden = true;
    dialog.showModal();
  }

  private pasteInputs(): void {
    const text = $<HTMLTextAreaElement>("judge-paste-text").value;
    try {
      const values = this.spec.shape === "fields" && !text.trim().startsWith("[") ? parseCsv(text, this.spec.fields) : parseInputs(this.spec.shape, text, this.spec.fields);
      this.addRows(values);
      $<HTMLDialogElement>("judge-paste").close();
    } catch (e) {
      $("judge-paste-error").textContent = (e as Error).message; $("judge-paste-error").hidden = false;
    }
  }

  private renderRows(): void {
    const body = $("judge-rows");
    const judgments = this.judgments();
    body.replaceChildren(...this.rows.map((row, i) => {
      const tr = document.createElement("tr"); tr.dataset.id = String(row.id);
      if (row.id === this.selected) tr.classList.add("selected");
      const input = document.createElement("td"); input.append(this.inputCell(row, i));
      const output = document.createElement("td"); output.className = "out"; output.append(this.outputCell(row, judgments));
      tr.append(input, output);
      tr.addEventListener("focusin", () => this.select(row.id));
      tr.addEventListener("click", (e) => { if (!(e.target instanceof Element && e.target.closest("button, .spark"))) this.select(row.id); });
      return tr;
    }));
    for (const ta of body.querySelectorAll<HTMLTextAreaElement>("textarea")) grow(ta);
  }

  private select(id: number): void {
    if (this.selected === id) return;
    this.selected = id;
    for (const tr of $("judge-rows").querySelectorAll("tr")) tr.classList.toggle("selected", tr.dataset.id === String(id));
    this.host.codeChanged(); // the Request view follows the selected input
  }

  private inputCell(row: Row, index: number): HTMLElement {
    const wrap = document.createElement("div"); wrap.className = "io-row";
    const num = document.createElement("span"); num.className = "num"; num.textContent = String(index + 1);
    const editor = document.createElement("div"); editor.className = "in-editor";
    const edit = (value: InputValue) => { row.value = value; row.stale = true; delete row.error; this.persist(); this.renderCounts(); this.renderOutput(row); this.host.codeChanged(); };
    if (typeof row.value === "string") {
      const ta = document.createElement("textarea"); ta.className = "in-text"; ta.rows = 1; ta.value = row.value; ta.setAttribute("aria-label", `Input ${index + 1}`);
      ta.addEventListener("input", () => { grow(ta); edit(ta.value); });
      editor.append(ta);
    } else if (Array.isArray(row.value)) {
      const turns = row.value as readonly Turn[];
      const convo = document.createElement("div"); convo.className = "convo";
      turns.forEach((t, k) => {
        const msg = document.createElement("div"); msg.className = "msg";
        const role = document.createElement("span"); role.className = `role ${t.role}`; role.textContent = t.role;
        const ta = document.createElement("textarea"); ta.rows = 1; ta.value = t.content; ta.setAttribute("aria-label", `Input ${index + 1}, ${t.role} turn ${k + 1}`);
        ta.addEventListener("input", () => { grow(ta); edit(turns.map((x, j) => j === k ? { ...x, content: ta.value } : x)); });
        const x = document.createElement("button"); x.type = "button"; x.className = "x"; x.textContent = "×"; x.setAttribute("aria-label", `Remove turn ${k + 1}`);
        x.addEventListener("click", () => { edit(turns.filter((_, j) => j !== k)); this.renderRows(); });
        msg.append(role, ta, x); convo.append(msg);
      });
      const add = document.createElement("div"); add.className = "add-msg"; add.textContent = "+ ";
      for (const role of ["user", "assistant"] as const) {
        const b = document.createElement("button"); b.type = "button"; b.className = "text-button"; b.textContent = role;
        b.addEventListener("click", () => { edit([...turns, { role, content: "" }]); this.renderRows(); $("judge-rows").querySelector<HTMLTextAreaElement>(`tr[data-id="${row.id}"] .msg:last-of-type textarea`)?.focus(); });
        add.append(b, document.createTextNode(role === "user" ? " · " : ""));
      }
      convo.append(add); editor.append(convo);
    } else {
      const object = row.value as Record<string, JsonValue>;
      const grid = document.createElement("div"); grid.className = "fields-grid";
      for (const f of this.spec.fields) {
        const k = document.createElement("span"); k.className = "fkey"; k.textContent = f.name;
        const ta = document.createElement("textarea"); ta.className = `fval${f.type === "text" ? "" : " mono"}`; ta.rows = 1; ta.value = fieldText(object[f.name]); ta.setAttribute("aria-label", `Input ${index + 1} ${f.name}`);
        ta.addEventListener("input", () => {
          grow(ta);
          try { edit({ ...object, [f.name]: fieldValue(f, ta.value) }); ta.setAttribute("aria-invalid", "false"); ta.title = ""; }
          catch (e) { ta.setAttribute("aria-invalid", "true"); ta.title = (e as Error).message; }
        });
        grid.append(k, ta);
      }
      editor.append(grid);
    }
    const x = document.createElement("button"); x.type = "button"; x.className = "x"; x.textContent = "×"; x.title = "Remove input"; x.setAttribute("aria-label", `Remove input ${index + 1}`);
    x.addEventListener("click", () => { this.rows = this.rows.filter((r) => r !== row); if (this.selected === row.id) this.selected = undefined; this.changed(); });
    const status = document.createElement("span"); status.className = "in-status"; status.append(...this.statusNodes(row));
    wrap.append(num, editor, x, status);
    return wrap;
  }

  private statusNodes(row: Row): Node[] {
    if (row.error) { const b = document.createElement("span"); b.className = "bad"; b.textContent = row.error; return [b]; }
    if (!row.verdict || row.stale) return [document.createTextNode(row.verdict ? "changed · run again" : "not judged yet")];
    const done = document.createElement("span"); done.className = "done"; done.textContent = "judged";
    const v = row.verdict;
    const tokens = v.inputTokens !== undefined || v.outputTokens !== undefined ? ` · ${(v.inputTokens ?? 0) + (v.outputTokens ?? 0)} tokens` : "";
    return [done, document.createTextNode(`${tokens} · ${v.ms} ms · ${v.runtime}`)];
  }

  private renderOutput(row: Row): void {
    const tr = $("judge-rows").querySelector<HTMLTableRowElement>(`tr[data-id="${row.id}"]`);
    if (!tr) return;
    tr.querySelector("td.out")!.replaceChildren(this.outputCell(row, this.judgments()));
    tr.querySelector(".in-status")!.replaceChildren(...this.statusNodes(row));
  }

  private outputCell(row: Row, judgments: Judgment[]): HTMLElement {
    const wrap = document.createElement("div"); wrap.className = "out-row";
    if (!row.verdict) {
      const note = document.createElement("span"); note.className = "pending-note"; note.textContent = row.error ? "— failed" : "— run to judge"; wrap.append(note); return wrap;
    }
    if (row.stale) wrap.classList.add("stale");
    const v = row.verdict;
    if (this.outView === "json") {
      const pre = document.createElement("pre"); pre.textContent = stringifyJson({ data: v.data as JsonObject, ...(v.probabilities ? { probabilities: v.probabilities as unknown as JsonObject } : {}), ...(v.method ? { method: v.method } : {}) }, { indent: 2 });
      wrap.append(pre);
    } else {
      const answers = document.createElement("div"); answers.className = "answers";
      for (const j of judgments) {
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
        pick.append(p); line.append(pick); ans.append(name, line); answers.append(ans);
      }
      wrap.append(answers);
    }
    if (v.adaptations.length || row.stale) {
      const meta = document.createElement("div"); meta.className = "out-meta";
      const formatDropped = v.adaptations.some((a) => a.field === "config.response_format" && a.action === "dropped");
      if (formatDropped) { const warn = document.createElement("b"); warn.className = "bad"; warn.textContent = "not a judgment: this wire took no schema, so the questions never reached the model; the text above happened to parse"; meta.append(warn, document.createTextNode(" · ")); }
      meta.append(document.createTextNode([row.stale ? "from the previous input" : "", ...v.adaptations.map((a) => `adapted: ${a.field} ${a.action}`)].filter(Boolean).join(" · ")));
      meta.title = v.adaptations.map((a) => `${a.field}: ${a.reason}`).join("\n");
      wrap.append(meta);
    }
    return wrap;
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

  // ─── Counts and the run ──────────────────────────────────────────

  private pending(): Row[] { return this.rows.filter((r) => r.stale && !inputIsBlank(r.value)); }
  private runnable(): Row[] { return this.rows.filter((r) => !inputIsBlank(r.value)); }

  private renderCounts(): void {
    const n = this.rows.length, judgments = this.judgments().length, pending = this.pending().length, blank = this.rows.filter((r) => inputIsBlank(r.value)).length;
    const calls = pending || n - blank;
    $("judge-count").textContent = `${n} input${n === 1 ? "" : "s"} · ${judgments} question${judgments === 1 ? "" : "s"} · ${calls} call${calls === 1 ? "" : "s"}${pending && pending < n ? ` (${pending} changed or new)` : ""}${blank ? ` · ${blank} blank skipped` : ""}`;
    const run = $<HTMLButtonElement>("judge-run");
    const partial = pending > 0 && pending < n - blank;
    run.textContent = this.running ? "Running…" : partial ? `Run ${pending} new` : "Run all";
    // With some rows changed, the main button judges only those; a second, quieter one redoes the whole set.
    const again = $<HTMLButtonElement>("judge-run-again"); again.hidden = !partial || Boolean(this.running);
    const rustPinned = this.host.runtime() === "rust";
    const gap = this.stateError();
    run.disabled = Boolean(this.running) || !this.host.runtimeReady() || calls === 0 || Boolean(this.questionsError()) || rustPinned || Boolean(gap);
    run.title = rustPinned ? "The Rust SDK at this pin has no judgments (MAP-14). Judge with JavaScript or Python." : gap ?? "";
    const note = $("judge-gap"); note.hidden = !gap && !rustPinned; note.textContent = gap ?? (rustPinned ? run.title : "");
    $("judge-instructions-note").textContent = this.host.connection.provider === "typesafe" ? `Jev takes no system text: sent in the state as the key ${JEV_INSTRUCTIONS_KEY}` : "sent as the system text";
    $<HTMLButtonElement>("judge-stop").disabled = !this.running;
    $<HTMLButtonElement>("judge-run-again").disabled = run.disabled;
    $("judge-in-count").textContent = `${n} · ${this.spec.shape === "text" ? "one text each" : this.spec.shape === "fields" ? "one object each" : "one transcript each"}`;
    const judged = this.rows.filter((r) => r.verdict && !r.stale).length;
    $("judge-out-count").textContent = `${judged} of ${n} judged`;
    const method = this.rows.find((r) => r.verdict && !r.stale)?.verdict;
    $("judge-method").textContent = method ? `${method.provider} · ${method.model} · ${method.method ? method.method.replace(/_/g, " ") : "pick only — this wire does not measure a distribution"}` : "";
    const tokens = this.rows.reduce((sum, r) => sum + (r.verdict && !r.stale ? (r.verdict.inputTokens ?? 0) + (r.verdict.outputTokens ?? 0) : 0), 0);
    $("judge-tally").textContent = `${judged} of ${n} judged · ${tokens.toLocaleString()} tokens`;
    for (const b of document.querySelectorAll<HTMLButtonElement>("#judge-out-view button")) b.setAttribute("aria-pressed", String(b.dataset.view === this.outView));
    const hasResults = this.rows.some((r) => r.verdict);
    $<HTMLButtonElement>("judge-export-csv").disabled = !hasResults; $<HTMLButtonElement>("judge-export-json").disabled = !hasResults; $<HTMLButtonElement>("judge-clear-results").disabled = !hasResults;
  }

  /** On Jev the instructions become a state key; a field of that name has nowhere to go (D4). */
  private stateError(): string | undefined {
    if (this.host.connection.provider !== "typesafe") return undefined;
    for (const row of this.rows) { try { jevState(this.spec, row.value); } catch (e) { return (e as Error).message; } }
    return undefined;
  }

  private showAlert(text = ""): void { const el = $("judge-alert"); el.textContent = text; el.hidden = !text; }

  /** Judge the changed inputs, or — `all`, or when nothing changed — every input again. */
  async run(all = false): Promise<void> {
    if (this.running || !this.host.runtimeReady() || this.host.runtime() === "rust" || this.stateError()) return;
    const error = this.questionsError();
    if (error) { this.showAlert(error); return; }
    if (!this.host.requireKey()) return;
    if (!this.host.connection.model.trim()) { this.showAlert("Choose a model first."); return; }
    const pending = this.pending();
    const todo = all || pending.length === 0 ? this.runnable() : pending;
    if (!todo.length) return;
    for (const row of todo) row.stale = true;
    this.renderRows();
    const controller = new AbortController();
    const generation = ++this.generation;
    this.running = controller; this.host.onBusy(true); this.showAlert(); this.renderCounts();
    const runtime = this.host.runtimes[this.host.runtime()];
    const connection = { ...this.host.connection };
    try {
      for (const row of todo) {
        if (controller.signal.aborted || generation !== this.generation) break;
        const request = judgeRequest(connection, this.spec, row.value);
        const started = performance.now();
        try {
          const response = await runtime.judge(connection, this.host.key(), request, controller.signal, { spec: this.spec, value: row.value });
          if (generation !== this.generation) return;
          row.verdict = verdictOf(response, { ms: Math.round(performance.now() - started), provider: connection.provider, model: connection.model, runtime: runtime.label });
          row.stale = false; delete row.error;
        } catch (e) {
          if (generation !== this.generation) return;
          if (controller.signal.aborted) { this.showAlert("Stopped. Inputs not yet judged stay pending."); break; }
          if (looksBrowserBlocked(e) && !relayed(connection.provider) && !keyless(connection.provider) && await this.host.offerRelay()) {
            // Allowed: the same input again, through the relay; the loop then goes on.
            row.stale = true; this.running = undefined; this.host.onBusy(false); this.renderCounts();
            return void this.run(all);
          }
          row.error = this.host.errorMessage(e);
          this.showAlert(`Input ${this.rows.indexOf(row) + 1}: ${row.error}\nThe run stopped here; fix the cause and run the pending inputs again.`);
          break;
        } finally {
          this.persist(); this.renderOutput(row); this.renderCounts();
        }
      }
    } finally {
      if (generation === this.generation) { this.running = undefined; this.host.onBusy(false); this.renderCounts(); }
    }
  }

  private download(name: string, type: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private toggleResults(open: boolean): void {
    const b = $("judge-toggle-results"); b.setAttribute("aria-expanded", String(open)); b.textContent = open ? "Hide ▾" : "Show ▴";
    document.body.dataset.judgeResults = String(open);
  }

  // ─── Wiring ──────────────────────────────────────────────────────

  private renderAll(): void {
    for (const b of document.querySelectorAll<HTMLButtonElement>("#judge-shape button")) b.setAttribute("aria-pressed", String(b.dataset.shape === this.spec.shape));
    $<HTMLTextAreaElement>("judge-instructions").value = this.spec.instructions;
    $<HTMLTextAreaElement>("judge-raw-json").value = this.rawText;
    this.renderQuestions(); this.renderFieldDefs(); this.renderAdd(); this.renderRows(); this.renderCounts();
  }

  private wire(): void {
    $("judge-run").addEventListener("click", () => void this.run());
    $("judge-run-again").addEventListener("click", () => void this.run(true));
    $("judge-stop").addEventListener("click", () => this.running?.abort());
    $("judge-provider-button").addEventListener("click", () => this.host.pickProvider());
    $("judge-model-button").addEventListener("click", () => this.host.pickModel());
    $("judge-shape").addEventListener("click", (e) => { const b = (e.target as Element).closest<HTMLButtonElement>("button[data-shape]"); if (b) this.setShape(b.dataset.shape as Shape); });
    $("judge-out-view").addEventListener("click", (e) => { const b = (e.target as Element).closest<HTMLButtonElement>("button[data-view]"); if (b) { this.outView = b.dataset.view as "answers" | "json"; this.renderRows(); this.renderCounts(); } });
    $("judge-toggle-results").addEventListener("click", () => { this.toggleResults($("judge-toggle-results").getAttribute("aria-expanded") === "false"); this.persist(); });
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
      try { const properties = parseProperties(this.rawText); if (stringifyJson(properties) !== stringifyJson(this.spec.properties)) { this.spec = { ...this.spec, properties }; for (const r of this.rows) r.stale = true; this.persist(); this.renderCounts(); this.renderRows(); } } catch { /* the status line says why; the last valid schema stands */ }
      this.host.codeChanged();
    });
    $("judge-raw-format").addEventListener("click", () => { try { this.rawText = stringifyJson(parseProperties(this.rawText), { indent: 2 }); raw.value = this.rawText; this.renderRawStatus(); } catch { /* status shows the error */ } });
    $<HTMLSelectElement>("judge-add-question").addEventListener("change", (e) => { const select = e.target as HTMLSelectElement; if (select.value) this.addQuestion(select.value as QuestionKind); select.value = ""; });
    $<HTMLTextAreaElement>("judge-instructions").addEventListener("input", (e) => { this.spec = { ...this.spec, instructions: (e.target as HTMLTextAreaElement).value }; for (const r of this.rows) r.stale = true; this.changed(); this.renderQuestions(); });
    $("judge-export-csv").addEventListener("click", () => this.download("judgments.csv", "text/csv", toCsv(this.spec, this.rows.map((r) => ({ value: r.value, ...(r.verdict && !r.stale ? { verdict: r.verdict } : {}) })))));
    $("judge-export-json").addEventListener("click", () => this.download("judgments.json", "application/json", toJsonExport(this.spec, this.rows.map((r) => ({ value: r.value, ...(r.verdict && !r.stale ? { verdict: r.verdict } : {}) })))));
    $("judge-clear-results").addEventListener("click", () => { for (const r of this.rows) { delete r.verdict; delete r.error; r.stale = true; } this.showAlert(); this.changed(); });
    $("judge-paste-add").addEventListener("click", () => this.pasteInputs());
    $("judge-paste-cancel").addEventListener("click", () => $<HTMLDialogElement>("judge-paste").close());
    $("judge-paste-close").addEventListener("click", () => $<HTMLDialogElement>("judge-paste").close());
    $("judge-io").addEventListener("scroll", () => this.hidePop(), { passive: true });
    document.addEventListener("click", (e) => { if (!(e.target instanceof Element && e.target.closest(".spark, #judge-pop"))) this.hidePop(); });
    // The divider: drag to give the code or the results more room; the split is remembered for the visit.
    const divider = document.querySelector<HTMLElement>(".judge-divider")!;
    const right = document.querySelector<HTMLElement>(".judge-right")!;
    const setSplit = (fraction: number) => { right.style.setProperty("--judge-split", `${Math.min(0.85, Math.max(0.15, fraction))}`); };
    divider.addEventListener("pointerdown", (e) => {
      e.preventDefault(); divider.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => { const box = right.getBoundingClientRect(); setSplit((ev.clientY - box.top) / box.height); };
      const up = () => { divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", up); };
      divider.addEventListener("pointermove", move); divider.addEventListener("pointerup", up);
    });
    divider.addEventListener("keydown", (e) => {
      const current = Number(right.style.getPropertyValue("--judge-split") || 0.45);
      if (e.key === "ArrowUp") { setSplit(current - 0.05); e.preventDefault(); }
      if (e.key === "ArrowDown") { setSplit(current + 0.05); e.preventDefault(); }
    });
  }
}

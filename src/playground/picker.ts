/** The same keyboard-accessible picker in a dialog or above the slash-command composer. */
import { slashCommand, type PickerKind } from "./experience.ts";

export interface PickOption {
  id: string;
  label: string;
  /** A second line under the label; nothing when empty. */
  detail?: string;
  /**
   * Something that sits at the right of the row and is not the choice itself:
   * the provider's key field, its masked key, its endpoint. Built fresh on each
   * render; a focused input inside it is restored (value, caret) across renders.
   */
  trailing?: () => HTMLElement;
}
export interface PickResult { options: PickOption[]; status: string; error?: boolean }
export class Picker {
  readonly dialog = document.getElementById("picker") as HTMLDialogElement;
  readonly search = document.getElementById("picker-search") as HTMLInputElement;
  readonly prompt = document.getElementById("prompt") as HTMLTextAreaElement;
  private source: "dialog" | "slash" | undefined;
  private kind: PickerKind = "commands";
  private index = 0;
  private options: PickOption[] = [];
  private query = "";
  private startOn: string | undefined;

  private readonly choices: (kind: PickerKind, query: string) => PickResult;
  private readonly choose: (kind: PickerKind, id: string) => void;

  constructor(
    choices: (kind: PickerKind, query: string) => PickResult,
    choose: (kind: PickerKind, id: string) => void,
  ) {
    this.choices = choices;
    this.choose = choose;
    this.search.addEventListener("input", () => { this.query = this.search.value; this.index = 0; this.update(); });
    this.prompt.addEventListener("input", () => this.syncSlash());
    this.search.addEventListener("keydown", (event) => this.keydown(event));
    this.prompt.addEventListener("keydown", (event) => this.keydown(event));
    document.getElementById("picker-close")!.addEventListener("click", () => this.dialog.close());
    this.dialog.addEventListener("close", () => { this.source = undefined; this.search.removeAttribute("aria-activedescendant"); });
    this.dialog.addEventListener("click", (event) => { if (event.target === this.dialog) this.dialog.close(); });
  }

  /** Which list is open in the dialog, if any. */
  get current(): PickerKind | undefined { return this.source === "dialog" ? this.kind : undefined; }

  /** Open the list; `current` is the id already in use, which the highlight starts on. */
  open(kind: PickerKind, current?: string): void {
    this.hideSlash(); this.kind = kind; this.source = "dialog"; this.query = ""; this.index = 0;
    this.startOn = current;
    this.search.value = "";
    // Providers need no title: the list is the whole story. Models keep theirs beside the discovery status.
    this.dialog.querySelector<HTMLElement>(".dialog-heading")!.hidden = kind === "provider";
    this.dialog.dataset.kind = kind;
    document.getElementById("picker-title")!.textContent = kind === "model" ? "Choose a model" : "Commands";
    this.search.placeholder = kind === "model" ? "Search models, or type an exact model ID…" : kind === "provider" ? "Search providers…" : "Type to filter…";
    document.getElementById("picker-remember")!.hidden = kind !== "provider";
    this.dialog.showModal(); this.update(); this.search.focus();
  }

  /** Focus the trailing input of one row (a key field), scrolling it into view. */
  focusTrailing(id: string): void {
    const input = this.dialog.querySelector<HTMLInputElement>(`[data-trailing-for="${CSS.escape(id)}"] input`);
    if (input) { input.focus(); input.scrollIntoView({ block: "nearest" }); }
  }

  syncSlash(): void {
    const parsed = slashCommand(this.prompt.value);
    if (!parsed) { this.hideSlash(); return; }
    this.kind = parsed.kind; this.query = parsed.query; this.source = "slash"; this.index = 0;
    this.update();
  }

  private hideSlash(): void {
    document.getElementById("slash-picker")!.hidden = true;
    this.prompt.setAttribute("aria-expanded", "false");
    this.prompt.removeAttribute("aria-activedescendant");
    if (this.source === "slash") this.source = undefined;
  }

  update(): void {
    if (!this.source) return;
    const result = this.choices(this.kind, this.query);
    this.options = result.options;
    if (this.startOn !== undefined) { const at = this.options.findIndex((option) => option.id === this.startOn); if (at >= 0) this.index = at; this.startOn = undefined; }
    this.index = Math.max(0, Math.min(this.index, this.options.length - 1));
    const prefix = this.source === "dialog" ? "picker" : "slash";
    const list = document.getElementById(`${prefix}-results`)!;
    const input = this.source === "dialog" ? this.search : this.prompt;
    const status = document.getElementById(`${prefix}-status`)!;
    status.textContent = result.status;
    status.classList.toggle("is-error", Boolean(result.error));
    // A render must not eat a key someone is pasting: remember the focused trailing input, restore it after.
    const focused = document.activeElement instanceof HTMLInputElement && list.contains(document.activeElement) ? document.activeElement : undefined;
    const keep = focused ? { id: focused.closest<HTMLElement>("[data-trailing-for]")?.dataset["trailingFor"], value: focused.value, start: focused.selectionStart, end: focused.selectionEnd } : undefined;
    list.replaceChildren(...this.options.map((option, index) => {
      const row = document.createElement("li");
      row.id = `${prefix}-option-${index}`; row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(index === this.index));
      const main = document.createElement("div"); main.className = "pick-main";
      const label = document.createElement("span"); label.textContent = option.label;
      main.append(label);
      if (option.detail) { const detail = document.createElement("small"); detail.textContent = option.detail; main.append(detail); }
      row.append(main);
      if (option.trailing && this.source === "dialog") {
        const trailing = document.createElement("div"); trailing.className = "pick-trailing"; trailing.dataset["trailingFor"] = option.id;
        trailing.append(option.trailing());
        // The trailing control is its own thing: clicking or typing there never picks the row.
        for (const type of ["click", "pointerdown", "keydown"]) trailing.addEventListener(type, (event) => event.stopPropagation());
        row.append(trailing);
      }
      row.addEventListener("pointerdown", (event) => event.preventDefault());
      row.addEventListener("click", () => { this.index = index; this.accept(); });
      return row;
    }));
    if (keep?.id !== undefined) {
      const again = list.querySelector<HTMLInputElement>(`[data-trailing-for="${CSS.escape(keep.id)}"] input`);
      if (again) { again.value = keep.value; again.focus({ preventScroll: true }); try { again.setSelectionRange(keep.start, keep.end); } catch { /* not a text input */ } }
    }
    if (this.options.length) input.setAttribute("aria-activedescendant", `${prefix}-option-${this.index}`);
    else input.removeAttribute("aria-activedescendant");
    if (this.source === "slash") {
      document.getElementById("slash-picker")!.hidden = false;
      this.prompt.setAttribute("aria-expanded", "true");
    }
  }

  /** Returns true for a command, even with no match, so it can never become an inference request. */
  consume(): boolean {
    if (!slashCommand(this.prompt.value)) return false;
    if (this.source !== "slash") this.syncSlash();
    this.accept(); return true;
  }

  private accept(): void {
    const option = this.options[this.index];
    if (!option) return;
    const kind = this.kind;
    if (kind === "commands" && (option.id === "provider" || option.id === "model")) {
      if (this.source === "slash") { this.prompt.value = `/${option.id} `; this.syncSlash(); }
      else { this.kind = option.id; this.search.value = ""; this.query = ""; this.index = 0; this.update(); }
      this.choose("commands", option.id); return;
    }
    if (this.source === "slash") { this.prompt.value = ""; this.hideSlash(); }
    else this.dialog.close();
    this.choose(kind, option.id);
  }

  private keydown(event: KeyboardEvent): void {
    if (event.isComposing || !this.source || (event.target === this.prompt && this.source !== "slash")) return;
    if (event.key === "Escape") {
      if (this.source === "slash") { this.hideSlash(); event.preventDefault(); }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (this.options.length) this.index = (this.index + (event.key === "ArrowDown" ? 1 : -1) + this.options.length) % this.options.length;
      this.update();
      document.getElementById(`${this.source === "dialog" ? "picker" : "slash"}-option-${this.index}`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); this.accept(); }
  }
}

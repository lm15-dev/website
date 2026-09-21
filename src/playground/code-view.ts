/**
 * The code panel's rendering: the exact text, one block per line so a
 * wrapped line continues under its own indent, and a span per marked run.
 * Nothing here decides what means what; the generator did (marks.ts).
 */

import type { Code, MarkKind } from "./marks.ts";

export interface Segment { readonly text: string; readonly kinds: readonly MarkKind[]; readonly source?: string }
/** One source line: its text split into runs, and the columns of its indent (for the hanging indent when it wraps). */
export interface Line { readonly indent: number; readonly segments: readonly Segment[] }

/** How many columns further a wrapped continuation sits than the line's own indent. */
export const CONTINUATION = 4;
/** An opaque payload longer than this is folded: its head, a count, its tail; a click opens it. The text node stays whole, so Copy is exact. */
export const FOLD_OVER = 64;
const FOLD_HEAD = 20, FOLD_TAIL = 8;

/** Lines and runs; every line ends with its newline except the last, so the text nodes concatenate to the exact source. */
export function layout(code: Code): Line[] {
  const lines: Line[] = [];
  let lineStart = 0;
  let next = 0; // the first mark that may reach this line
  while (lineStart <= code.text.length) {
    const newline = code.text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? code.text.length : newline + 1;
    const segments: Segment[] = [];
    let cursor = lineStart;
    for (let i = next; i < code.marks.length; i++) {
      const m = code.marks[i]!;
      if (m.start >= lineEnd) break;
      if (m.end <= lineStart) { next = i + 1; continue; }
      const start = Math.max(m.start, lineStart), end = Math.min(m.end, lineEnd);
      if (start > cursor) segments.push({ text: code.text.slice(cursor, start), kinds: [] });
      segments.push({ text: code.text.slice(start, end), kinds: m.kinds, ...(m.source === undefined ? {} : { source: m.source }) });
      cursor = end;
    }
    if (cursor < lineEnd) segments.push({ text: code.text.slice(cursor, lineEnd), kinds: [] });
    const text = code.text.slice(lineStart, lineEnd);
    const content = newline === -1 ? text : text.slice(0, -1);
    if (text.length || lineStart === 0) lines.push({ indent: content.length - content.trimStart().length, segments });
    if (newline === -1) break;
    lineStart = lineEnd;
  }
  return lines;
}

export function renderCode(element: HTMLElement, code: Code): void {
  const fragment = document.createDocumentFragment();
  for (const line of layout(code)) {
    const block = document.createElement("span");
    block.className = "line";
    block.style.setProperty("--indent", String(line.indent + CONTINUATION));
    for (const segment of line.segments) {
      if (!segment.kinds.length) { block.append(document.createTextNode(segment.text)); continue; }
      const span = document.createElement("span");
      span.className = segment.kinds.map((k) => `tok-${k}`).join(" ");
      if (segment.source !== undefined) span.dataset["source"] = segment.source;
      if (segment.kinds.includes("opaque") && segment.text.length > FOLD_OVER) {
        // Folded: [head][hidden middle][tail]. `textContent` still concatenates to the exact source.
        const head = document.createElement("span"), middle = document.createElement("span"), note = document.createElement("span"), tail = document.createElement("span");
        head.textContent = segment.text.slice(0, FOLD_HEAD);
        middle.className = "fold"; middle.textContent = segment.text.slice(FOLD_HEAD, -FOLD_TAIL);
        // The note is a pseudo-element's text, not a text node: it never reaches Copy.
        note.className = "fold-note"; note.dataset["hidden"] = `… ${(segment.text.length - FOLD_HEAD - FOLD_TAIL).toLocaleString()} more characters …`;
        tail.textContent = segment.text.slice(-FOLD_TAIL);
        span.classList.add("folded");
        span.title = "An opaque payload the provider needs back verbatim. Click to unfold.";
        span.setAttribute("role", "button"); span.tabIndex = 0;
        const toggle = () => { span.classList.toggle("folded"); span.title = span.classList.contains("folded") ? "An opaque payload the provider needs back verbatim. Click to unfold." : "Click to fold."; };
        span.addEventListener("click", toggle);
        span.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } });
        span.append(head, middle, note, tail);
      } else span.textContent = segment.text;
      block.append(span);
    }
    fragment.append(block);
  }
  element.replaceChildren(fragment);
}

/**
 * The code panel's rendering: the exact text, one block per line so a
 * wrapped line continues under its own indent, and a span per marked run.
 * Nothing here decides what means what; the generator did (marks.ts).
 */

import type { Code, MarkKind } from "./marks.ts";

export interface Segment { readonly text: string; readonly kinds: readonly MarkKind[] }
/** One source line: its text split into runs, and the columns of its indent (for the hanging indent when it wraps). */
export interface Line { readonly indent: number; readonly segments: readonly Segment[] }

/** How many columns further a wrapped continuation sits than the line's own indent. */
export const CONTINUATION = 4;

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
      segments.push({ text: code.text.slice(start, end), kinds: m.kinds });
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
      span.textContent = segment.text;
      block.append(span);
    }
    fragment.append(block);
  }
  element.replaceChildren(fragment);
}

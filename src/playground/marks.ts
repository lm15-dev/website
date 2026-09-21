/**
 * How the code panel knows what to colour: the generator says so as it
 * writes, and nothing re-parses the text afterwards.
 *
 * A generator builds its program from plain strings, wrapping the pieces
 * that mean something with `val` (a value the person typed), `api` (a call
 * into LM15), `comment`, or `dim` (language plumbing). `finish` turns that
 * marked text into a `Code`: the exact source, and the ranges to colour.
 *
 * The marks ride inside the string as C0 control characters. They cannot
 * collide with content: every value a person controls enters the source
 * through JSON, Rust or Go string escaping, which spells a control
 * character as an escape sequence, never raw. `finish` refuses a text whose
 * marks do not balance, so a slip is an error, not a stray character.
 */

export type MarkKind = "value" | "api" | "comment" | "dim" | "opaque";

/**
 * A run of the text and every kind that applies to it (an outer `dim` line may hold a `comment`).
 * A value may name its source — the control it came from ("system", "model", "turn:2", "draft"…) — so
 * the panel can light it when that control is touched.
 */
export interface Mark { readonly start: number; readonly end: number; readonly kinds: readonly MarkKind[]; readonly source?: string }

/** A program for the panel: the exact text (what Copy gives), and where its meaning lies. */
export interface Code { readonly text: string; readonly marks: readonly Mark[] }

const OPEN: Record<MarkKind, string> = { value: "\u0001", api: "\u0002", comment: "\u0003", dim: "\u0004", opaque: "\u0007" };
const KIND_OF: Record<string, MarkKind> = { "\u0001": "value", "\u0002": "api", "\u0003": "comment", "\u0004": "dim", "\u0007": "opaque" };
const CLOSE = "\u0005";
/** Wraps a value's source name right after its open mark: `\u0001\u0006system\u0006text\u0005`. */
const SOURCE = "\u0006";
const SENTINEL = /[\u0001-\u0007]/;

export function mark(kind: MarkKind, text: string, source?: string): string {
  if (source !== undefined && (SENTINEL.test(source) || !source)) throw new Error("code marks: a source name must be plain and non-empty");
  return OPEN[kind] + (source === undefined ? "" : SOURCE + source + SOURCE) + text + CLOSE;
}
/** A value the person controls: the model, a message, a question, an input; `source` names the control it came from. */
export const val = (text: string, source?: string): string => mark("value", text, source);
/** A call into LM15: the names the reader should learn. */
export const api = (text: string): string => mark("api", text);
export const comment = (text: string): string => mark("comment", text);
/** Plumbing the language demands: imports, error checks, `package main`. */
export const dim = (text: string): string => mark("dim", text);
/** A provider's opaque payload (a signature, an encrypted reasoning item): needed verbatim, not meant to be read. The panel folds it. */
export const opaque = (text: string): string => mark("opaque", text);
/** A quoted literal whose contents are opaque: quotes are syntax, the text between them is folded. */
export function quotedOpaque(literal: string): string {
  return literal[0]! + opaque(literal.slice(1, -1)) + literal.at(-1)!;
}

/** A quoted literal with its contents marked as a value: quotes are syntax, the text between them is the person's. */
export function quotedValue(literal: string, source?: string): string {
  return literal[0]! + val(literal.slice(1, -1), source) + literal.at(-1)!;
}

/** The text without its marks: for width decisions while a program is still being written. */
export function plain(marked: string): string {
  return marked.replace(/\u0006[^\u0006]*\u0006/g, "").replace(/[\u0001-\u0005\u0007]/g, "");
}

/** The exact source and its marks. Throws on unbalanced marks. */
export function finish(marked: string): Code {
  let text = "";
  const marks: Mark[] = [];
  const stack: MarkKind[] = [];
  const sources: (string | undefined)[] = []; // one per open mark; the innermost named one is the run's source
  let runStart = 0;
  const flush = () => {
    if (text.length > runStart && stack.length) {
      const source = sources.findLast((s) => s !== undefined);
      marks.push({ start: runStart, end: text.length, kinds: [...stack], ...(source === undefined ? {} : { source }) });
    }
    runStart = text.length;
  };
  let reading: string | undefined; // a source name being read between its two markers
  for (const char of marked) {
    if (reading !== undefined) {
      if (char === SOURCE) { sources[sources.length - 1] = reading; reading = undefined; }
      else reading += char;
      continue;
    }
    if (char === CLOSE) {
      if (!stack.length) throw new Error("code marks: a close without an open");
      flush();
      stack.pop(); sources.pop();
    } else if (KIND_OF[char]) {
      flush();
      stack.push(KIND_OF[char]!); sources.push(undefined);
    } else if (char === SOURCE) {
      if (!stack.length || text.length !== runStart) throw new Error("code marks: a source name must follow its open mark");
      reading = "";
    } else text += char;
  }
  if (reading !== undefined) throw new Error("code marks: a source name never closed");
  if (stack.length) throw new Error(`code marks: ${stack.join(", ")} never closed`);
  flush();
  return { text, marks };
}

/** Plain text as code: nothing coloured. */
export function unmarked(text: string): Code {
  if (SENTINEL.test(text)) throw new Error("unmarked text cannot contain mark characters");
  return { text, marks: [] };
}

/** Every occurrence of `from` replaced by `to`, marks kept in place (a mark that overlaps a replacement stretches over it). */
export function replaceAll(code: Code, from: string, to: string): Code {
  if (!from || !code.text.includes(from)) return code;
  const starts: number[] = [];
  for (let at = code.text.indexOf(from); at !== -1; at = code.text.indexOf(from, at + from.length)) starts.push(at);
  const delta = to.length - from.length;
  /** An original position in the new text: shifted by the replacements before it; one inside a replacement lands on that replacement's end. */
  const moved = (p: number): number => {
    let shift = 0;
    for (const at of starts) {
      if (p >= at + from.length) shift += delta;
      else if (p > at) return at + shift + to.length;
      else break;
    }
    return p + shift;
  };
  const text = code.text.split(from).join(to);
  const marks = code.marks.map((m) => ({ ...m, start: moved(m.start), end: moved(m.end) })).filter((m) => m.end > m.start);
  return { text, marks };
}

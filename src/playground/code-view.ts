/** Lightweight visual coloring only. Source text stays exact; nothing is parsed as HTML. */
export type Token = { text: string; kind?: "string" | "comment" | "keyword" | "number" };
export function tokens(source: string, language: string): Token[] {
  const comments = language === "python" || language === "curl" ? "#[^\\n]*" : "//[^\\n]*|/\\*[\\s\\S]*?\\*/";
  const pattern = new RegExp(`("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\x60(?:\\\\.|[^\x60\\\\])*\x60)|(${comments})|\\b(const|let|var|import|from|as|new|await|async|for|of|in|if|else|return|fn|use|pub|mut|true|false|null|None|True|False|Some|Ok|with|class|def|try|except|while|yield)\\b|\\b(\\d+(?:\\.\\d+)?)\\b`, "g");
  const out: Token[] = [];
  let offset = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > offset) out.push({ text: source.slice(offset, match.index) });
    out.push({ text: match[0], kind: match[1] ? "string" : match[2] ? "comment" : match[3] ? "keyword" : "number" });
    offset = match.index + match[0].length;
  }
  if (offset < source.length) out.push({ text: source.slice(offset) });
  return out;
}

export function renderCode(element: HTMLElement, source: string, language: string): void {
  const fragment = document.createDocumentFragment();
  for (const token of tokens(source, language)) {
    if (!token.kind) fragment.append(document.createTextNode(token.text));
    else {
      const span = document.createElement("span");
      span.className = `token-${token.kind}`;
      span.textContent = token.text;
      fragment.append(span);
    }
  }
  element.replaceChildren(fragment);
}

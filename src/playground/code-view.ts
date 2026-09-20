/** Lightweight visual coloring only. Source text stays exact; nothing is parsed as HTML. */
export type Token = { text: string; kind?: "string" | "comment" | "keyword" | "number" };
export function tokens(source: string, language: string): Token[] {
  const comments = language === "python" || language === "curl" ? "#[^\\n]*" : "//[^\\n]*|/\\*[\\s\\S]*?\\*/";
  const pattern = new RegExp(`("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\x60(?:\\\\.|[^\x60\\\\])*\x60)|(${comments})|\\b(const|let|var|import|from|as|new|await|async|for|of|in|if|else|return|fn|use|pub|mut|true|false|null|None|True|False|Some|Ok|with|class|def|try|except|while|yield|package|func|range|defer|nil|break|continue|type|struct)\\b|\\b(\\d+(?:\\.\\d+)?)\\b`, "g");
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

/** Value positions in our generated examples, not every literal or matching word.
 * Imports, dictionary keys, transport headers and output formatting stay neutral.
 */
function controlledValue(prefix: string, token: Token): boolean {
  if (token.kind === "number") {
    return /\b(?:maxTokens|max_tokens|temperature)\s*[:=]\s*(?:Some\(\s*)?$/.test(prefix);
  }
  if (token.kind !== "string") return false;
  const apiKey = /\b(?:apiKey|api_key)\s*[:=]\s*$|\.api_key\(\s*"[^"\\]*"\s*,\s*$/.test(prefix);
  if (apiKey) return token.text !== '"unused"' && token.text !== "'unused'";
  return /(?:\b(?:model|system|baseUrl|base_url|compat|effort)|"(?:model|system|text|base_url|effort)")\s*[:=]\s*(?:Some\(\s*)?$/.test(prefix)
    || /\bMessage(?:\.|::)(?:user|assistant)\(\s*$/.test(prefix)
    || /\badapterFor\(\s*$|\.(?:api_key|base_url)\(\s*$|\.base_url\(\s*"[^"\\]*"\s*,\s*$|\bReasoning::new\(\s*$/.test(prefix);
}

export function renderCode(element: HTMLElement, source: string, language: string): void {
  const fragment = document.createDocumentFragment();
  let offset = 0;
  for (const token of tokens(source, language)) {
    const highlighted = controlledValue(source.slice(Math.max(0, offset - 256), offset), token);
    offset += token.text.length;
    if (!token.kind) fragment.append(document.createTextNode(token.text));
    else {
      const span = document.createElement("span");
      span.className = `token-${token.kind}`;
      if (highlighted && token.kind === "string") {
        // Quotes are syntax, not input. Keep copying identical to the source.
        const value = document.createElement("span");
        value.className = "token-value";
        value.textContent = token.text.slice(1, -1);
        span.append(document.createTextNode(token.text[0]!), value, document.createTextNode(token.text.at(-1)!));
      } else {
        if (highlighted) span.classList.add("token-value");
        span.textContent = token.text;
      }
      fragment.append(span);
    }
  }
  element.replaceChildren(fragment);
}

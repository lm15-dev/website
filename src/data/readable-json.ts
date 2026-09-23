/**
 * JSON laid out for reading in a narrow box: a value that fits a short line
 * stays on one line, a longer one opens up. Only whitespace changes.
 */
export function oneLine(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(oneLine).join(', ')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${oneLine(v)}`).join(', ')}}`;
  return JSON.stringify(value);
}

export function readable(value: unknown, indent = '', width = 64): string {
  const flat = oneLine(value);
  if (flat.length + indent.length <= width || value === null || typeof value !== 'object') return flat;
  const inner = indent + '  ';
  if (Array.isArray(value)) return `[\n${value.map(v => inner + readable(v, inner, width)).join(',\n')}\n${indent}]`;
  return `{\n${Object.entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${readable(v, inner, width)}`).join(',\n')}\n${indent}}`;
}

/** Text that parses as a JSON object or list, laid out; anything else as it is. */
export function readableText(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? readable(parsed) : text;
  } catch {
    return text;
  }
}

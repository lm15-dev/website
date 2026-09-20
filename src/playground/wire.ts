import { RawNumber, parseJson, stringifyJson } from "lm15/browser";
import type { Wire } from "./experience.ts";

function sorted(value: unknown): unknown {
  if (value instanceof RawNumber || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sorted);
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)]));
}
function parsed(body: string): unknown { try { return parseJson(body); } catch { return body; } }
function normalized(wire: Wire): string {
  return stringifyJson(sorted({ method: wire.method, url: wire.url, headers: Object.fromEntries(wire.headers.map(([key, value]) => [key.toLowerCase(), value]).filter(([key]) => key !== "user-agent" && key !== "anthropic-dangerous-direct-browser-access")), body: parsed(wire.body) }));
}
/** Parsed JSON equality is not byte equality: Go's maps sort keys. */
export function compareWires(wires: ReadonlyArray<readonly [string, Wire]>): string {
  if (!wires.length) return "";
  const first = wires[0]![1];
  const different = wires.filter(([, wire]) => normalized(wire) !== normalized(first)).map(([name]) => name);
  if (different.length) return `Request content differs in ${different.join(", ")}; select each runtime's Request view to inspect it.`;
  const bytes = wires.filter(([, wire]) => wire.body !== first.body).map(([name]) => name);
  const names = wires.map(([name]) => name).join(", ");
  return bytes.length
    ? `Same parsed request from ${names} ✓. Body bytes differ in ${bytes.join(", ")} (serialization, including Go's sorted object keys).`
    : `Same request body bytes from ${names} ✓ (transport-only headers excluded).`;
}

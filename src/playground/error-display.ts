/** Keep SDK diagnostics in the displayed error. The caller redacts saved keys. */
export function displayError(error: unknown): string {
  // ProviderError.toString() includes request IDs, retry advice and header
  // diagnostics that deliberately aren't part of its unchanged message.
  return error instanceof Error && error.name === "Error" ? error.message : String(error);
}

/** Strip Python stack frames, but preserve the entire final exception message. */
export function translatePythonError(error: unknown, signal: AbortSignal): Error {
  if (signal.aborted) return Object.assign(new Error("stopped"), { name: "TransportError" });
  const text = (error instanceof Error ? error.message : String(error)).trim();
  const matches = [...text.matchAll(/^(?:[\w.]+\.)?(\w*Error):[ \t]?(.*)$/gm)];
  const final = matches.at(-1);
  if (final) {
    const rest = text.slice(final.index! + final[0].length);
    return Object.assign(new Error(final[2]! + rest), { name: final[1]! });
  }
  // No recognizable exception heading: keep the previous short fallback,
  // rather than showing stack frames that may contain executable source.
  return Object.assign(new Error(text.split("\n").at(-1) || text), { name: "PythonError" });
}

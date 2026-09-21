/**
 * What a runtime says while it loads, and how it measures a download.
 *
 * The wire is gzipped, so a response's Content-Length is the compressed
 * size and counting decoded bytes against it overshoots. The build writes
 * every runtime file's real size into `vendor/sizes.json`; a download is
 * measured against that, and without it the bar is indeterminate rather
 * than wrong.
 */

export interface Progress {
  /** What is happening now, in words: "Downloading Python", "Starting Go". */
  readonly phase: string;
  /** A detail under it: "8.1 of 11.1 MB". */
  readonly detail?: string;
  /** 0..1 when the phase can be measured; absent when it cannot. */
  readonly fraction?: number;
}

export type Report = (progress: Progress) => void;

const SIZES_URL = new URL("../../vendor/sizes.json", import.meta.url).href;
let sizes: Promise<Record<string, number>> | undefined;

/** The real byte size of each runtime file, keyed by its path under `vendor/`; `{}` when the manifest is missing. */
export function fileSizes(): Promise<Record<string, number>> {
  return sizes ??= fetch(SIZES_URL).then(async (r) => (r.ok ? (await r.json()) as Record<string, number> : {})).catch(() => ({}));
}

export function megabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
}

/**
 * Fetch a file, reporting progress as its body arrives. The returned
 * Response streams the same bytes with the original headers, so it can go
 * straight into `WebAssembly.instantiateStreaming`. `expected` is the
 * decoded size to measure against; without it the report has no fraction.
 */
export async function fetchWithProgress(url: string, phase: string, expected: number | undefined, report: Report, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${phase}: HTTP ${response.status}`);
  if (!response.body) return response;
  let received = 0;
  report(expected ? { phase, detail: `0 of ${megabytes(expected)}`, fraction: 0 } : { phase });
  const counted = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      report(expected ? { phase, detail: `${megabytes(Math.min(received, expected))} of ${megabytes(expected)}`, fraction: Math.min(1, received / expected) } : { phase, detail: megabytes(received) });
      controller.enqueue(chunk);
    },
  }));
  return new Response(counted, { status: response.status, statusText: response.statusText, headers: response.headers });
}

/** Two frames of the page: enough for the loading card to paint before a long synchronous step (instantiating a wasm module) blocks the thread. */
export async function paint(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return;
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

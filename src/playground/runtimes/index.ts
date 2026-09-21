/**
 * A runtime executes the playground's request with one language's real
 * SDK. Four exist: JavaScript (this page's own `lm15/browser`), Python
 * (lm15-python under Pyodide), Rust and Go (their real SDKs compiled to wasm).
 * Each answers two questions with no network — what would go on the wire
 * — and one with: stream the reply. The chat keeps its transcript in the
 * TypeScript types; the other runtimes speak canonical JSON, which is the
 * contract's whole point.
 */

import type { Message, Request, Response } from "lm15/browser";
import type { Connection, Wire } from "../experience.ts";
import type { JudgeSource } from "../judge.ts";
import type { Report } from "./progress.ts";

export type RuntimeId = "javascript" | "python" | "rust" | "go";

export interface StreamOutcome {
  readonly response: Response;
}

export interface Runtime {
  readonly id: RuntimeId;
  readonly label: string;
  /** What runs: the honest one-line description shown under the Run switch. */
  readonly claim: string;
  loaded(): boolean;
  /** Fetch and start the runtime (Python: ~13 MB once; Go: 17 MB; the Rust codec: 1 MB). Reports each phase, measured where it can be. */
  load(report: Report): Promise<void>;
  /** The exact request this runtime would send. No network. The key is used, never returned. A judge request comes with what it was built from. */
  wire(connection: Connection, key: string | undefined, request: Request, source?: JudgeSource): Promise<Wire>;
  /** Send and stream. `onText` receives text as it arrives; the Response is the runtime's own, materialized. */
  stream(connection: Connection, key: string | undefined, request: Request, signal: AbortSignal, onText: (text: string) => void): Promise<Response>;
  /** Judge one input (judge.ts): one `complete`, one piece back. The Response is the runtime's own. `source` is the spec and input the request was built from, for a runtime that re-renders the shown program. */
  judge(connection: Connection, key: string | undefined, request: Request, signal: AbortSignal, source?: JudgeSource): Promise<Response>;
}

/** A canonical Message from a runtime that returned JSON. */
export type CanonicalMessage = ReturnType<typeof Message.toJSON>;

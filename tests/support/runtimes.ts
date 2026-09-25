import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const runtime = resolve(root, 'node_modules/@lm15/lm15/runtime');
// Tests never compile SDKs or silently skip a missing installed runtime.
export function ensureWheel(): { path: string } {
  const wheels = readdirSync(runtime).filter(name => /^lm15-.*-py3-none-any\.whl$/.test(name));
  if (wheels.length !== 1) throw new Error('Install the pinned runtime package with npm ci');
  return { path: resolve(runtime, wheels[0]!) };
}
export function ensureRustWasm(): { path: string } {
  const path = process.env['LM15_TEST_RUST_WASM'] ? resolve(process.env['LM15_TEST_RUST_WASM']) : resolve(runtime, 'lm15.wasm');
  if (!existsSync(path)) throw new Error('Install the pinned runtime package with npm ci');
  return { path };
}

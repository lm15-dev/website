/**
 * Collect what the playground's R runtime needs from lm15-r's webR build
 * (`bash tools/build-webr.sh <out>`): webR's worker runtime and R's virtual
 * filesystem (not its REPL page or source maps), the WebAssembly package
 * repository (lm15 and its imports), the lm15 browser bridge, and licenses.
 *
 *   node scripts/vendor-r.mjs <webr-build-dir> <lm15-r-checkout> <destination>
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [build, checkout, destination] = process.argv.slice(2).map(p => resolve(p));
if (!build || !checkout || !destination) throw new Error('usage: vendor-r.mjs <webr-build-dir> <lm15-r-checkout> <destination>');
rmSync(destination, { recursive: true, force: true });
mkdirSync(join(destination, 'runtime'), { recursive: true });
for (const name of ['webr.mjs', 'webr-worker.js', 'R.js', 'R.wasm', 'libRblas.so', 'libRlapack.so']) cpSync(join(build, 'runtime', name), join(destination, 'runtime', name));
cpSync(join(build, 'runtime/vfs'), join(destination, 'runtime/vfs'), { recursive: true });
if (!readFileSync(join(destination, 'runtime/R.wasm')).subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) throw new Error('Invalid R.wasm');
const contrib = join(build, 'repo/bin/emscripten/contrib');
const versions = readdirSync(contrib);
if (versions.length !== 1) throw new Error(`Expected one R version in the webR repository, found ${versions.join(', ')}`);
const packages = readdirSync(join(contrib, versions[0]));
for (const name of ['lm15', 'jsonlite', 'curl', 'openssl', 'askpass', 'sys']) {
  if (!packages.some(file => file.startsWith(`${name}_`) && file.endsWith('.tgz'))) throw new Error(`The webR repository has no ${name}`);
}
cpSync(join(build, 'repo'), join(destination, 'repo'), { recursive: true });
cpSync(join(checkout, 'inst/browser/lm15.mjs'), join(destination, 'lm15.mjs'));
mkdirSync(join(destination, 'licenses'), { recursive: true });
cpSync(join(build, 'runtime/COPYING-R.txt'), join(destination, 'licenses/r-gpl.txt'));
cpSync(join(build, 'runtime/LICENSE-webR.md'), join(destination, 'licenses/webr.txt'));
cpSync(join(checkout, 'LICENSE.md'), join(destination, 'licenses/lm15-r.txt'));
if (!existsSync(join(destination, 'runtime/vfs'))) throw new Error('Missing R filesystem');
console.log(`R runtime for webR (R ${versions[0]}) collected in ${destination}`);

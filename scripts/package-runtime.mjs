/** Package freshly built, pinned SDKs as an installable website dependency. */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sources = resolve(process.argv[2] ?? '.runtime-build');
const pins = JSON.parse(readFileSync(resolve(root, 'sources.json'), 'utf8'));
for (const [key, repo] of Object.entries({ typescript: 'lm15-ts', python: 'lm15-python', rust: 'lm15-rs', contract: 'lm15-contract' })) {
  const revision = execFileSync('git', ['-C', resolve(sources, repo), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (revision !== pins[key]) throw new Error(`${repo} does not match sources.json`);
}
const staging = resolve(root, '.build/runtime-package');
rmSync(staging, { recursive: true, force: true });
mkdirSync(resolve(staging, 'runtime/licenses'), { recursive: true });
const sdk = resolve(sources, 'lm15-ts');
for (const name of ['dist', 'LICENSE', 'README.md']) cpSync(resolve(sdk, name), resolve(staging, name), { recursive: true });
const pkg = JSON.parse(readFileSync(resolve(sdk, 'package.json'), 'utf8'));
// Installation runs no SDK scripts and needs no sibling checkout or compiler.
delete pkg.scripts;
delete pkg.devDependencies;
pkg.files = ['dist', 'runtime', 'LICENSE', 'README.md'];
writeFileSync(resolve(staging, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
const wheels = readdirSync(resolve(sdk, 'vendor/python')).filter(name => /^lm15-.*-py3-none-any\.whl$/.test(name));
if (wheels.length !== 1) throw new Error('Expected exactly one freshly built wheel');
cpSync(resolve(sdk, 'vendor/python', wheels[0]), resolve(staging, 'runtime', wheels[0]));
cpSync(resolve(sdk, 'vendor/rust/lm15.wasm'), resolve(staging, 'runtime/lm15.wasm'));
if (!readFileSync(resolve(staging, 'runtime/lm15.wasm')).subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))) throw new Error('Invalid wasm file');
cpSync(resolve(sdk, 'vendor/rust/THIRD_PARTY_LICENSES.txt'), resolve(staging, 'runtime/licenses/rust-dependencies.txt'));
for (const language of ['python', 'rs']) cpSync(resolve(sources, `lm15-${language}/LICENSE`), resolve(staging, `runtime/licenses/lm15-${language}.txt`));
writeFileSync(resolve(staging, 'runtime/sources.json'), JSON.stringify(pins, null, 2) + '\n');
execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', resolve(root, '.build')], { cwd: staging, stdio: 'inherit' });

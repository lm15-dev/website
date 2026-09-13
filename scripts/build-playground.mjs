/** Build the playground separately from Astro: no docs scripts run on the key-bearing page. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(import.meta.dirname, '..');
export const siteDir = join(root, 'dist');
export const generatedDir = join(root, '.build/public');
const sdk = join(root, 'node_modules/lm15');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlink: ${path}`);
    return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : [];
  }).sort();
}
export function buildPlayground() {
  const pins = JSON.parse(readFileSync(join(root, 'sources.json'), 'utf8'));
  const builtPins = JSON.parse(readFileSync(join(sdk, 'runtime/sources.json'), 'utf8'));
  if (JSON.stringify(pins) !== JSON.stringify(builtPins)) throw new Error('sources.json and the installed runtime package differ. Install the matching runtime release.');
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.playground.json'], { cwd: root, stdio: 'inherit' });
  const staging = join(root, '.build/staging');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const copy = (source, target) => {
    mkdirSync(dirname(join(staging, target)), { recursive: true });
    copyFileSync(source, join(staging, target));
  };
  // Explicit public allowlist: never copy repository roots, credentials, maps, or test servers.
  for (const [source, target] of [[join(sdk, 'dist'), 'dist'], [join(root, '.build/playground'), 'playground']]) {
    for (const file of filesUnder(source)) {
      const path = relative(source, file);
      if (path.endsWith('.js') && !path.startsWith('cjs/')) copy(file, `${target}/${path}`);
    }
  }
  copy(join(root, 'src/playground/app.css'), 'playground/app.css');
  copy(join(root, 'src/styles/theme.css'), 'playground/theme.css');
  const wheels = readdirSync(join(sdk, 'runtime')).filter(name => /^lm15-.*-py3-none-any\.whl$/.test(name));
  if (wheels.length !== 1) throw new Error('Expected one Python wheel');
  copy(join(sdk, 'runtime', wheels[0]), 'vendor/python/lm15.whl');
  copy(join(sdk, 'runtime/lm15.wasm'), 'vendor/rust/lm15.wasm');
  for (const name of ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) {
    copy(join(root, 'node_modules/pyodide', name), `vendor/pyodide/${name}`);
  }
  copy(join(sdk, 'LICENSE'), 'licenses/lm15-typescript.txt');
  for (const [source, target] of [[join(sdk, 'runtime/licenses'), 'licenses'], [join(root, 'public/licenses'), 'licenses']]) {
    for (const file of filesUnder(source)) copy(file, `${target}/${relative(source, file)}`);
  }
  const provenance = { ...pins, pyodide: JSON.parse(readFileSync(join(root, 'node_modules/pyodide/package.json'), 'utf8')).version };
  writeFileSync(join(staging, 'sources.json'), JSON.stringify(provenance, null, 2) + '\n');
  const files = Object.fromEntries(filesUnder(staging).map(path => [relative(staging, path), sha256(readFileSync(path))]));
  const release = sha256(JSON.stringify(files)).slice(0, 20);
  const prefix = `/assets/${release}`;
  // Old content-addressed files remain during dev so an open tab does not break mid-edit.
  // Production starts with a clean generated directory (see the build command).
  mkdirSync(join(generatedDir, 'assets'), { recursive: true });
  rmSync(join(generatedDir, prefix), { recursive: true, force: true });
  renameSync(staging, join(generatedDir, prefix));
  let html = readFileSync(join(root, 'src/playground/index.html'), 'utf8');
  const oldMap = html.match(/<script type="importmap">(.*?)<\/script>/)?.[1];
  if (!oldMap) throw new Error('Missing import map');
  const hash = text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
  if (!html.includes(hash(oldMap))) throw new Error('Import map is not covered by the page CSP');
  const newMap = JSON.stringify({ imports: { 'lm15/browser': `${prefix}/dist/browser.js` } });
  html = html.replace(oldMap, newMap).replace(hash(oldMap), hash(newMap))
    .replace('href="./app.css"', `href="${prefix}/playground/app.css"`)
    .replace('src="./build/main.js"', `src="${prefix}/playground/main.js"`)
    .replace("connect-src 'self' https: http://localhost:* http://127.0.0.1:*", "connect-src 'self' https:")
    .replace('</head>', '<meta name="description" content="Try LM15 in JavaScript, Python and Rust, directly in your browser.">\n<link rel="canonical" href="https://lm15.dev/playground/">\n</head>');
  mkdirSync(join(generatedDir, 'playground/about'), { recursive: true });
  writeFileSync(join(generatedDir, 'playground/index.html'), html);
  writeFileSync(join(generatedDir, 'playground/about/index.html'), readFileSync(join(root, 'src/playground/about.html'), 'utf8').replaceAll('__ASSETS__', prefix));
  const manifest = JSON.stringify({ release, ...provenance, files }, null, 2) + '\n';
  writeFileSync(join(generatedDir, 'playground/release.json'), manifest);
  writeFileSync(join(generatedDir, 'release.json'), manifest); // Preserve the former public URL.
  for (const file of filesUnder(join(root, 'public'))) {
    const dest = join(generatedDir, relative(join(root, 'public'), file));
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
  }
  console.log(`Playground ${release}: ${Object.keys(files).length} public assets`);
  return release;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  rmSync(generatedDir, { recursive: true, force: true });
  rmSync(join(root, '.build/playground'), { recursive: true, force: true });
  buildPlayground();
}

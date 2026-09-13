import { spawn } from 'node:child_process';
import { watch } from 'chokidar';
import { buildPlayground } from './build-playground.mjs';

buildPlayground();
const child = spawn(process.execPath, ['node_modules/astro/bin/astro.mjs', 'dev', '--host', '127.0.0.1', ...process.argv.slice(2)], { stdio: 'inherit' });
let timer;
const watcher = watch(['src/playground', 'src/styles/theme.css', 'public', 'sources.json'], { ignoreInitial: true });
watcher.on('all', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try { buildPlayground(); } catch (error) { console.error('Playground rebuild failed; fix the error and save again.', error); }
  }, 150);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', async code => { clearTimeout(timer); await watcher.close(); process.exitCode = code ?? 0; });

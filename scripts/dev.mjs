import { spawn } from 'node:child_process';
import { watch } from 'chokidar';
import { buildPlayground } from './build-playground.mjs';

buildPlayground();
let child;
let timer;
let restartTimer;
let restartRequested = false;
let stopping = false;
const watcher = watch(['src/playground', 'src/styles/theme.css', 'public', 'sources.json', 'social-card.mjs'], { ignoreInitial: true });
const navigationWatcher = watch(['navigation.mjs', 'social-card.mjs', 'src/content/docs'], { ignoreInitial: true });

function startAstro() {
  child = spawn(process.execPath, ['node_modules/astro/bin/astro.mjs', 'dev', '--host', '127.0.0.1', ...process.argv.slice(2)], { stdio: 'inherit' });
  child.on('error', error => console.error('Could not start the website server.', error));
  child.on('close', async code => {
    if (restartRequested && !stopping) {
      restartRequested = false;
      startAstro();
      return;
    }
    stopping = true;
    clearTimeout(timer);
    clearTimeout(restartTimer);
    await Promise.all([watcher.close(), navigationWatcher.close()]);
    process.exitCode = code ?? 0;
  });
}

watcher.on('all', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (stopping) return;
    try { buildPlayground(); } catch (error) { console.error('Playground rebuild failed; fix the error and save again.', error); }
  }, 150);
});

// Imported menu configuration and added/deleted pages need a fresh Astro
// process. Ordinary content edits still use Astro's instant page refresh.
navigationWatcher.on('all', (event, path) => {
  if (!['navigation.mjs', 'social-card.mjs'].includes(path) && !['add', 'unlink', 'addDir', 'unlinkDir'].includes(event)) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (stopping) return;
    console.log('Reloading website navigation and pages…');
    restartRequested = true;
    child.kill('SIGTERM');
  }, 400);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  stopping = true;
  clearTimeout(timer);
  clearTimeout(restartTimer);
  child.kill(signal);
});
startAstro();

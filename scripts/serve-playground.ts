/** Loopback-only playground server; private credential handoff is explicit and one-use. */
import { createServer, type Server } from 'node:http';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { CONNECTIONS } from '../src/playground/connections.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = resolve(root, '.build/public');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.whl': 'application/zip', '.zip': 'application/zip', '.txt': 'text/plain', '.svg': 'image/svg+xml' };
/** Loopback, or a Tailscale address (100.64.0.0/10: WireGuard between this person's own machines). */
export function privateHost(host: string): boolean {
  if (['127.0.0.1', 'localhost', '::1'].includes(host)) return true;
  const m = /^100\.(\d+)\.\d+\.\d+$/.exec(host);
  return m !== null && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}
/**
 * `host` defaults to loopback. Another address is allowed for the page alone; the private key handoff
 * (`envFile`) is allowed only on loopback or a Tailscale address, where the wire is this person's own.
 * `rememberKeys` asks the page to keep the handed-over keys encrypted on that device instead of in the tab.
 */
export async function startDemo(options: { envFile?: string; port?: number; host?: string; rememberKeys?: boolean } = {}): Promise<{ server: Server; url: string; browserUrl: string; providers: string[] }> {
  const host = options.host ?? '127.0.0.1';
  if (options.envFile && !privateHost(host)) throw new Error(`Private keys are handed over on loopback or Tailscale only; not on ${host}. Paste keys in the page instead.`);
  const credentials: Record<string, string> = {};
  if (options.envFile) {
    const values = parseEnv(readFileSync(options.envFile, 'utf8'));
    for (const choice of CONNECTIONS) if (choice.env && values[choice.env]) credentials[choice.id] = values[choice.env]!;
  }
  const providers = Object.keys(credentials);
  const token = providers.length ? randomBytes(32).toString('base64url') : '';
  const expires = Date.now() + 30 * 60_000;
  let used = false;
  let origin = '';
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    if (req.headers.host !== new URL(origin).host) { res.writeHead(403).end(); return; }
    const url = new URL(req.url ?? '/', origin);
    if (url.pathname === '/__lm15_test_credentials') {
      const supplied = req.headers['x-lm15-test-token'];
      const matches = typeof supplied === 'string' && Buffer.byteLength(supplied) === Buffer.byteLength(token) && token !== ''
        && timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
      if (req.method !== 'GET' || used || Date.now() > expires || !matches
        || (req.headers.origin !== undefined && req.headers.origin !== origin)
        || (req.headers['sec-fetch-site'] !== undefined && req.headers['sec-fetch-site'] !== 'same-origin')) {
        res.writeHead(403).end(); return;
      }
      used = true;
      res.writeHead(200, { 'Content-Type': 'application/json', ...(options.rememberKeys ? { 'X-LM15-Remember': '1' } : {}) }).end(JSON.stringify(credentials));
      for (const key of Object.keys(credentials)) delete credentials[key];
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(405).end(); return; }
    if (url.pathname === '/') { res.writeHead(302, { Location: '/playground/' }).end(); return; }
    try {
      const pathname = url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname;
      const file = realpathSync(resolve(publicDir, '.' + pathname));
      if (!file.startsWith(publicDir + sep) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
      let body: Buffer | string = readFileSync(file);
      if (pathname === '/playground/index.html') body = body.toString().replace("connect-src 'self' https:", "connect-src 'self' https: http://localhost:* http://127.0.0.1:*");
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' }).end(req.method === 'HEAD' ? undefined : body);
    } catch { res.writeHead(404).end('Not found. Run npm run build first.'); }
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(options.port ?? 0, host, done); });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Expected a loopback TCP address');
  origin = `http://${host.includes(':') ? `[${host}]` : host}:${addr.port}`;
  const url = `${origin}/playground/`;
  return { server, url, browserUrl: token ? `${url}#local-test=${token}` : url, providers };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const local = process.argv.includes('--local-keys');
  const rememberKeys = process.argv.includes('--remember-keys');
  const demo = await startDemo({ ...(local ? { envFile: resolve(root, '../.env') } : {}), port: Number(process.env['PORT'] ?? 0), ...(process.env['HOST'] ? { host: process.env['HOST'] } : {}), rememberKeys });
  console.log(`LM15 playground: ${demo.url}`);
  if (local) console.log(`Private local test keys: ${demo.providers.join(', ') || 'none found'}. Keys are never printed in the page${rememberKeys ? '; the page keeps them encrypted on the device (More → Forget all keys removes them)' : ' or saved'}.\nOne-use link (30 minutes): ${demo.browserUrl}`);
  if (process.argv.includes('--open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
    spawn(opener, [demo.browserUrl], { stdio: 'ignore' }).on('error', () => console.error('Could not open a browser automatically.'));
  }
}

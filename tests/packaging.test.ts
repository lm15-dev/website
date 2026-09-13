import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { checkLinks } from '../scripts/check-links.mjs';
import { filesUnder } from '../scripts/build-playground.mjs';

test('link checker rejects broken pages, assets, and anchors', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'lm15-links-'));
  try {
    mkdirSync(resolve(dir, 'docs'));
    writeFileSync(resolve(dir, 'docs/index.html'), '<h1 id="start">Start</h1>');
    writeFileSync(resolve(dir, 'index.html'), '<a href="/docs/#start">Docs</a><a href="https://example.com/">External</a>');
    assert.equal(checkLinks(dir), 2);
    for (const markup of ['<a href="/missing/">Missing</a>', '<img src="/missing.svg">', '<a href="/docs/#missing">Missing anchor</a>']) {
      writeFileSync(resolve(dir, 'index.html'), markup);
      assert.throws(() => checkLinks(dir), /missing/i);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('published playground files match their checksums and include no private or development files', () => {
  const dir = resolve('dist');
  const manifest = JSON.parse(readFileSync(resolve(dir, 'playground/release.json'), 'utf8'));
  for (const [name, expected] of Object.entries(manifest.files)) {
    const content = readFileSync(resolve(dir, 'assets', manifest.release, name));
    assert.equal(createHash('sha256').update(content).digest('hex'), expected, name);
  }
  for (const file of filesUnder(dir)) {
    const relative = file.slice(dir.length + 1);
    assert.ok(!/(^|\/)(\.env[^/]*|\.git|node_modules|__playground[^/]*|__lm15[^/]*|scripts|tests)(\/|$)/.test(relative), relative);
    assert.ok(!file.endsWith('.map'), 'Do not publish source maps');
  }
  const html = readFileSync(resolve(dir, 'playground/index.html'), 'utf8');
  assert.ok(!html.includes('__playground_dev'));
  assert.ok(!html.includes('http://localhost:'));
  const map = html.match(/<script type="importmap">(.*?)<\/script>/)?.[1];
  assert.ok(map);
  const hash = createHash('sha256').update(map).digest('base64');
  assert.ok(html.includes(`'sha256-${hash}'`), 'The import map must be allowed by the exact CSP hash');
  assert.ok(!html.includes('/_astro/'), 'Documentation scripts do not run on the key-bearing playground');
});

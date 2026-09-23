import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { findBrowsers } from './support/browser.ts';
import { CONNECTIONS } from '../src/playground/connections.ts';

const directory = resolve(import.meta.dirname, '../dist');
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

test('first-request setup follows the selected provider and language', { timeout: 90_000 }, async () => {
  const installed = findBrowsers().find(item => item.name === 'chromium');
  assert.ok(installed, 'Chromium is required');
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const file = resolve(directory, '.' + (path.endsWith('/') ? path + 'index.html' : path));
    if (!file.startsWith(directory + sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end(); return;
    }
    response.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ executablePath: installed.bin });
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    // No provider requests or live catalog dependency in documentation tests.
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    for (const provider of CONNECTIONS.filter(item => item.env && !('judgmentsOnly' in item))) {
      await page.goto(`${origin}/docs/first-request/?language=python&provider=${provider.id}&model=test-model`);
      await page.locator('[data-doc-controls][data-ready]').waitFor();
      assert.match(await page.locator('[data-doc-install]').innerText(), /python3 -m pip install --pre lm15/);
      assert.equal(await page.locator('[data-doc-setup]').count(), 0);
      assert.equal(await page.locator('[data-doc-key-provider]:visible').count(), 1);
      assert.ok((await page.locator('[data-doc-key-provider]:visible a').getAttribute('href'))?.startsWith('https://'));
      assert.equal(await page.locator('[data-doc-key-posix]').textContent(), `export ${provider.env}="your-api-key"`);
      assert.equal(await page.locator('[data-doc-key-powershell]').textContent(), `$env:${provider.env} = "your-api-key"`);
      assert.equal(await page.locator('[data-doc-key-cmd]').textContent(), `set ${provider.env}=your-api-key`);
      assert.match(await page.locator('[data-doc-key-error-source]').textContent() ?? '', new RegExp(provider.env));
      assert.ok((await page.locator('[data-doc-source]').first().textContent())?.includes(`${provider.id}:test-model`));
    }
    await page.locator('[data-doc-language]').click();
    await page.getByRole('option', { name: 'TypeScript', exact: true }).click();
    assert.equal(await page.locator('[data-doc-install-language="python"]').isVisible(), false);
    assert.equal(await page.locator('[data-doc-python-auth]').isVisible(), false);
    assert.match(await page.locator('[data-doc-install]').innerText(), /TypeScript SDK guide/);
    assert.match(await page.locator('[data-doc-source]').first().textContent() ?? '', /import \{ LMRouter, Message \} from "lm15"/);

    await page.locator('[data-doc-provider]').click();
    await page.getByRole('option', { name: 'OpenAI', exact: true }).click();
    assert.equal(await page.locator('[data-doc-key-posix]').textContent(), 'export OPENAI_API_KEY="your-api-key"');
    assert.ok((await page.locator('[data-doc-source]').first().textContent())?.includes('openai:model'));
    await page.locator('[data-doc-provider]').click();
    await page.getByRole('option', { name: /Clear selection/ }).click();
    assert.equal(await page.locator('[data-doc-key-provider]:visible').count(), 9);
    assert.equal(await page.locator('[data-doc-key-posix]').textContent(), 'export YOUR_PROVIDER_API_KEY="your-api-key"');
    assert.equal(await page.locator('[data-doc-key-prompt]').isVisible(), true);

    const staticPage = await browser.newPage({ javaScriptEnabled: false });
    await staticPage.goto(`${origin}/docs/first-request/`);
    assert.match(await staticPage.locator('[data-doc-install]').innerText(), /python3 -m pip install --pre lm15/);
    assert.equal(await staticPage.locator('[data-doc-key-provider]:visible').count(), 9);
    assert.deepEqual(await staticPage.locator('main h2').allTextContents(), ['Install', 'Set an API key', 'Ask a question', 'Read the whole response', 'Give it instructions', 'Ask a follow-up', 'Watch it arrive', 'Use another provider', 'When something goes wrong', 'Try it yourself', 'Next']);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  }
});

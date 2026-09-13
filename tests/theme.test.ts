import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { findBrowsers } from './support/browser.ts';

const theme = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8');
const sheets = {
  home: '../src/styles/home.css',
  docs: '../src/styles/docs.css',
  playground: '../src/playground/app.css',
};

test('all sections use the shared brand, with readable light and dark accents', async () => {
  const installed = findBrowsers().find(browser => browser.name === 'chromium');
  assert.ok(installed, 'Chromium is required');
  const browser = await chromium.launch({ executablePath: installed.bin });
  try {
    const page = await browser.newPage();
    for (const [section, path] of Object.entries(sheets)) {
      const css = readFileSync(new URL(path, import.meta.url), 'utf8');
      assert.ok(css.includes("@import './theme.css'"), `${section} imports the shared theme`);
      for (const preference of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: preference });
        await page.setContent(`<style>${theme}\n${css.replace("@import './theme.css';", '')}</style><button class="button primary">Test</button>`);
        for (const override of section === 'docs' ? ['', 'light', 'dark'] : ['']) {
          await page.evaluate(value => {
            if (value) document.documentElement.dataset['theme'] = value;
            else delete document.documentElement.dataset['theme'];
          }, override);
          const result = await page.evaluate(({ section, dark }) => {
            const style = getComputedStyle(document.documentElement);
            const pixel = (color: string) => {
              const canvas = document.createElement('canvas');
              canvas.width = canvas.height = 1;
              const ctx = canvas.getContext('2d')!;
              ctx.fillStyle = color;
              ctx.fillRect(0, 0, 1, 1);
              return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
            };
            const rgb = (variable: string) => pixel(style.getPropertyValue(variable).trim());
            const contrast = (a: number[], b: number[]) => {
              const luminance = (values: number[]) => values.map(v => {
                v /= 255;
                return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
              }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
              const first = luminance(a), second = luminance(b);
              return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
            };
            const brand = rgb('--lm-brand');
            const accent = rgb(section === 'docs' ? '--sl-color-accent' : '--accent');
            const expectedAccent = rgb(dark ? '--lm-accent-dark' : '--lm-accent-light');
            const button = getComputedStyle(document.querySelector('button')!);
            return {
              brand, accent, expectedAccent,
              background: pixel(button.backgroundColor),
              buttonContrast: contrast(brand, rgb('--lm-on-brand')),
              accentContrast: contrast(accent, dark ? [21, 28, 24] : [255, 255, 255]),
            };
          }, { section, dark: (override || preference) === 'dark' });
          assert.deepEqual(result.accent, result.expectedAccent, `${section}: ${preference}/${override}`);
          if (section !== 'docs') assert.deepEqual(result.background, result.brand, `${section}: primary button uses the brand`);
          assert.ok(result.buttonContrast >= 4.5, `${section}: readable button text`);
          assert.ok(result.accentContrast >= 4.5, `${section}: readable accent text`);
        }
      }
    }
  } finally { await browser.close(); }
});

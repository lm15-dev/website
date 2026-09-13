import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { chromium } from 'playwright-core';

export function findBrowsers(): Array<{ name: string; bin: string }> {
  const configured = process.env['CHROMIUM_PATH'];
  if (configured) return existsSync(configured) ? [{ name: 'chromium', bin: configured }] : [];
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
      const bin = join(dir, name);
      if (existsSync(bin)) return [{ name: 'chromium', bin }];
    }
  }
  const bin = chromium.executablePath();
  return existsSync(bin) ? [{ name: 'chromium', bin }] : [];
}

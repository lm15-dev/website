import type { Page } from 'playwright-core';

export async function openMore(page: Page): Promise<void> {
  if (!await page.locator('#more-menu').evaluate(element => (element as HTMLDetailsElement).open)) await page.locator('#more-toggle').click();
}

export async function disableDiscovery(page: Page): Promise<void> {
  await openMore(page);
  await page.getByLabel('Automatically discover model IDs').uncheck();
  await page.locator('#more-toggle').press('Escape');
}

export async function focusSettings(page: Page): Promise<void> {
  if (!await page.locator('#settings').isVisible()) await page.locator('[data-view-target="settings"]').click();
  await page.getByLabel('System prompt').focus();
}

export async function waitRuntimeReady(page: Page, language: string): Promise<void> {
  await page.waitForFunction(name => {
    const selected = document.querySelector<HTMLButtonElement>('[data-language][aria-pressed="true"]');
    return selected?.dataset.language === name.toLowerCase() && document.getElementById('code-tabs')?.dataset.state === 'ready';
  }, language, { timeout: 120_000 });
}

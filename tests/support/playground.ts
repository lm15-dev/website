import type { Page } from 'playwright-core';

export async function openMore(page: Page): Promise<void> {
  if (!await page.locator('#more-menu').evaluate(element => (element as HTMLDetailsElement).open)) await page.locator('#more-toggle').click();
}

export async function disableDiscovery(page: Page): Promise<void> {
  await openMore(page);
  await page.getByLabel('Automatically discover model IDs').uncheck();
  await page.locator('#more-toggle').press('Escape');
}

/** The system prompt heads the conversation; on a narrow screen that is the Chat view. */
export async function focusSettings(page: Page): Promise<void> {
  if (!await page.locator('#system').isVisible()) await page.locator('[data-view-target="chat"]').click();
  await page.getByLabel('System prompt').focus();
}

/** The provider list, where each provider's key lives. Opens it unless it is already the open picker. */
export async function openProviders(page: Page): Promise<void> {
  const open = await page.locator('#picker').evaluate(d => (d as HTMLDialogElement).open && d.dataset['kind'] === 'provider');
  if (!open) await page.getByRole('button', { name: 'Choose provider', exact: true }).click();
}

export async function closePicker(page: Page): Promise<void> {
  if (await page.locator('#picker').evaluate(d => (d as HTMLDialogElement).open)) await page.locator('#picker').evaluate(d => (d as HTMLDialogElement).close());
}

/**
 * Paste a key beside its provider and press Enter: the row shows the key masked, that provider becomes
 * the current one, and the list is closed again. `label` is the provider's name as the list shows it.
 */
export async function useKey(page: Page, label: string, key: string, options: { remember?: boolean } = {}): Promise<void> {
  await openProviders(page);
  const remember = page.getByLabel('Remember keys on this device (encrypted)');
  if (options.remember) await remember.check(); else await remember.uncheck();
  const field = page.getByLabel(`${label} API key`, { exact: true });
  await field.fill(key);
  await field.press('Enter');
  await page.getByRole('button', { name: `Forget the ${label} key`, exact: true }).waitFor();
  await closePicker(page);
}

/** Forget one provider's key from its row. */
export async function forgetKey(page: Page, label: string): Promise<void> {
  await openProviders(page);
  await page.getByRole('button', { name: `Forget the ${label} key`, exact: true }).click();
  await page.getByLabel(`${label} API key`, { exact: true }).waitFor();
  await closePicker(page);
}

/** The current provider's key state, as the provider button's title carries it: "Key ready (this tab)", "… (remembered on this device)", "" for none. */
export function keyState(page: Page): Promise<string> {
  return page.locator('#provider-button').evaluate(b => (b as HTMLButtonElement).title.split(' · ').slice(1).join(' · '));
}
export async function waitKeyState(page: Page, expected: string | RegExp): Promise<void> {
  await page.waitForFunction(([source, flags, exact]) => {
    const state = (document.getElementById('provider-button') as HTMLButtonElement).title.split(' · ').slice(1).join(' · ');
    return exact === null ? new RegExp(source, flags).test(state) : state === exact;
  }, expected instanceof RegExp ? [expected.source, expected.flags, null] as const : ['', '', expected] as const);
}

export async function waitRuntimeReady(page: Page, language: string): Promise<void> {
  await page.waitForFunction(name => {
    const selected = document.querySelector<HTMLButtonElement>('[data-language][aria-pressed="true"]');
    return selected?.dataset.language === name.toLowerCase() && document.getElementById('code-tabs')?.dataset.state === 'ready';
  }, language, { timeout: 120_000 });
}

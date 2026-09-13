import { DEFAULT_SELECTION, LANGUAGES, PROVIDERS, RECIPES, SETUP, readSelection, refreshModels, validModel, type DocSelection, type Recipe } from '../data/docs-examples';

import { setupPickers } from './home-example/picker';

const languageKey = 'lm15-docs-language';
let selection: DocSelection = { ...DEFAULT_SELECTION };

function load(): void {
  let language = DEFAULT_SELECTION.language;
  try {
    language = LANGUAGES.find(item => item.id === localStorage.getItem(languageKey))?.id ?? language;
  } catch { /* Selection still works when browser storage is disabled. */ }
  // Provider and model start empty unless explicitly supplied in a shared link.
  selection = readSelection(new URLSearchParams(location.search), { ...DEFAULT_SELECTION, language });
}

function render(): void {
  const provider = PROVIDERS.find(item => item.id === selection.provider);
  for (const controls of document.querySelectorAll<HTMLElement>('[data-doc-controls]')) {
    controls.querySelector<HTMLButtonElement>('[data-doc-language]')!.textContent = LANGUAGES.find(item => item.id === selection.language)!.label;
    controls.querySelector<HTMLButtonElement>('[data-doc-provider]')!.textContent = provider?.label ?? 'Providers';
    const model = controls.querySelector<HTMLButtonElement>('[data-doc-model]')!;
    model.textContent = selection.model || 'Models';
    model.disabled = !provider;
    model.title = provider ? (selection.model || 'Released in the last 12 months, newest first. Source: models.dev.') : 'Choose a provider first.';
    controls.querySelector('[data-doc-control-status]')!.textContent = '';
  }
  for (const root of document.querySelectorAll<HTMLElement>('[data-docs-example]')) {
    const setup = root.querySelector<HTMLAnchorElement>('[data-doc-setup]')!;
    setup.href = SETUP[selection.language].href;
    setup.textContent = SETUP[selection.language].text;
    const auth = root.querySelector('[data-doc-auth]')!;
    if (provider) {
      const key = document.createElement('code');
      key.textContent = provider.env;
      auth.replaceChildren('Set ', key, ` to your own API key before running this example. Running it sends a real request to ${provider.label} and may cost money.`);
    } else {
      auth.textContent = 'Choose a provider and model at the top of the page to fill in this example.';
    }
    root.querySelector('[data-doc-source]')!.textContent = RECIPES[root.dataset['recipe'] as Recipe](selection);
    root.querySelector('[data-doc-status]')!.textContent = '';
  }
}

function update(): void {
  try { localStorage.setItem(languageKey, selection.language); } catch { /* Optional persistence. */ }
  const url = new URL(location.href);
  for (const [key, value] of Object.entries(selection)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  history.replaceState(null, '', url);
  render();
}

export function setupDocsExamples(): void {
  const controls = [...document.querySelectorAll<HTMLElement>('[data-doc-controls]:not([data-ready])')];
  const roots = [...document.querySelectorAll<HTMLElement>('[data-docs-example]:not([data-ready])')];
  if (!controls.length && !roots.length) return;
  load();
  for (const root of controls) {
    root.dataset['ready'] = 'true';
    const modelControl = root.querySelector<HTMLButtonElement>('[data-doc-model]')!;
    const dialog = root.querySelector<HTMLDialogElement>('[data-doc-model-dialog]')!;
    const customModel = root.querySelector<HTMLInputElement>('[data-doc-custom-model]')!;
    setupPickers(root.querySelector<HTMLElement>('[data-doc-picker]')!, [
      {
        control: root.querySelector<HTMLButtonElement>('[data-doc-language]')!,
        label: 'Language',
        options: () => LANGUAGES.map(item => ({ value: item.id, label: item.label })),
        value: () => selection.language,
        choose: value => {
          const language = LANGUAGES.find(item => item.id === value);
          if (language) { selection.language = language.id; update(); }
        },
      },
      {
        control: root.querySelector<HTMLButtonElement>('[data-doc-provider]')!,
        label: 'Providers',
        options: () => [{ value: '', label: 'Providers', detail: 'Clear selection' }, ...PROVIDERS.map(item => ({ value: item.id, label: item.label }))],
        value: () => selection.provider,
        choose: value => { selection.provider = value; selection.model = ''; update(); },
      },
      {
        control: modelControl,
        label: 'Models · newest first',
        options: () => [
          { value: '', label: 'Models', detail: 'Clear selection' },
          ...(PROVIDERS.find(item => item.id === selection.provider)?.models ?? []).map(id => ({ value: id, label: id })),
          { value: '__custom__', label: 'Enter a model ID…' },
        ],
        value: () => selection.model,
        choose: value => {
          if (value === '__custom__') {
            customModel.value = selection.model;
            customModel.setCustomValidity('');
            queueMicrotask(() => { dialog.showModal(); customModel.focus(); });
          } else { selection.model = value; update(); }
        },
      },
    ]);
    root.querySelector('[data-doc-model-cancel]')!.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => modelControl.focus());
    customModel.addEventListener('input', () => customModel.setCustomValidity(''));
    root.querySelector<HTMLFormElement>('[data-doc-model-form]')!.addEventListener('submit', event => {
      event.preventDefault();
      const value = customModel.value.trim();
      if (!validModel(value)) {
        customModel.setCustomValidity('Enter a model ID without spaces or quotes.');
        customModel.reportValidity();
        return;
      }
      selection.model = value;
      dialog.close();
      update();
    });
  }
  for (const root of roots) {
    root.dataset['ready'] = 'true';
    root.querySelector<HTMLButtonElement>('[data-doc-copy]')!.addEventListener('click', async () => {
      const source = root.querySelector('[data-doc-source]')!.textContent ?? '';
      const status = root.querySelector('[data-doc-status]')!;
      try {
        await navigator.clipboard.writeText(source + '\n');
        status.textContent = source === root.querySelector('[data-doc-source]')!.textContent
          ? 'Code copied.' : 'Previous example copied. Copy again for your new choices.';
      } catch { status.textContent = 'Could not copy. Select the code and copy it manually.'; }
    });
  }
  render();
  void refreshModels().then(fresh => {
    for (const control of document.querySelectorAll<HTMLElement>('[data-doc-controls]')) {
      control.querySelector<HTMLButtonElement>('[data-doc-model]')!.title =
        `Released in the last 12 months, newest first. ${fresh ? 'Updated from models.dev.' : 'Using the saved models.dev list; live refresh unavailable.'} You can also enter a model ID.`;
    }
  });
}

window.addEventListener('popstate', () => { load(); render(); });

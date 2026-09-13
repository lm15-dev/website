import { INITIAL, LANGUAGES, PROVIDERS, exampleParts, exampleSource, type Language } from './examples';
import { tokens } from '../../playground/code-view';
import { setupPickers } from './picker';

export function setupExample(): void {
  const root = document.querySelector<HTMLElement>('[data-home-example]');
  if (!root || root.dataset['ready']) return;
  root.dataset['ready'] = 'true';
  const get = <T extends HTMLElement>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing example control: ${selector}`);
    return element;
  };
  const panel = get<HTMLElement>('[role="tabpanel"]');
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const providerControl = get<HTMLButtonElement>('[data-provider]');
  const modelControl = get<HTMLButtonElement>('[data-model]');
  const copyButton = get<HTMLButtonElement>('[data-copy]');
  const status = get<HTMLElement>('[data-example-status]');
  const state = { ...INITIAL };
  const rememberedModels = new Map<string, string>();
  let revision = 0;
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let introTimer: ReturnType<typeof setTimeout> | undefined;

  function finishIntro(): void {
    clearTimeout(introTimer);
    delete root!.dataset['intro'];
  }
  function label(control: HTMLButtonElement, text: string): void {
    const span = document.createElement('span');
    span.className = 'example-choice-text';
    span.textContent = text;
    control.replaceChildren(span);
  }

  function color(element: HTMLElement, text: string): void {
    const language = ['r', 'julia'].includes(state.language) ? 'python' : state.language;
    element.replaceChildren(...tokens(text, language).map(token => {
      if (!token.kind) return document.createTextNode(token.text);
      const span = document.createElement('span');
      span.className = `example-token-${token.kind}`;
      span.textContent = token.text;
      return span;
    }));
  }

  function render(announce = true): void {
    finishIntro();
    revision++;
    clearTimeout(copyTimer);
    delete copyButton.dataset['copied'];
    copyButton.title = 'Copy code';
    const language = LANGUAGES.find(item => item.id === state.language)!;
    const provider = PROVIDERS.find(item => item.id === state.provider);
    for (const tab of tabs) {
      const active = tab.dataset['language'] === state.language;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', `example-tab-${state.language}`);
    const [before, after] = exampleParts(state.language);
    color(get('[data-code-before]'), before);
    color(get('[data-code-after]'), after);
    label(providerControl, state.provider);
    label(modelControl, state.model);
    const docsLink = root!.querySelector<HTMLAnchorElement>('[data-docs-link]');
    if (docsLink) {
      const params = new URLSearchParams({ language: state.language });
      if (provider) params.set('provider', state.provider);
      if (provider && state.model !== 'model') params.set('model', state.model);
      docsLink.href = `/docs/?${params}`;
    }
    if (root!.dataset['exampleLanguage'] !== state.language) {
      root!.dataset['exampleLanguage'] = state.language;
      document.dispatchEvent(new CustomEvent('lm15:language-change', { detail: { language: state.language } }));
    }
    if (announce) status.textContent = `${language.label} example. ${provider?.label ?? 'Choose a provider'}, ${state.model === 'model' ? 'choose a model' : state.model}.`;
  }

  function chooseLanguage(tab: HTMLButtonElement): void {
    const language = LANGUAGES.find(item => item.id === tab.dataset['language']);
    if (!language) return;
    state.language = language.id as Language;
    render();
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => chooseLanguage(tab));
    tab.addEventListener('keydown', event => {
      let target: number;
      if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') target = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') target = 0;
      else if (event.key === 'End') target = tabs.length - 1;
      else return;
      event.preventDefault();
      tabs[target]!.focus();
      chooseLanguage(tabs[target]!);
    });
  }
  setupPickers(get('[id="example-picker"]'), [
    {
      control: providerControl,
      label: 'Provider',
      options: () => PROVIDERS.map(provider => ({ value: provider.id, label: provider.label, detail: provider.id })),
      value: () => state.provider,
      choose: value => {
        const provider = PROVIDERS.find(item => item.id === value);
        if (!provider) return;
        rememberedModels.set(state.provider, state.model);
        state.provider = provider.id;
        state.model = rememberedModels.get(provider.id) ?? 'model';
        render();
      },
    },
    {
      control: modelControl,
      label: 'Model',
      options: () => {
        const selected = PROVIDERS.find(provider => provider.id === state.provider);
        return (selected ? [selected] : PROVIDERS).flatMap(provider => provider.models.map(model => ({
          value: `${provider.id}:${model}`,
          label: model,
          ...(!selected ? { detail: provider.label } : {}),
        })));
      },
      value: () => `${state.provider}:${state.model}`,
      choose: value => {
        const provider = PROVIDERS.find(item => value.startsWith(`${item.id}:`));
        if (!provider) return;
        const model = value.slice(provider.id.length + 1);
        if (!provider.models.includes(model)) return;
        rememberedModels.set(state.provider, state.model);
        state.provider = provider.id;
        state.model = model;
        rememberedModels.set(state.provider, state.model);
        render();
      },
    },
  ]);

  copyButton.addEventListener('click', async () => {
    const copiedRevision = revision;
    try {
      await navigator.clipboard.writeText(exampleSource(state.language, state.provider, state.model) + '\n');
      if (copiedRevision !== revision) {
        status.textContent = 'Previous example copied. Copy again to use the current selection.';
        return;
      }
      copyButton.dataset['copied'] = 'true';
      copyButton.title = 'Copied';
      status.textContent = 'Example code copied.';
      copyTimer = setTimeout(() => {
        delete copyButton.dataset['copied'];
        copyButton.title = 'Copy code';
      }, 2000);
    } catch {
      copyButton.title = 'Copy failed — try again';
      status.textContent = 'The browser did not allow clipboard access. Please try again.';
    }
  });
  render(false);
  root.addEventListener('pointerdown', finishIntro, { capture: true });
  root.addEventListener('keydown', finishIntro, { capture: true });
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.dataset['intro'] = 'true';
    introTimer = setTimeout(finishIntro, 1400);
  }
}

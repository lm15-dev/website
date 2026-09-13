import { LANGUAGES, PROVIDERS as HOME_PROVIDERS, exampleSource, type Language } from '../components/home-example/examples';

import savedCatalog from './models-catalog.json';
import { fetchCatalog, isModelId, recentModels } from './model-catalog';

export { LANGUAGES };
const alphabetically = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
export const PROVIDERS = HOME_PROVIDERS.map(provider => ({
  ...provider, models: recentModels(savedCatalog, provider.id),
})).sort((a, b) => alphabetically(a.label, b.label));
let refresh: Promise<boolean> | undefined;
export function refreshModels(): Promise<boolean> {
  return refresh ??= fetchCatalog().then(catalog => {
    for (const provider of PROVIDERS) provider.models = recentModels(catalog, provider.id);
    return true;
  }).catch(() => false); // Keep the dated snapshot when the catalog is unavailable.
}

export type { Language };
export interface DocSelection { language: Language; provider: string; model: string }
export const DEFAULT_SELECTION: DocSelection = { language: 'python', provider: '', model: '' };

// Language-specific setup belongs beside the recipes, not in duplicated pages.
export const SETUP: Record<Language, { href: string; text: string }> = {
  python: { href: 'https://lm15-dev.github.io/lm15-python/getting-started/', text: 'Install LM15 using the Python getting-started guide.' },
  typescript: { href: 'https://github.com/lm15-dev/lm15-ts#readme', text: 'Install LM15 using the TypeScript SDK guide. This example runs in Node.js.' },
  rust: { href: 'https://github.com/lm15-dev/lm15-rs#readme', text: 'Add LM15 and Tokio using the Rust SDK guide.' },
  go: { href: 'https://github.com/lm15-dev/lm15-go#readme', text: 'Add LM15 to your Go module using the Go SDK guide.' },
  r: { href: '/compatibility/languages/', text: 'The R package is not yet publicly available. This example previews its current API.' },
  julia: { href: 'https://github.com/lm15-dev/lm15-jl#readme', text: 'Set up LM15 using the Julia SDK guide.' },
};

// Each recipe supplies separately written language versions. Provider and model
// are data inputs; prose and arbitrary source code are never search-and-replaced.
export const RECIPES = {
  'first-request': (selection: DocSelection) => exampleSource(selection.language, selection.provider || 'provider', selection.model || 'model'),
};
export type Recipe = keyof typeof RECIPES;

export function validModel(value: string): boolean {
  // Model identifiers, not arbitrary code: excludes quotes, escapes and controls.
  return isModelId(value);
}

export function readSelection(params: URLSearchParams, fallback = DEFAULT_SELECTION): DocSelection {
  const language = LANGUAGES.find(item => item.id === params.get('language'))?.id ?? fallback.language;
  const provider = PROVIDERS.find(item => item.id === params.get('provider'));
  const candidate = params.get('model');
  const model = provider && candidate && validModel(candidate) ? candidate : '';
  return { language, provider: provider?.id ?? '', model };
}

import { LANGUAGES, PROVIDERS as HOME_PROVIDERS, exampleCode, type Language } from '../components/home-example/examples.ts';
import type { Code } from '../playground/marks.ts';
import { tourCode, type TourView } from './tour-examples.ts';

import savedCatalog from './models-catalog.json' with { type: 'json' };
import { fetchCatalog, isModelId, recentModels } from './model-catalog.ts';

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

/** The Overview's tour (tour-examples.ts): one request, a part at a time. */
const tour = (view: TourView) => (selection: DocSelection) => tourCode(selection.language, view, selection.provider || 'provider', selection.model || 'model');

// Each recipe supplies separately written language versions. Provider and model
// are data inputs; prose and arbitrary source code are never search-and-replaced.
// A recipe returns marked code (playground/marks.ts), so the docs colour it as the playground does.
export const RECIPES = {
  'tour-first': tour('first'),
  'tour-request': tour('request'),
  'tour-followup': tour('followup'),
  'tour-forgetful': tour('forgetful'),
  'tools-search': tour('tools-search'),
  'tools-define': tour('tools-define'),
  'tools-vague': tour('tools-vague'),
  'tools-ask': tour('tools-ask'),
  'tools-answer': tour('tools-answer'),
  'tools-loop': tour('tools-loop'),
  'so-note': tour('so-note'),
  'so-plain': tour('so-plain'),
  'so-schema': tour('so-schema'),
  'so-ask': tour('so-ask'),
  'so-use': tour('so-use'),
  'so-note-barn': tour('so-note-barn'),
  'so-schema-other': tour('so-schema-other'),
  'so-program': tour('so-program'),
  'conn-switch': tour('conn-switch'),
  'conn-key': tour('conn-key'),
  'conn-local': tour('conn-local'),
  'conn-custom': tour('conn-custom'),
  'conv-start': tour('conv-start'),
  'conv-parts': tour('conv-parts'),
  'conv-loop': tour('conv-loop'),
  'conv-save': tour('conv-save'),
  'conv-load': tour('conv-load'),
  'tour-system': tour('system'),
  'tour-tools': tour('tools'),
  'tour-config': tour('config'),
  'tour-response': tour('response'),
  'tour-stream': tour('stream'),
  'tour-program': tour('program'),
} satisfies Record<string, (selection: DocSelection) => Code>;
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

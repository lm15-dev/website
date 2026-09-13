export const CATALOG_URL = 'https://models.dev/api.json';
export const CATALOG_PROVIDERS = {
  openai: 'openai', anthropic: 'anthropic', gemini: 'google', groq: 'groq',
  openrouter: 'openrouter', deepseek: 'deepseek', zai: 'zai', meta: 'meta', moonshotai: 'moonshotai',
} as const;
export interface CatalogModel { id: string; releaseDate: string }
export interface ModelCatalog {
  source: string;
  fetchedAt: string;
  providers: Record<string, CatalogModel[]>;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

export function isModelId(value: string): boolean {
  return /^[A-Za-z0-9~][A-Za-z0-9._:/@+~\-]{0,255}$/.test(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Store release dates, not catalog edit dates. Undated models cannot qualify. */
export function parseCatalog(raw: unknown): ModelCatalog {
  const data = object(raw);
  if (!data) throw new Error('Invalid models.dev catalog');
  const providers: ModelCatalog['providers'] = {};
  for (const [localId, catalogId] of Object.entries(CATALOG_PROVIDERS)) {
    const models = object(object(data[catalogId])?.['models']);
    if (!models) throw new Error(`Missing models.dev provider: ${catalogId}`);
    providers[localId] = Object.entries(models).flatMap(([id, value]) => {
      const date = object(value)?.['release_date'];
      return isModelId(id) && isDate(date) ? [{ id, releaseDate: date }] : [];
    });
  }
  return { source: CATALOG_URL, fetchedAt: new Date().toISOString(), providers };
}

export function recentModels(catalog: ModelCatalog, provider: string, now = new Date()): string[] {
  const today = now.toISOString().slice(0, 10);
  const cutoff = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()));
  const oldest = cutoff.toISOString().slice(0, 10);
  return (catalog.providers[provider] ?? [])
    .filter(model => model.releaseDate >= oldest && model.releaseDate <= today)
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate)
      || a.id.localeCompare(b.id, 'en', { sensitivity: 'base' }))
    .map(model => model.id);
}

export async function fetchCatalog(): Promise<ModelCatalog> {
  const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(10000), cache: 'no-cache', credentials: 'omit' });
  if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`);
  return parseCatalog(await response.json());
}

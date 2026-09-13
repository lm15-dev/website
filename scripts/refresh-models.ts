import { writeFile, rename } from 'node:fs/promises';
import { fetchCatalog } from '../src/data/model-catalog.ts';

const catalog = await fetchCatalog();
const target = new URL('../src/data/models-catalog.json', import.meta.url);
const temporary = new URL('../src/data/models-catalog.json.tmp', import.meta.url);
await writeFile(temporary, JSON.stringify(catalog, null, 2) + '\n');
await rename(temporary, target);
console.log(`Saved models.dev catalog for ${Object.keys(catalog.providers).length} providers.`);

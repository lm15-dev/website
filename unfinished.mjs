// Pages still marked "Under construction" are not shown to readers: they are
// left out of the menu (and so out of Previous/Next), and a link to one from a
// finished page is shown as plain text (after the build, `unlinkUnfinished`). Writing the page (removing the marker)
// brings both back by itself. scripts/check-links.mjs refuses any other link
// to an unfinished page, such as one written in a component.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT = fileURLToPath(new URL('./src/content/docs/', import.meta.url));
export const MARKER = ':::note[Under construction]';

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]);
}

/** The slugs ("docs/streaming", "reference") of the pages that are not written yet. */
export function unfinishedSlugs() {
  return new Set(filesUnder(CONTENT)
    .filter(file => /\.mdx?$/.test(file) && readFileSync(file, 'utf8').includes(MARKER))
    .map(file => relative(CONTENT, file).replace(/\.mdx?$/, '').replace(/(^|\/)index$/, '')));
}

/** The sidebar without unfinished pages; a group left empty goes too. */
export function withoutUnfinished(items, unfinished = unfinishedSlugs()) {
  return items.flatMap(item => {
    if (item.items) {
      const kept = withoutUnfinished(item.items, unfinished);
      return kept.length ? [{ ...item, items: kept }] : [];
    }
    return item.slug !== undefined && unfinished.has(item.slug) ? [] : [item];
  });
}

/** A site path ("/docs/streaming/#x") as a slug ("docs/streaming"), or undefined for other links. */
export function slugOf(href) {
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return undefined;
  return href.replace(/[?#].*$/, '').replace(/^\/+|\/+$/g, '');
}

/**
 * After the build: in every finished page, a link to an unfinished page becomes
 * its plain text (`<a href="/docs/x/">text</a>` → `<span>text</span>`). Links
 * are never nested, so an anchor ends at the first `</a>`.
 */
export function unlinkUnfinished(dist) {
  const unfinished = unfinishedSlugs();
  let changed = 0;
  for (const file of filesUnder(dist).filter(f => f.endsWith('.html'))) {
    const page = relative(dist, file).replace(/(^|\/)index\.html$/, '').replace(/\.html$/, '');
    if (unfinished.has(page)) continue;
    const html = readFileSync(file, 'utf8');
    const next = html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/g, (whole, attributes, text) => {
      const href = /\shref="([^"]*)"/.exec(attributes)?.[1];
      return unfinished.has(slugOf(href)) ? (changed++, `<span>${text}</span>`) : whole;
    });
    if (next !== html) writeFileSync(file, next);
  }
  return changed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(`Unlinked ${unlinkUnfinished(process.argv[2] ?? 'dist')} links to unfinished pages.`);
}

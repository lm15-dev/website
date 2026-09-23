/** Check local links, asset references, and heading anchors in the finished site. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'parse5';
import { filesUnder } from './build-playground.mjs';
import { slugOf, unfinishedSlugs } from '../unfinished.mjs';

function elements(node) {
  return [...(node.tagName ? [node] : []), ...(node.childNodes ?? []).flatMap(elements)];
}
export function checkLinks(directory) {
  directory = resolve(directory);
  const documents = new Map(filesUnder(directory).filter(file => extname(file) === '.html').map(file => [file, elements(parse(readFileSync(file, 'utf8')))]));
  const errors = [];
  const origin = 'https://lm15.dev';
  const unfinished = unfinishedSlugs();
  for (const [file, nodes] of documents) {
    const path = file.slice(directory.length).replace(/index\.html$/, '');
    const finished = !unfinished.has(slugOf(path));
    for (const node of nodes) {
      for (const attribute of node.attrs ?? []) {
        if (!['href', 'src'].includes(attribute.name) || !attribute.value || attribute.value.startsWith('#local-test=')) continue;
        let url;
        try { url = new URL(attribute.value, origin + path); } catch { errors.push(`${path}: invalid URL ${attribute.value}`); continue; }
        if (url.origin !== origin) continue;
        // A finished page never sends a reader to one that is not written yet (unfinished.mjs).
        if (finished && node.tagName === 'a' && unfinished.has(slugOf(url.pathname))) { errors.push(`${path}: links to the unfinished page ${url.pathname}`); continue; }
        let destination;
        try { destination = resolve(directory, '.' + decodeURIComponent(url.pathname)); } catch { errors.push(`${path}: invalid path ${url.pathname}`); continue; }
        if (destination !== directory && !destination.startsWith(directory + sep)) { errors.push(`${path}: path leaves site: ${attribute.value}`); continue; }
        if (existsSync(destination) && statSync(destination).isDirectory()) destination = join(destination, 'index.html');
        if (!existsSync(destination) || !statSync(destination).isFile()) { errors.push(`${path}: missing ${attribute.value}`); continue; }
        if (url.hash && documents.has(destination)) {
          let id;
          try { id = decodeURIComponent(url.hash.slice(1)); } catch { errors.push(`${path}: invalid anchor ${url.hash}`); continue; }
          if (id && !documents.get(destination).some(element => element.attrs?.some(attr => ['id', 'name'].includes(attr.name) && attr.value === id))) errors.push(`${path}: missing anchor ${attribute.value}`);
        }
      }
    }
  }
  if (errors.length) throw new Error(`Broken local links:\n${errors.join('\n')}`);
  return documents.size;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(`Checked links in ${checkLinks(resolve('dist'))} pages.`);

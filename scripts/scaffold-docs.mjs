import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sidebar } from '../navigation.mjs';

const content = fileURLToPath(new URL('../src/content/docs/', import.meta.url));
let created = 0;
function scaffold(items) {
  for (const item of items) {
    if (item.items) scaffold(item.items);
    if (!item.slug) continue;
    const base = join(content, item.slug);
    if (['.md', '.mdx', '/index.md', '/index.mdx'].some(suffix => existsSync(base + suffix))) continue;
    const path = base + '.md';
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `---
title: ${JSON.stringify(item.label)}
description: This page is under construction.
pagefind: false
head:
  - tag: meta
    attrs:
      name: robots
      content: noindex
---

:::note[Under construction]
This page is planned but hasn’t been written yet.
:::
`, { flag: 'wx' });
    created++;
  }
}
scaffold(sidebar);
console.log(`Created ${created} placeholder pages. Existing pages were left unchanged.`);

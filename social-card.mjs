// Keep this dated screenshot unchanged; it includes measurements from that date.
export const socialImageHead = [
  { tag: 'meta', attrs: { property: 'og:image', content: 'https://lm15.dev/social/lm15-home-2026-09-13.png' } },
  { tag: 'meta', attrs: { property: 'og:image:type', content: 'image/png' } },
  { tag: 'meta', attrs: { property: 'og:image:width', content: '1312' } },
  { tag: 'meta', attrs: { property: 'og:image:height', content: '1219' } },
  { tag: 'meta', attrs: { property: 'og:image:alt', content: 'LM15 — All Providers. One API. Python code example and SDK overhead comparisons dated September 13, 2026.' } },
  { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
  { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://lm15.dev/social/lm15-home-2026-09-13.png' } },
  { tag: 'meta', attrs: { name: 'twitter:image:alt', content: 'LM15 — All Providers. One API. Python code example and SDK overhead comparisons dated September 13, 2026.' } },
];

export function socialHead(title, description, url) {
  return [
    { tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
    { tag: 'meta', attrs: { property: 'og:site_name', content: 'LM15' } },
    { tag: 'meta', attrs: { property: 'og:title', content: title } },
    { tag: 'meta', attrs: { property: 'og:description', content: description } },
    { tag: 'meta', attrs: { property: 'og:url', content: url } },
    { tag: 'meta', attrs: { name: 'twitter:title', content: title } },
    { tag: 'meta', attrs: { name: 'twitter:description', content: description } },
    ...socialImageHead,
  ];
}

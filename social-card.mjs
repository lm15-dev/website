// Version the image URL so sharing services can fetch the updated artwork.
const image = 'https://lm15.dev/social/lm15-home-2026-09-13-v2.png';
const imageAlt = 'LM15 — All Providers. One API. Learn more and try the playground.';
export const socialImageHead = [
  { tag: 'meta', attrs: { property: 'og:image', content: image } },
  { tag: 'meta', attrs: { property: 'og:image:type', content: 'image/png' } },
  { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
  { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
  { tag: 'meta', attrs: { property: 'og:image:alt', content: imageAlt } },
  { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
  { tag: 'meta', attrs: { name: 'twitter:image', content: image } },
  { tag: 'meta', attrs: { name: 'twitter:image:alt', content: imageAlt } },
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

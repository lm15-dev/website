import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { readFileSync } from 'node:fs';
import { sidebar } from './navigation.mjs';
import { socialImageHead } from './social-card.mjs';

// Development-only refresh for the standalone playground. None of these routes is published.
const playgroundDev = {
  name: 'playground-dev',
  hooks: {
    'astro:server:setup': ({ server }) => {
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url, 'http://localhost').pathname;
        if (path === '/__playground_version') {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(readFileSync('.build/public/playground/release.json')); return;
        }
        if (path === '/__playground_dev.js') {
          res.setHeader('Content-Type', 'text/javascript');
          res.end(`let last; setInterval(async () => { try { const {release} = await (await fetch('/__playground_version', {cache:'no-store'})).json(); if(last && last !== release) location.reload(); last = release; } catch {} }, 1000);`); return;
        }
        if (path === '/playground/' || path === '/playground/index.html') {
          res.setHeader('Content-Type', 'text/html');
          res.setHeader('Cache-Control', 'no-store');
          res.end(readFileSync('.build/public/playground/index.html', 'utf8').replace('</body>', '<script src="/__playground_dev.js"></script></body>')); return;
        }
        next();
      });
    },
  },
};
export default defineConfig({
  site: 'https://lm15.dev',
  trailingSlash: 'always',
  publicDir: './.build/public',
  integrations: [
    starlight({
      title: 'LM15',
      head: socialImageHead,
      components: { Header: './src/components/DocsHeader.astro' },
      disable404Route: true, // src/pages/404.astro owns the shared not-found page.
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/lm15-dev' }],
      editLink: { baseUrl: 'https://github.com/lm15-dev/website/edit/main/' },
      sidebar,
      customCss: ['./src/styles/docs.css'],
    }),
    playgroundDev,
  ],
});

// The docs' Markdown code blocks, in the playground's colours (code.css).
//
// The playground colours by meaning, because its generator knows which names
// are LM15's and which values the reader chose. A Markdown block only has its
// syntax, so this theme approximates: strings and numbers take the value blue,
// function and type names take the API orange, comments are grey, and
// everything else is ink. Code that must carry exact meaning belongs in a
// recipe (src/data/docs-examples.ts), not a Markdown block.
//
// Token colours are the shared CSS variables, so they follow the light/dark
// switch and theme.css stays the only place a shown colour is defined. The two
// themes differ only in `type`, which Expressive Code uses for its own frame
// and button colours.
//
// Astro caches rendered Markdown in node_modules/.astro/data-store.json and does
// not notice a change here: delete that file before rebuilding locally.
import { ExpressiveCodeTheme } from 'astro-expressive-code';

const ink = 'var(--lm-code-ink)';
const settings = [
  { settings: { foreground: ink } },
  { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: 'var(--lm-code-muted)', fontStyle: 'italic' } },
  { scope: ['string', 'constant.numeric', 'constant.character.escape'], settings: { foreground: 'var(--lm-accent)' } },
  {
    scope: [
      'entity.name.function', 'support.function', 'meta.function-call.generic', 'variable.function',
      'entity.name.type', 'entity.name.class', 'support.class', 'support.type',
    ],
    settings: { foreground: 'var(--lm-code-api)' },
  },
  // A shell's commands, built-ins and bare words (`pip install lm15`) are neither API calls nor
  // values the reader chose: ink, like the playground's plain code. Quoted text stays a value.
  { scope: ['source.shell entity.name', 'source.shell support.function', 'source.shell string.unquoted', 'source.shell constant.character.escape', 'source.powershell support.function'], settings: { foreground: ink } },
];

const theme = (type) => new ExpressiveCodeTheme({
  name: `lm15-${type}`,
  type,
  // Parsable colours for Expressive Code's own calculations; the page shows the variables (styleOverrides).
  colors: type === 'light'
    ? { 'editor.background': '#fafcfb', 'editor.foreground': '#111111' }
    : { 'editor.background': '#111914', 'editor.foreground': '#e5e5e5' },
  settings,
});

export const codeThemes = [theme('dark'), theme('light')];

export const codeStyle = {
  codeBackground: 'var(--lm-code-bg)',
  codeForeground: 'var(--lm-code-ink)',
  codeFontFamily: 'var(--lm-code-font)',
  codeLineHeight: '1.8',
  borderColor: 'var(--sl-color-gray-5)',
  frames: {
    editorBackground: 'var(--lm-code-bg)',
    terminalBackground: 'var(--lm-code-bg)',
    editorActiveTabBackground: 'var(--lm-code-bg)',
    frameBoxShadowCssValue: 'none',
  },
};

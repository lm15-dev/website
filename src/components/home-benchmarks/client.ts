import { BENCHMARKS, barHeight, chartMaximum, formatValue, valueDescription } from '../../data/benchmarks';
import { INITIAL, LANGUAGES, type Language } from '../home-example/examples';

export function setupBenchmarks(): void {
  const root = document.querySelector<HTMLElement>('[data-benchmarks]');
  if (!root || root.dataset['ready']) return;
  root.dataset['ready'] = 'true';
  const grid = root.querySelector<HTMLElement>('[data-benchmark-grid]')!;
  const source = root.querySelector<HTMLAnchorElement>('[data-benchmark-source]')!;
  let current: Language = INITIAL.language;

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function render(language: Language): void {
    current = language;
    const suite = BENCHMARKS[language];
    const label = LANGUAGES.find(item => item.id === language)!.label;
    root!.querySelector('[data-benchmark-language]')!.textContent = label;
    root!.querySelector('[data-benchmark-disclosure]')!.textContent = suite.status === 'illustrative'
      ? '· Demo data' : `· ${suite.measuredAt}`;
    source.hidden = suite.status !== 'measured';
    if (suite.status === 'measured') source.href = suite.sourceUrl;
    else source.removeAttribute('href');
    grid.replaceChildren(...suite.metrics.map(metric => {
      const maximum = chartMaximum(metric);
      const chart = element('figure', 'benchmark-chart');
      chart.setAttribute('aria-label', `${metric.label}. ${metric.description}`);
      const bars = element('div', 'benchmark-bars');
      bars.setAttribute('role', 'list');
      bars.setAttribute('aria-label', metric.label);
      for (const item of metric.values) {
        const column = element('div', `benchmark-column${item.id === 'lm15' ? ' is-lm15' : ''}`);
        column.setAttribute('role', 'listitem');
        column.setAttribute('aria-label', valueDescription(item, metric.unit));
        column.title = valueDescription(item, metric.unit);
        const track = element('div', 'benchmark-track');
        track.setAttribute('aria-hidden', 'true');
        const bar = element('div', 'benchmark-bar');
        bar.style.setProperty('--bar-height', `${barHeight(item.value, maximum)}%`);
        bar.dataset['zero'] = String(item.value === 0);
        bar.dataset['missing'] = String(item.value === null);
        track.append(bar);
        const value = element('span', 'benchmark-value', formatValue(item.value, ''));
        value.style.bottom = `${barHeight(item.value, maximum)}%`;
        track.append(value);
        const name = element('span', 'benchmark-client', item.label);
        name.setAttribute('aria-hidden', 'true');
        column.append(track, name);
        bars.append(column);
      }
      const caption = element('figcaption', '', metric.label);
      if (metric.unit) caption.append(' ', element('span', 'benchmark-unit', `(${metric.unit})`));
      chart.append(bars, caption);
      return chart;
    }));
    root!.querySelector('[data-benchmark-status]')!.textContent = `${label} charts. ${suite.status === 'illustrative' ? 'Illustrative numbers, not measured.' : 'Measured results.'}`;
  }

  // Read the current selection as well as listening: either component may initialize first.
  const selected = document.querySelector<HTMLElement>('[data-home-example]')?.dataset['exampleLanguage'];
  const initial = LANGUAGES.find(item => item.id === selected);
  if (initial && initial.id !== current) render(initial.id);
  document.addEventListener('lm15:language-change', event => {
    const selected = (event as CustomEvent<{ language: string }>).detail?.language;
    const choice = LANGUAGES.find(item => item.id === selected);
    if (choice && choice.id !== current) render(choice.id);
  });

  // Ordinary scrolling reveals the diagram; content remains visible without JavaScript.
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset['reveal'] = 'visible';
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.1 });
    for (const group of document.querySelectorAll<HTMLElement>('[data-flow-reveal]')) {
      if (group.getBoundingClientRect().top < window.innerHeight - 40) continue;
      group.dataset['reveal'] = 'waiting';
      observer.observe(group);
    }
  }
}

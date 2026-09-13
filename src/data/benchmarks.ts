import type { Language } from '../components/home-example/examples';
import { PYTHON_BENCHMARKS } from './python-benchmarks';
import { NODE_BENCHMARKS } from './node-benchmarks';
import { RUST_BENCHMARKS, GO_BENCHMARKS } from './native-benchmarks';

export interface BenchmarkValue {
  id: string;
  label: string;
  value: number | null; // null means not measured; zero is a real zero.
  spread?: { low: number; high: number }; // 25th–75th percentile, in the same unit.
}
export interface BenchmarkMetric {
  id: string;
  label: string;
  unit: string;
  description: string;
  values: BenchmarkValue[];
}
export type BenchmarkSuite = { metrics: BenchmarkMetric[] } & (
  | { status: 'illustrative'; note: string }
  | { status: 'measured'; measuredAt: string; environment: string; sourceUrl: string }
);

// The fixtures below are invented for layout, not performance claims.
// Python, TypeScript/Node, Rust, and Go use measured data. R and Julia remain illustrative.
// Clients and workloads must be chosen independently for each language; do not compare
// bars between languages or infer provider latency from local SDK measurements.
const metrics = [
  { id: 'size', label: 'Installed size', unit: 'MiB', description: 'Installed footprint, including required dependencies.' },
  { id: 'dependencies', label: 'Dependencies', unit: '', description: 'Required third-party dependencies; counting rules belong in the report.' },
  { id: 'startup', label: 'Startup', unit: 'ms', description: 'Time until the client is ready. The report must define the workload.' },
  { id: 'memory', label: 'Memory', unit: 'MiB', description: 'Process memory for the same local workload, without a model call.' },
];
type Fixture = [id: string, label: string, values: [number, number, number, number]];
function illustrative(clients: Fixture[], note = 'Illustrative numbers — not measured.'): BenchmarkSuite {
  return {
    status: 'illustrative', note,
    metrics: metrics.map((metric, index) => ({
      ...metric,
      values: clients.map(([id, label, values]) => ({ id, label, value: values[index]! })),
    })),
  };
}
export const BENCHMARKS: Record<Language, BenchmarkSuite> = {
  python: PYTHON_BENCHMARKS,
  typescript: NODE_BENCHMARKS,
  go: GO_BENCHMARKS,
  rust: RUST_BENCHMARKS,
  r: illustrative([
    ['client-a', 'Client A', [65, 24, 1500, 95]],
    ['client-b', 'Client B', [40, 16, 900, 70]],
    ['lm15', 'LM15', [4, 3, 180, 32]],
  ], 'Illustrative numbers and comparison clients — not measured.'),
  julia: illustrative([
    ['client-a', 'Client A', [80, 28, 2200, 160]],
    ['client-b', 'Client B', [55, 18, 1500, 120]],
    ['lm15', 'LM15', [12, 8, 600, 65]],
  ], 'Illustrative numbers and comparison clients — not measured.'),
};

export function formatValue(value: number | null, unit: string): string {
  if (value === null) return '—';
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)}${unit ? ` ${unit}` : ''}`;
}
export function valueDescription(item: BenchmarkValue, unit: string): string {
  const value = item.value === null ? 'not measured' : formatValue(item.value, unit);
  const spread = item.spread ? `; middle 50%: ${formatValue(item.spread.low, unit)}–${formatValue(item.spread.high, unit)}` : '';
  return `${item.label}: ${value}${spread}`;
}
export function chartMaximum(metric: BenchmarkMetric): number {
  return Math.max(0, ...metric.values.map(item => item.value ?? 0));
}
export function barHeight(value: number | null, maximum: number): number {
  return value === null || maximum <= 0 ? 0 : Math.max(0, value / maximum * 100);
}

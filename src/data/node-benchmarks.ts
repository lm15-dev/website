// Measured data. Regenerate with scripts/publish-node-benchmarks.py.
import type { BenchmarkSuite } from './benchmarks';

export const NODE_BENCHMARKS = {
  "status": "measured",
  "measuredAt": "2026-09-13",
  "environment": "Node.js v22.23.2 · Linux 6.18.45 · AMD Ryzen Threadripper 3960X 24-Core Processor · one CPU per process, 20 workers",
  "sourceUrl": "/docs/benchmarks/node/",
  "metrics": [
    {
      "id": "size",
      "label": "Installed size",
      "unit": "MiB",
      "description": "Logical bytes of regular files in the production node_modules tree, including the entire SDK, type declarations, source maps, bundled data, npm metadata, and installed transitive dependencies. Excludes symlinks, the shared Node executable, the project lockfile, and the input tarball. No bundling or tree-shaking.",
      "values": [
        {
          "id": "vercel",
          "label": "Vercel AI SDK",
          "value": 24.332136154174805
        },
        {
          "id": "google",
          "label": "Google GenAI",
          "value": 27.39394760131836
        },
        {
          "id": "openai",
          "label": "OpenAI",
          "value": 16.968796730041504
        },
        {
          "id": "anthropic",
          "label": "Anthropic",
          "value": 9.153931617736816
        },
        {
          "id": "lm15",
          "label": "LM15",
          "value": 3.160416603088379
        }
      ]
    },
    {
      "id": "dependencies",
      "label": "Dependencies",
      "unit": "",
      "description": "Installed npm package instances minus the root SDK. Includes transitive, peer, and optional packages actually installed on this platform; nested duplicate installations count separately. Vercel includes its three explicitly selected provider adapters in this count. Development dependencies are omitted.",
      "values": [
        {
          "id": "vercel",
          "label": "Vercel AI SDK",
          "value": 13
        },
        {
          "id": "google",
          "label": "Google GenAI",
          "value": 40
        },
        {
          "id": "openai",
          "label": "OpenAI",
          "value": 0
        },
        {
          "id": "anthropic",
          "label": "Anthropic",
          "value": 6
        },
        {
          "id": "lm15",
          "label": "LM15",
          "value": 0
        }
      ]
    },
    {
      "id": "startup",
      "label": "Import time",
      "unit": "ms",
      "description": "Median process.hrtime.bigint time around the listed public ESM imports in a fresh Node process. Vercel imports ai and its OpenAI, Anthropic, and Google adapters sequentially inside the same timed block. Two unmeasured warmups populate OS file caches. Excludes process launch, shutdown, client construction, and provider calls. Persistent Node compile caching is explicitly disabled.",
      "values": [
        {
          "id": "vercel",
          "label": "Vercel AI SDK",
          "value": 124.8980195,
          "spread": {
            "low": 123.49768599999999,
            "high": 127.0355965
          }
        },
        {
          "id": "google",
          "label": "Google GenAI",
          "value": 135.876082,
          "spread": {
            "low": 133.93216525,
            "high": 137.41260375000002
          }
        },
        {
          "id": "openai",
          "label": "OpenAI",
          "value": 99.9582475,
          "spread": {
            "low": 97.2523345,
            "high": 101.4173395
          }
        },
        {
          "id": "anthropic",
          "label": "Anthropic",
          "value": 55.4481245,
          "spread": {
            "low": 54.543696,
            "high": 56.77068525
          }
        },
        {
          "id": "lm15",
          "label": "LM15",
          "value": 54.756639,
          "spread": {
            "low": 54.09037,
            "high": 55.68144625
          }
        }
      ]
    },
    {
      "id": "memory",
      "label": "Memory after import",
      "unit": "MiB",
      "description": "Median process.memoryUsage.rss() immediately after the same import, including Node and V8. Empty-process baseline is reported separately, not subtracted.",
      "values": [
        {
          "id": "vercel",
          "label": "Vercel AI SDK",
          "value": 78.462890625,
          "spread": {
            "low": 78.25,
            "high": 78.6796875
          }
        },
        {
          "id": "google",
          "label": "Google GenAI",
          "value": 79.072265625,
          "spread": {
            "low": 77.0517578125,
            "high": 80.3359375
          }
        },
        {
          "id": "openai",
          "label": "OpenAI",
          "value": 72.65625,
          "spread": {
            "low": 72.2412109375,
            "high": 72.880859375
          }
        },
        {
          "id": "anthropic",
          "label": "Anthropic",
          "value": 61.818359375,
          "spread": {
            "low": 61.4619140625,
            "high": 62.041015625
          }
        },
        {
          "id": "lm15",
          "label": "LM15",
          "value": 66.10546875,
          "spread": {
            "low": 65.9560546875,
            "high": 66.3916015625
          }
        }
      ]
    }
  ]
} satisfies BenchmarkSuite;

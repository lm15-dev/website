// Measured data. Regenerate with scripts/publish-python-benchmarks.py.
import type { BenchmarkSuite } from './benchmarks';

export const PYTHON_BENCHMARKS = {
  "status": "measured",
  "measuredAt": "2026-09-13",
  "environment": "Python 3.13.13 · Linux 6.18.45 · AMD Ryzen Threadripper 3960X 24-Core Processor · one CPU per process, 20 parallel workers",
  "sourceUrl": "/docs/benchmarks/python/",
  "metrics": [
    {
      "id": "size",
      "label": "Installed size",
      "unit": "MiB",
      "description": "Sum of installed regular file lengths in site-packages, minus files already present in an empty venv; excludes .pyc and the shared interpreter. Includes package metadata, bundled data, and all required dependency packages. Optional extras are not installed.",
      "values": [
        {
          "id": "litellm",
          "label": "LiteLLM",
          "value": 158.72489643096924
        },
        {
          "id": "google",
          "label": "Google GenAI",
          "value": 32.834593772888184
        },
        {
          "id": "openai",
          "label": "OpenAI",
          "value": 16.650251388549805
        },
        {
          "id": "anthropic",
          "label": "Anthropic",
          "value": 13.275374412536621
        },
        {
          "id": "lm15",
          "label": "LM15",
          "value": 1.2157716751098633
        }
      ]
    },
    {
      "id": "dependencies",
      "label": "Dependencies",
      "unit": "",
      "description": "Number of installed Python distributions excluding the root SDK and anything present in an empty venv; includes transitive runtime dependencies.",
      "values": [
        {
          "id": "litellm",
          "label": "LiteLLM",
          "value": 54
        },
        {
          "id": "google",
          "label": "Google GenAI",
          "value": 24
        },
        {
          "id": "openai",
          "label": "OpenAI",
          "value": 13
        },
        {
          "id": "anthropic",
          "label": "Anthropic",
          "value": 14
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
      "description": "Median perf_counter_ns time of the public module import in a fresh isolated Python process. Two unmeasured warmups populate .pyc and OS page caches. Excludes interpreter launch, process shutdown, and client construction. No disk-cache flush.",
      "values": [
        {
          "id": "litellm",
          "label": "LiteLLM",
          "value": 1740.05076,
          "spread": {
            "low": 1712.79333025,
            "high": 1764.3053340000001
          }
        },
        {
          "id": "google",
          "label": "Google GenAI",
          "value": 303.3533365,
          "spread": {
            "low": 297.83237599999995,
            "high": 309.41351425
          }
        },
        {
          "id": "openai",
          "label": "OpenAI",
          "value": 520.479613,
          "spread": {
            "low": 510.38158725,
            "high": 530.40042875
          }
        },
        {
          "id": "anthropic",
          "label": "Anthropic",
          "value": 437.582156,
          "spread": {
            "low": 429.359506,
            "high": 444.104044
          }
        },
        {
          "id": "lm15",
          "label": "LM15",
          "value": 115.216393,
          "spread": {
            "low": 113.38309525,
            "high": 117.394376
          }
        }
      ]
    },
    {
      "id": "memory",
      "label": "Memory after import",
      "unit": "MiB",
      "description": "Median VmRSS immediately after the same import, including the Python interpreter. Baseline is reported separately and is not subtracted.",
      "values": [
        {
          "id": "litellm",
          "label": "LiteLLM",
          "value": 195.365234375,
          "spread": {
            "low": 195.3232421875,
            "high": 195.37890625
          }
        },
        {
          "id": "google",
          "label": "Google GenAI",
          "value": 48.23046875,
          "spread": {
            "low": 48.2265625,
            "high": 48.267578125
          }
        },
        {
          "id": "openai",
          "label": "OpenAI",
          "value": 58.2265625,
          "spread": {
            "low": 58.22265625,
            "high": 58.2587890625
          }
        },
        {
          "id": "anthropic",
          "label": "Anthropic",
          "value": 55.29296875,
          "spread": {
            "low": 55.265625,
            "high": 55.3173828125
          }
        },
        {
          "id": "lm15",
          "label": "LM15",
          "value": 28.16796875,
          "spread": {
            "low": 28.1640625,
            "high": 28.1767578125
          }
        }
      ]
    }
  ]
} satisfies BenchmarkSuite;

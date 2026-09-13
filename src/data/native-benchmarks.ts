// Measured server data. Regenerate with scripts/publish-native-benchmarks.py.
import type { BenchmarkSuite } from './benchmarks';

export const RUST_BENCHMARKS = {
  "status": "measured",
  "measuredAt": "2026-09-13",
  "environment": "rustc 1.97.1 (8bab26f4f 2026-07-14) (built from a source tarball) · AMD Ryzen Threadripper 3960X 24-Core Processor · single-core processes on 20 workers",
  "sourceUrl": "/docs/benchmarks/rust/",
  "metrics": [
    {
      "id": "binary",
      "label": "Program size",
      "unit": "MiB",
      "description": "Size of the stripped release executable containing the client example and measurement scaffold.",
      "values": [
        {
          "id": "async-openai",
          "label": "async-openai",
          "value": 5.506034851074219
        },
        {
          "id": "genai",
          "label": "genai",
          "value": 8.024658203125
        },
        {
          "id": "rig",
          "label": "Rig",
          "value": 6.489479064941406
        },
        {
          "id": "lm15",
          "label": "LM15",
          "value": 6.891685485839844
        }
      ]
    },
    {
      "id": "build",
      "label": "Clean build",
      "unit": "s",
      "description": "Median single-core clean build. Downloaded dependencies are cached, but compiled outputs are not.",
      "values": [
        {
          "id": "async-openai",
          "label": "async-openai",
          "value": 260.20379686600063,
          "spread": {
            "low": 253.8262758780038,
            "high": 264.53785195498494
          }
        },
        {
          "id": "genai",
          "label": "genai",
          "value": 323.83031521801604,
          "spread": {
            "low": 321.9126800299855,
            "high": 328.0016465280205
          }
        },
        {
          "id": "rig",
          "label": "Rig",
          "value": 386.7188357959967,
          "spread": {
            "low": 376.2094004499959,
            "high": 390.15999315399677
          }
        },
        {
          "id": "lm15",
          "label": "LM15",
          "value": 281.0977925210027,
          "spread": {
            "low": 277.9467906790087,
            "high": 286.43771071801893
          }
        }
      ]
    },
    {
      "id": "request",
      "label": "Local request",
      "unit": "µs",
      "description": "Median of process-average non-streaming request times against a private loopback fixture server. Includes local HTTP and fixture overhead, not external provider latency.",
      "values": [
        {
          "id": "async-openai",
          "label": "async-openai",
          "value": 188.941235,
          "spread": {
            "low": 188.1260475,
            "high": 190.9033425
          }
        },
        {
          "id": "genai",
          "label": "genai",
          "value": 203.5289175,
          "spread": {
            "low": 201.29109125000002,
            "high": 205.30713375
          }
        },
        {
          "id": "rig",
          "label": "Rig",
          "value": 199.49519750000002,
          "spread": {
            "low": 198.09393375,
            "high": 201.43305625
          }
        },
        {
          "id": "lm15",
          "label": "LM15",
          "value": 198.70847500000002,
          "spread": {
            "low": 197.315135,
            "high": 201.39332000000002
          }
        }
      ]
    },
    {
      "id": "memory",
      "label": "Memory after requests",
      "unit": "MiB",
      "description": "Median client process resident memory after repeated requests. Includes the language runtime; excludes the separate fixture server.",
      "values": [
        {
          "id": "async-openai",
          "label": "async-openai",
          "value": 4.98828125,
          "spread": {
            "low": 4.9677734375,
            "high": 5.0390625
          }
        },
        {
          "id": "genai",
          "label": "genai",
          "value": 6.720703125,
          "spread": {
            "low": 6.59765625,
            "high": 6.8330078125
          }
        },
        {
          "id": "rig",
          "label": "Rig",
          "value": 6.01171875,
          "spread": {
            "low": 5.9814453125,
            "high": 6.1455078125
          }
        },
        {
          "id": "lm15",
          "label": "LM15",
          "value": 5.7109375,
          "spread": {
            "low": 5.65234375,
            "high": 5.7734375
          }
        }
      ]
    }
  ]
} satisfies BenchmarkSuite;

export const GO_BENCHMARKS = {
  "status": "measured",
  "measuredAt": "2026-09-13",
  "environment": "go version go1.26.7 linux/amd64 · AMD Ryzen Threadripper 3960X 24-Core Processor · single-core processes on 20 workers",
  "sourceUrl": "/docs/benchmarks/go/",
  "metrics": [
    {
      "id": "binary",
      "label": "Program size",
      "unit": "MiB",
      "description": "Size of the stripped release executable containing the client example and measurement scaffold.",
      "values": [
        {
          "id": "openai",
          "label": "OpenAI",
          "value": 12.172029495239258
        },
        {
          "id": "anthropic",
          "label": "Anthropic",
          "value": 10.324373245239258
        },
        {
          "id": "google",
          "label": "Google GenAI",
          "value": 12.918123245239258
        },
        {
          "id": "lm15",
          "label": "LM15",
          "value": 8.324373245239258
        }
      ]
    },
    {
      "id": "build",
      "label": "Clean build",
      "unit": "s",
      "description": "Median single-core clean build. Downloaded dependencies are cached, but compiled outputs are not.",
      "values": [
        {
          "id": "openai",
          "label": "OpenAI",
          "value": 71.0928762209951,
          "spread": {
            "low": 70.09421723301057,
            "high": 71.13111835200107
          }
        },
        {
          "id": "anthropic",
          "label": "Anthropic",
          "value": 57.899201407970395,
          "spread": {
            "low": 57.73492725100368,
            "high": 58.82859714503866
          }
        },
        {
          "id": "google",
          "label": "Google GenAI",
          "value": 49.35318446101155,
          "spread": {
            "low": 48.66535613598535,
            "high": 50.540420670004096
          }
        },
        {
          "id": "lm15",
          "label": "LM15",
          "value": 31.247519836004358,
          "spread": {
            "low": 31.010372279037256,
            "high": 32.458002655010205
          }
        }
      ]
    },
    {
      "id": "request",
      "label": "Local request",
      "unit": "µs",
      "description": "Median of process-average non-streaming request times against a private loopback fixture server. Includes local HTTP and fixture overhead, not external provider latency.",
      "values": [
        {
          "id": "openai",
          "label": "OpenAI",
          "value": 274.1097925,
          "spread": {
            "low": 269.80026000000004,
            "high": 276.8184425
          }
        },
        {
          "id": "anthropic",
          "label": "Anthropic",
          "value": 264.32947750000005,
          "spread": {
            "low": 260.90929875,
            "high": 267.97925625
          }
        },
        {
          "id": "google",
          "label": "Google GenAI",
          "value": 259.86438999999996,
          "spread": {
            "low": 253.8199875,
            "high": 262.11947125
          }
        },
        {
          "id": "lm15",
          "label": "LM15",
          "value": 209.17456249999998,
          "spread": {
            "low": 206.45569375,
            "high": 211.16393
          }
        }
      ]
    },
    {
      "id": "memory",
      "label": "Memory after requests",
      "unit": "MiB",
      "description": "Median client process resident memory after repeated requests. Includes the language runtime; excludes the separate fixture server.",
      "values": [
        {
          "id": "openai",
          "label": "OpenAI",
          "value": 13.953125,
          "spread": {
            "low": 13.8583984375,
            "high": 14.0771484375
          }
        },
        {
          "id": "anthropic",
          "label": "Anthropic",
          "value": 13.26953125,
          "spread": {
            "low": 13.0712890625,
            "high": 13.3369140625
          }
        },
        {
          "id": "google",
          "label": "Google GenAI",
          "value": 16.72265625,
          "spread": {
            "low": 16.630859375,
            "high": 16.78125
          }
        },
        {
          "id": "lm15",
          "label": "LM15",
          "value": 10.21484375,
          "spread": {
            "low": 10.21484375,
            "high": 10.21875
          }
        }
      ]
    }
  ]
} satisfies BenchmarkSuite;


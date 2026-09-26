---
title: "Parasail"
description: "Use open models hosted by Parasail through LM15, with the parasail provider: the key, the model names, and what to expect."
---

Parasail runs open models from many vendors behind one API. In LM15 its
provider is `parasail`.

| | |
|---|---|
| Provider | `parasail` (litellm spelling: `parasail/`) |
| Key | `PARASAIL_API_KEY`, from [saas.parasail.io/keys](https://www.saas.parasail.io/keys) |
| Model names | the vendor's name: `parasail:meta-llama/Llama-3.3-70B-Instruct` |
| Needs | Python 1.1.0, TypeScript 1.0.0-rc.2, Rust 1.0.0-rc.2, Go v1.1.0-rc.2 or later |

Chat, streaming, tools (including a forced tool choice), structured output
and the model list work as with any provider. Measured against Parasail on
September 26, 2026:

- **Reasoning off** is refused by Parasail, with a clear error, on gpt-oss,
  which can't stop reasoning. Some models (DeepSeek V3.1, Qwen3.5) turn
  thinking on and off through their own settings; pass those in the
  request's `extensions`.
- **Images inside a tool result** reach the model.
- **A model that doesn't exist** raises `UnsupportedModelError`, as on
  every provider, though Parasail words it as a missing deployment.

---
title: "DeepInfra"
description: "Use open models hosted by DeepInfra through LM15, with the deepinfra provider: the key, the model names, and what LM15 does differently for some models."
---

DeepInfra runs open models from many vendors (DeepSeek, Qwen, GLM, Kimi,
Llama, gpt-oss and others) behind one API. In LM15 its provider is
`deepinfra`.

| | |
|---|---|
| Provider | `deepinfra` (litellm spelling: `deepinfra/`) |
| Key | `DEEPINFRA_API_KEY`, from [deepinfra.com/dash/api_keys](https://deepinfra.com/dash/api_keys) |
| Model names | the vendor's name: `deepinfra:deepseek-ai/DeepSeek-V4.1-Flash` |
| Needs | Python 1.1.0, TypeScript 1.0.0-rc.2, Rust 1.0.0-rc.2, Go v1.1.0-rc.2 or later |

Chat, streaming, tools, structured output and the model list work as with
any provider. What LM15 does differently here, each measured against
DeepInfra on September 26, 2026:

- **Forcing a tool call.** Many models on DeepInfra ignore a forced tool
  choice (`required`, a named tool, or `none`) and answer in text. LM15
  sends it only to the 14 models measured to honour it: DeepSeek V3.2,
  V4-Flash and V4.1-Flash, GLM-5.3-Flash, Kimi K2.6, Llama 4 Scout,
  Qwen3.6-27B, Qwen3-Next, Nemotron 3.5 Lightning, Granite 4.2 8B,
  MiMo V2.6 Flash, Hunyuan 3, Gemini 3.1 Flash Lite and Claude Haiku 4.5.
  On any other model it raises `UnsupportedFeatureError` before sending
  anything, instead of letting the request be ignored.
- **Reasoning off on gpt-oss.** gpt-oss can't stop reasoning, and DeepInfra
  accepts "off" and runs it at a low level anyway. LM15 sends the lowest
  level itself and says so in the response's adaptations.
- **Images inside a tool result** are refused: DeepInfra accepts only text
  there.
- **Caching** is automatic. A cache key or long retention has no place in
  the request LM15 sends, so it is left out and noted in the adaptations.

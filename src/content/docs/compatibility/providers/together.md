---
title: "Together AI"
description: Use open models hosted by Together AI through LM15, with the together provider: the key, the model names, and what LM15 does differently for gpt-oss and GLM.
---

Together AI runs open models from many vendors behind one API. In LM15 its
provider is `together`.

| | |
|---|---|
| Provider | `together` (litellm spelling: `together_ai/`) |
| Key | `TOGETHER_API_KEY`, from your Together project's [API keys](https://api.together.ai/settings/projects/~current/api-keys) |
| Model names | the vendor's name: `together:meta-llama/Llama-3.3-70B-Instruct-Turbo` |
| Needs | Python 1.1.0, TypeScript 1.0.0-rc.2, Rust 1.0.0-rc.2, Go v1.1.0-rc.2 or later |

Chat, streaming, tools, structured output and the model list work as with
any provider. Together's model list also includes models that need a
dedicated endpoint; calling one of those returns Together's error saying
so. What LM15 does differently here, each measured against Together on
September 26, 2026:

- **gpt-oss and forced tool calls.** Together answers a forced tool choice
  on gpt-oss with a server error, every time. LM15 raises
  `UnsupportedFeatureError` before sending it, so a retry loop doesn't
  spin on a request that can't succeed. Llama and DeepSeek on Together
  honour it.
- **gpt-oss effort levels.** Together runs `xhigh`, `max` and any unknown
  word at gpt-oss's default, medium. LM15 sends `high` instead and says so
  in the response's adaptations.
- **Reasoning off on gpt-oss and GLM-5.3.** Neither can stop reasoning, and
  Together accepts "off" and bills the reasoning anyway. LM15 sends the
  lowest level and says so.
- **gpt-oss tool conversations** are broken on Together's side: after a
  tool result, the answer starts with the model's internal channel name
  (`analysis`, `final`). Use Llama or DeepSeek there, or gpt-oss on another
  host.
- **Cached tokens.** Some Together models report cached tokens in a
  different place than OpenAI does; LM15 reads both.

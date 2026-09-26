---
title: "Fireworks AI"
description: "Use open models hosted by Fireworks AI through LM15, with the fireworks provider: the key, the model names, and what to expect from reasoning models."
---

Fireworks AI runs open models from many vendors behind one API. In LM15 its
provider is `fireworks`.

| | |
|---|---|
| Provider | `fireworks` (litellm spelling: `fireworks_ai/`) |
| Key | `FIREWORKS_API_KEY`, from [app.fireworks.ai/settings/users/api-keys](https://app.fireworks.ai/settings/users/api-keys) |
| Model names | Fireworks' own ids: `fireworks:accounts/fireworks/models/deepseek-v4p1-flash` |
| Needs | Python 1.1.0, TypeScript 1.0.0-rc.2, Rust 1.0.0-rc.2, Go v1.1.0-rc.2 or later |

Chat, streaming, tools (including a forced tool choice), structured output
and the model list work as with any provider. Measured against Fireworks on
September 26, 2026:

- **Reasoning off** is refused by Fireworks, with a clear error, on models
  that can't stop reasoning (gpt-oss, GLM-5.3). On models that can, such
  as DeepSeek V4.1, it works.
- **Reasoning stays out of the answer.** LM15 sends a model's earlier
  reasoning back in the field Fireworks reads, so a tool conversation
  keeps its train of thought without the reasoning showing in the text.
- **Images inside a tool result** reach the model.
- Some Fireworks models reason by default, even for a one-word answer; set
  a low effort for cheap calls.

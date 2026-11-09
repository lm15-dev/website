---
title: "Tinker (Thinking Machines)"
description: "Use Tinker's base models and the models you trained on Tinker through LM15: the two providers, the checkpoint names, the reasoning switch per model family, and what to expect."
---

Tinker, by Thinking Machines, trains open models; it also answers chat
requests for its base models and for any checkpoint you trained there. In
LM15 it has two providers, one key:

| | |
|---|---|
| Providers | `tinker` (Chat Completions; also spelled `thinkingmachines`) and `tinker-anthropic` (Anthropic Messages) |
| Key | `TINKER_API_KEY`, from [tinker.thinkingmachines.ai/keys](https://tinker.thinkingmachines.ai/keys) |
| Model names | a base model, `tinker:Qwen/Qwen3.5-4B` or `tinker:thinkingmachines/Inkling`; a checkpoint you trained, by its path: `tinker://<run>:train:0/sampler_weights/<name>` |
| Needs | the LM15 release after 2.2.0, in any language |

Use `tinker` unless you have a reason not to: it lists your checkpoints, it
can switch thinking off on every family that has an off switch, and it
reports the cached tokens that make the cost exact. Tinker calls both doors
beta. Measured against Tinker on November 9, 2026:

- **A checkpoint's path is its name.** `tinker://…` routes to Tinker as
  typed, colons and all. Listing the models of `tinker` shows
  your checkpoints and the base model each was trained from.
- **Thinking is on by default**, and each model family switches it its own
  way; LM15 sends the right one. Inkling takes the effort levels. Qwen
  3/3.5/3.6, Kimi K2.6 and Nemotron are an on/off switch: `off` turns it off,
  and any level turns it on (noted on the response). Qwen 3.8 and DeepSeek
  V4.1 take some levels and `off`. gpt-oss, Kimi K3.1 and GLM 5.3 can't stop
  thinking; Tinker says so with an error.
- **A checkpoint thinks like the model it came from**, but its path doesn't
  say which that is. Tell LM15, and it sends that family's switch:
  `RouterConfig(base_models={"tinker://…": "Qwen/Qwen3.5-4B"})` in Python
  (`baseModels` in TypeScript, `RouterConfig.BaseModels` in Go,
  `RouterConfig::base_models` in Rust, `RouterConfig(; base_models)` in Julia,
  `new_router(base_models = )` in R). Without it, `off` sends what most families take, which an
  Inkling checkpoint refuses.
- **A model you trained without thinking needs `off`** to see the prompt it
  was trained on: Tinker builds the "thinking" prompt unless told not to.
- **No JSON mode.** Tinker ignores `response_format`; LM15 leaves it out and
  notes that on the response. Describe the shape in the prompt.
- **Forcing a tool call** is checked after the model answers: a model that
  answered without calling a tool comes back as an `InvalidRequestError`.
  Asking again may work.
- **Stop sequences** work; Tinker also returns the sequence it stopped at,
  which LM15 removes, as on every other provider.
- **Images**, in a message or in a tool result, reach the vision models
  (Inkling; Qwen3.5-4B refuses images). A PDF in a tool result is refused.
- **Cost** is exact: cached prompt tokens are counted on both doors. A
  checkpoint is billed at its base model's rates.
- **`tinker-anthropic`** speaks the Anthropic Messages wire with the same
  key. It can't switch thinking off on Qwen, Kimi K2.6 or Nemotron (Tinker
  refuses), and it has no model list.
- **A model or checkpoint that doesn't exist** raises
  `UnsupportedModelError`, as on every provider, with Tinker's own message.

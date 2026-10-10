---
name: lm15
description: Write code that calls AI models (OpenAI, Anthropic, Gemini, Groq, DeepSeek, Moonshot, OpenRouter, xAI, local servers...) with the LM15 library. Use whenever a task says to use lm15, or asks for provider-portable model calls. Contains exact, tested Python code for every feature, so you do not need to read the library's source.
---

# LM15 quick reference (Python)

LM15 sends one `Request` shape to any provider and returns one `Response`
shape. This page is the Python reference; TypeScript, Rust, Go, R and Julia
use the same shapes with their own naming (links at the end). `pip install lm15` (standard library only, no dependencies).
Every snippet below was run against the real APIs. **The names here are
exact: copy them; do not read the installed source or guess other names.**
For something not covered: `python -c "import lm15; help(lm15.Name)"`.

Contents: the pattern · response parts · conversation · streaming · function
tools · structured output · images/PDFs/audio in · reasoning · web search ·
prompt caching · async · errors · image and speech generation · traps.

## The pattern

```python
from lm15 import Config, LMRouter, Message, Request

router = LMRouter()  # reads each provider's key from its standard env var
response = router.complete(Request(
    model="anthropic:claude-haiku-4-5",             # "provider:model-id"
    system="You are terse.",                        # optional
    messages=(Message.user("What is the capital of Peru?"),),
    config=Config(max_tokens=300),                  # optional
))
print(response.text)                                # str, or None if no text
print(response.finish_reason)                       # "stop", "length", "tool_call", ...
u = response.usage                                  # ints, or None if not reported
print(u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens, u.reasoning_tokens)
```

`messages` is a tuple (or list) of `Message`. Keys: the router reads each
provider's environment variable (table below). To pass keys yourself:

```python
import os
from lm15 import AnthropicLM, LMRouter, Message, Request, RouterConfig

router = LMRouter(RouterConfig(api_keys={"anthropic": os.environ["ANTHROPIC_API_KEY"]}))
lm = AnthropicLM(api_key=os.environ["ANTHROPIC_API_KEY"])   # or one provider's class directly
r = lm.complete(Request(model="claude-haiku-4-5", messages=(Message.user("Hi in one word."),)))
print(r.text)
```

The argument is **`api_key=`** (not `credential=`, which names a cloud
identity; not `key=`). There is no `set_api_key`.

| provider id | env var | class | notes |
|---|---|---|---|
| `openai` | `OPENAI_API_KEY` | `OpenAILM` | Responses API: reasoning, web search, images, speech |
| `openai-chat` | `OPENAI_API_KEY` | `OpenAIChatLM` | Chat Completions API |
| `anthropic` | `ANTHROPIC_API_KEY` | `AnthropicLM` | |
| `gemini` | `GEMINI_API_KEY` or `GOOGLE_API_KEY` | `GeminiLM` | images, speech |
| `groq`, `deepseek`, `openrouter`, `zai`, `together`, `fireworks`, `deepinfra` | `GROQ_API_KEY`, ... (`<ID>_API_KEY`) | `OpenAIChatLM(compat="<id>")` | |
| `moonshotai` | `MOONSHOTAI_API_KEY` or `MOONSHOT_API_KEY` | `OpenAIChatLM(compat="moonshotai")` | |
| `xai` | `XAI_API_KEY` | `XaiLM` | |
| `ollama`, `vllm`, `sglang` | none | `OpenAIChatLM(compat="ollama")` | local servers |

Model ids keep their own slashes: `"openrouter:openai/gpt-4o-mini"`,
`"groq:openai/gpt-oss-20b"`. Ids starting `gpt-`, `claude-`, `gemini-` may
omit the provider. Async: `AsyncLMRouter`, `AsyncAnthropicLM`, ... (same
methods, awaited).

## Response parts

```python
from lm15 import CitationPart, TextPart, ThinkingPart, ToolCallPart

def describe(response):
    msg = response.message                          # the full assistant Message
    text = msg.text                                 # all text parts joined
    thinking = "".join(p.text for p in msg.parts_of(ThinkingPart))
    calls = response.tool_calls                     # tuple of ToolCallPart(id, name, input: dict)
    urls = [c.url for c in response.citations]      # CitationPart(url, title, ...) from web search
    data = response.data                            # a structured answer (dict), or None
    return text, thinking, calls, urls, data
```

## Conversation

Send the whole history every time. Append `response.message` itself (it can
carry provider state that a text copy loses).

```python
from lm15 import LMRouter, Message, Request

router = LMRouter()
history = []
for text in ["My name is Ada. Just acknowledge.", "What is my name?"]:
    history.append(Message.user(text))
    response = router.complete(Request(model="openai:gpt-4.1-mini", messages=tuple(history)))
    history.append(response.message)
    print(response.text)
```

## Streaming

```python
from lm15 import LMRouter, Message, Request, StreamDeltaEvent, StreamEndEvent, TextDelta

router = LMRouter()
request = Request(model="gemini:gemini-2.5-flash", messages=(Message.user("Count to 5."),))
for event in router.stream(request):
    if isinstance(event, StreamDeltaEvent) and isinstance(event.delta, TextDelta):
        print(event.delta.text, end="", flush=True)
    elif isinstance(event, StreamEndEvent):
        print("\n", event.finish_reason, event.usage.output_tokens)
```

To also get the assembled `Response` (text, tool calls, usage) from the same
stream, wrap it:

```python
from lm15 import LMRouter, Message, Request, ResponseStream

router = LMRouter()
request = Request(model="anthropic:claude-haiku-4-5", messages=(Message.user("Say hi."),))
stream = ResponseStream(router.stream(request), request)
for text in stream:                                 # yields text chunks only
    print(text, end="", flush=True)
response = stream.response                          # a normal Response (property)
print("\n", response.usage.output_tokens)
```

## Function tools (your code runs them)

LM15 does not run tools or loop for you. Loop until no tool calls remain:

```python
import json
from lm15 import FunctionTool, LMRouter, Message, Request

def get_weather(city: str) -> dict:
    return {"city": city, "celsius": 21}

tools = (FunctionTool(
    name="get_weather",
    description="Current weather for a city.",
    parameters={"type": "object", "properties": {"city": {"type": "string"}}, "required": ["city"]},
),)
router = LMRouter()
messages = [Message.user("What's the weather in Oslo? Use the tool.")]
while True:
    response = router.complete(Request(model="anthropic:claude-haiku-4-5", messages=tuple(messages), tools=tools))
    messages.append(response.message)               # keep the call in history
    if not response.tool_calls:
        break
    results = {}
    for call in response.tool_calls:                # ToolCallPart: .id, .name, .input (dict)
        if call.name == "get_weather":
            results[call.id] = json.dumps(get_weather(**call.input))
    messages.append(Message.tool(results))          # {call_id: result string}
print(response.text)
```

Streamed tool calls: build the request the same way, consume it with
`stream = ResponseStream(router.stream(request), request)`, iterate for text,
then read `stream.response.tool_calls` (a property) and continue the loop.

## Structured output (JSON schema)

Same shape for every provider (OpenAI, Gemini, Anthropic, ...):

```python
from lm15 import Config, LMRouter, Message, Request

schema = {
    "type": "json_schema",
    "name": "person",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {"name": {"type": "string"}, "age": {"type": "integer"}},
        "required": ["name", "age"],
        "additionalProperties": False,
    },
}
router = LMRouter()
response = router.complete(Request(
    model="gemini:gemini-2.5-flash",
    messages=(Message.user("Extract: Ines Duarte is 34 years old."),),
    config=Config(response_format=schema),
))
print(response.data)                                # {'name': 'Ines Duarte', 'age': 34}
```

**Read the answer with `response.data`**, not `.text` or `.json`. A schema
with a top-level boolean or enum property makes the answer a `DataPart`
(lm15 treats those properties as judgments), and then `.text` is empty and
`.json` (which parses text) is `None`; `.data` reads both forms.

## Images, PDFs, audio as input

A user message takes a string, one part, or a tuple of parts. File parts
read the file but **do not guess its type from the extension**: pass
`media_type=` unless it is the default (`image/png`, `application/pdf`,
`audio/wav`).

```python
from pathlib import Path
from lm15 import AudioPart, DocumentPart, ImagePart, LMRouter, Message, Request, TextPart

def ask_about(model: str, question: str, part) -> str:
    request = Request(model=model, messages=(Message.user((TextPart(question), part)),))
    return LMRouter().complete(request).text

# ask_about("gemini:gemini-2.5-flash", "What is in this picture?", ImagePart(path=Path("photo.jpg"), media_type="image/jpeg"))
# ask_about("anthropic:claude-haiku-4-5", "Summarise this.", DocumentPart(path=Path("file.pdf")))
# ask_about("gemini:gemini-2.5-flash", "Transcribe this.", AudioPart(path=Path("clip.mp3"), media_type="audio/mpeg"))
# Also: ImagePart(url="https://..."), ImagePart(data=<base64 str>, media_type="image/jpeg")
```

## Reasoning and thinking

```python
from lm15 import Config, LMRouter, Message, Reasoning, Request, ThinkingPart

router = LMRouter()
# OpenAI reasoning models: effort, and the count of reasoning tokens
r = router.complete(Request(
    model="openai:gpt-5-mini",
    messages=(Message.user("Is 221 prime? Answer yes or no."),),
    config=Config(reasoning=Reasoning(effort="high")),
))
print(r.text, r.usage.reasoning_tokens)

# Anthropic/Gemini extended thinking: a token budget, and the thinking text
r = router.complete(Request(
    model="anthropic:claude-haiku-4-5",
    messages=(Message.user("Is 221 prime? Answer yes or no."),),
    config=Config(reasoning=Reasoning(effort="medium", thinking_budget=2000), max_tokens=4000),
))
print(r.text, len("".join(p.text for p in r.message.parts_of(ThinkingPart))))
```

`effort`: `"off"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`.
**Thinking off** is `Reasoning(effort="off")` with no budget (not
`thinking_budget=0`). `thinking_budget` is only for Anthropic/Gemini-style
budgets and must be > 0.

## Provider built-in tools (web search)

The provider runs these; do not execute them yourself.

```python
from lm15 import BuiltinTool, LMRouter, Message, Request

router = LMRouter()
response = router.complete(Request(
    model="openai:gpt-5.4-mini",                    # also anthropic:..., gemini:...
    messages=(Message.user("What is the latest stable Python release? Cite sources."),),
    tools=(BuiltinTool("web_search"),),
))
print(response.text)
print([c.url for c in response.citations])
```

Options go in the second argument: `BuiltinTool("web_search", {"max_uses": 2})`.
`BuiltinTool("code_execution")` runs code at the provider (OpenAI needs
`{"container": {"type": "auto"}}`).

## Prompt caching

```python
from pathlib import Path
from lm15 import CacheConfig, Config, LMRouter, Message, Request

long_text = Path("handbook.txt").read_text()       # caching needs a long prefix (Anthropic: 1024-4096+ tokens)
router = LMRouter()
for question in ["First question?", "Second question?"]:
    r = router.complete(Request(
        model="anthropic:claude-haiku-4-5",
        system=long_text,
        messages=(Message.user(question),),
        config=Config(cache=CacheConfig()),        # caches system + tools
    ))
    print(r.usage.cache_write_tokens, r.usage.cache_read_tokens)
```

`CacheConfig(prefix="history")` caches up to the end of the last message
instead (a long document in the conversation); `CacheConfig(prefix_until_index=i)`
caches up to message `i`. Results show up in `usage.cache_*_tokens`.

## Many calls at once (async)

```python
import asyncio
from lm15 import AsyncLMRouter, Message, Request

async def main():
    router = AsyncLMRouter()
    prompts = ["Capital of Chile? One word.", "Capital of Ghana? One word."]
    responses = await asyncio.gather(*(
        router.complete(Request(model="groq:openai/gpt-oss-20b", messages=(Message.user(p),)))
        for p in prompts
    ))
    print([r.text for r in responses])
    await router.aclose()                           # async clients close with aclose()

asyncio.run(main())
```

## Errors

All errors derive from `lm15.LM15Error`. Catch the specific classes:

```python
import lm15

def category(error: Exception) -> str:
    if isinstance(error, (lm15.AuthError, lm15.MissingCredentialError)): return "auth"
    if isinstance(error, (lm15.UnsupportedModelError, lm15.UnknownModelError)): return "model_not_found"
    if isinstance(error, lm15.RateLimitError): return "rate_limit"     # has .retry_after
    if isinstance(error, lm15.ContextLengthError): return "context_length"
    if isinstance(error, lm15.InvalidRequestError): return "invalid_request"
    if isinstance(error, (lm15.ServerError, lm15.TimeoutError, lm15.TransportError)): return "server"
    return "other"

try:
    lm15.LMRouter().complete(lm15.Request(model="openai:gpt-does-not-exist",
                                          messages=(lm15.Message.user("hi"),)))
except lm15.LM15Error as error:
    print(type(error).__name__, category(error))
```

Order matters: `UnsupportedModelError` and `ContextLengthError` are kinds of
`InvalidRequestError`, so test them first.
`lm15.RETRYABLE_ERRORS` is the tuple of classes worth retrying.

## Generate images and speech

```python
import io, wave
from pathlib import Path
from lm15 import ImageGenerationRequest, LMRouter, ProviderError, SpeechGenerationRequest

router = LMRouter()
img = router.lm("openai:gpt-image-1-mini").image_generate(ImageGenerationRequest(
    model="gpt-image-1-mini", prompt="a flat red circle icon", size="1024x1024",
    extensions={"quality": "low"},                  # provider-specific options go in extensions
))
Path("circle.png").write_bytes(img.images[0].bytes)  # also gemini:gemini-2.5-flash-image

tts = router.lm("gemini:gemini-2.5-flash-preview-tts")
for attempt in range(3):                            # the preview model sometimes returns no audio
    try:
        speech = tts.speech_generate(SpeechGenerationRequest(
            model="gemini-2.5-flash-preview-tts",
            prompt="Say cheerfully: Hello there."))  # an instruction + the text; bare text fails
        break
    except ProviderError:
        if attempt == 2:
            raise
audio = speech.audio                                # AudioPart; .bytes, .media_type
if audio.media_type.startswith("audio/L16"):       # raw PCM, e.g. "audio/L16;codec=pcm;rate=24000"
    rate = int(audio.media_type.split("rate=")[1].split(";")[0])
    with wave.open("hello.wav", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(audio.bytes)
else:                                               # OpenAI: SpeechGenerationRequest(..., format="wav")
    Path("hello.out").write_bytes(audio.bytes)
```

OpenAI streams its WAV, so the header's sizes are placeholders (`wave`
reports about 24 hours). Duration in seconds = bytes after the `data`
chunk header / (rate × channels × sample width).

## Traps

- **Reasoning models think inside `max_tokens`** (gpt-5*, o-series, gemini-2.5/3, kimi-k2.x, gpt-oss, deepseek-reasoner, Claude with thinking). A small limit returns empty text with `finish_reason="length"`. Omit `max_tokens` or give 2000+.
- **Don't set `temperature` unless asked.** Some models reject any value but their own (Moonshot's kimi models).
- `response.text` is `None` when the reply has no text (only tool calls, only an image); check `finish_reason` before treating that as an error.
- Errors are typed (see Errors): a wrong key is `AuthError` on every provider, a wrong model name `UnsupportedModelError` (lm15 >= 1.2.2).
- `openai:` is the Responses API (reasoning summaries, built-in tools, media generation); `openai-chat:` is Chat Completions.
- Usage fields the provider did not report are `None`, not `0`. Do not add cached and uncached counts together blindly; providers count them differently.
- Preview models are flaky: Gemini's TTS preview sometimes returns no audio (`ProviderError`); retry, as in the speech example.
- `Config.extensions={...}` passes provider-specific fields through unchanged; don't invent shared fields.
- Real calls cost money: keep prompts and limits small. When asked for a working program and keys are set, test it with a real call; build `lm15.testing.FakeLM` fakes only when unit tests are asked for.

## Other languages

TypeScript (`@lm15/lm15`), Rust, Go, R and Julia share the same Request,
Response and stream shapes with each language's naming. Their README files:
https://lm15.dev/llms.txt. Behaviour is defined by the contract:
https://github.com/lm15-dev/lm15-contract.

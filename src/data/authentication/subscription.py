from dataclasses import replace

print(explain_auth("openai-codex"))

router = LMRouter()
codex = replace(request, model="openai-codex:gpt-5.6-sol")
print(router.complete(codex).text)

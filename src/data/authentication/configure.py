auth.configure(
    "anthropic", method="env", answers={"name": "ANTHROPIC_API_KEY"},
)
print(router.complete(request).text)

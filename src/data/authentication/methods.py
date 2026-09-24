for method in auth.methods("openai-codex"):
    print(f"{method.availability:<11} {method.label}")

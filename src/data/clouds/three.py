from lm15 import LMRouter, Message, Request

router = LMRouter()
for model in [
    "bedrock-chat:deepseek.v3.2",
    "azure:gpt-4.1-mini",
    "vertex:gemini-2.5-flash",
]:
    request = Request(
        model=model,
        system=(
            "You are the field assistant for a wildlife research "
            "station. Answer in two sentences."
        ),
        messages=[Message.user(
            "What might be eating the acorns under our oak trees "
            "at night?"
        )],
    )
    print(model)
    print(router.complete(request).text, end="\n\n")

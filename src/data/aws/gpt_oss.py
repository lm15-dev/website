from lm15 import LMRouter, Message, Request

router = LMRouter()
request = Request(
    model="bedrock-chat:openai.gpt-oss-120b-1:0",
    system=(
        "You are the field assistant for a wildlife research "
        "station. Answer in two sentences."
    ),
    messages=[Message.user(
        "What might be eating the acorns under our oak trees at "
        "night?"
    )],
)
print(router.complete(request).text)

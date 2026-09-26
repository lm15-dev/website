from lm15 import LMRouter, Message, Request, RouterConfig

router = LMRouter(RouterConfig(
    settings={"bedrock-chat": {"region": "us-east-1"}},
))
request = Request(
    model="bedrock-chat:deepseek.v3.2",
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

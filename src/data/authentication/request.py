from lm15 import LMRouter, Message, Request, RouterConfig
from lm15.doctor import explain_auth

request = Request(
    model="anthropic:claude-haiku-4-5",
    system=(
        "You are the field assistant for a wildlife research station. "
        "Answer in two sentences."
    ),
    messages=[Message.user(
        "What might be eating the acorns under our oak trees at "
        "night?"
    )],
)

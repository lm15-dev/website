from azure.identity import AzureCliCredential, get_bearer_token_provider
from lm15 import LMRouter, Message, Request, RouterConfig

token = get_bearer_token_provider(
    AzureCliCredential(), "https://ai.azure.com/.default"
)
router = LMRouter(RouterConfig(
    api_keys={"azure": token},
))
request = Request(
    model="azure:gpt-4.1-mini",
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

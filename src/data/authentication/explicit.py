import os

router = LMRouter(RouterConfig(
    api_keys={"anthropic": os.environ["STATION_API_KEY"]},
))
print(explain_auth("anthropic", config=router.config))

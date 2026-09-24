from pathlib import Path

def station_key():
    print("(reading the key)")
    return Path("secrets/anthropic.key").read_text().strip()

router = LMRouter(RouterConfig(api_keys={"anthropic": station_key}))
first = router.complete(request)
second = router.complete(request)
print(second.text)

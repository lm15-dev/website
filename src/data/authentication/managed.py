from lm15.login import Auth

auth = Auth.local()
router = LMRouter(RouterConfig(auth=auth))
print(explain_auth("anthropic", config=router.config))

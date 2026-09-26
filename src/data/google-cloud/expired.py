from lm15 import AuthError, LMRouter, Message, Request

router = LMRouter()
request = Request(
    model="vertex:gemini-2.5-flash",
    system=(
        "You are the field assistant for a wildlife research "
        "station. Answer in two sentences."
    ),
    messages=[Message.user(
        "What might be eating the acorns under our oak trees at "
        "night?"
    )],
)
try:
    print(router.complete(request).text)
except AuthError as error:
    print(error)

reply = router.complete(Request(
    model="anthropic:claude-haiku-4-5",
    messages=[Message.user(note)],
    config=Config(response_format=answers,
                  probabilities="required"),
))

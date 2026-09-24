reply = router.complete(Request(
    model="anthropic:claude-haiku-4-5",
    messages=[Message.user(note)],
    config=Config(response_format=answers,
                  probabilities="if_available"),
))
print(reply.data)
print(reply.probabilities)
for change in reply.adaptations:
    print(change.field, change.action)

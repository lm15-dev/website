note = ("Checked the stream camera this morning. Three\n"
        "badgers came through overnight, one of them limping.\n"
        "A fox passed later, just before dawn.")

router = LMRouter()
reply = router.complete(Request(
    model="jev-latest",
    messages=[Message.user(note)],
    config=Config(response_format=answers,
                  probabilities="if_available"),
))
print(reply.data)
print(reply.probabilities)
print(reply.method)

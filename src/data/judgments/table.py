notes = {
    "stream": note,
    "barn": ("Around midnight an owl was calling from the old\n"
             "barn roof, probably a tawny. Two hares in the barn\n"
             "field at first light."),
    "deer": ("Dusk, edge of the oak grove. Two deer browsing on\n"
             "fallen acorns, one small with spots still showing.\n"
             "Too far to be sure of the species: roe or fallow."),
}
for name, text in notes.items():
    reply = router.complete(Request(
        model="jev-latest",
        messages=[Message.user(text)],
        config=Config(response_format=answers,
                      probabilities="if_available"),
    ))
    sure = reply.expected("certainty")
    print(f"{name:7}{reply.data['animal']:8}{sure:.2f}")

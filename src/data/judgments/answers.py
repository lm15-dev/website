from lm15 import (Config, LMRouter, Message, Request,
                  choice, judgments, score, yes_no)

answers = judgments(
    animal=choice("Which animal is the note mainly about?",
                  ["badger", "fox", "owl", "hare", "deer"]),
    certainty=score("How sure is the observer of the species?",
                    ["guess", "probable", "confident"]),
    hurt=yes_no("Does the note report a hurt animal?"),
)

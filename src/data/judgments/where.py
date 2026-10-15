from lm15 import bounding_box
from lm15.types import image

where = judgments(
    badger=bounding_box("the badger in the image"),
    seen=yes_no("Is there a badger in the image?"),
)
reply = router.complete(Request(
    model="jev-preview",
    messages=[Message.user(image(path="badger.jpg"))],
    config=Config(response_format=where),
))
print(reply.data)

width, height = 1280, 718  # the photo's size, in pixels
box = reply.data["badger"]
print(round(box["left"] * width), round(box["top"] * height),
      round(box["right"] * width), round(box["bottom"] * height))

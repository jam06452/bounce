from PIL import Image
import sys

INPUT_FILE = "input.jpg"
OUTPUT_FILE = "output.png"

TRANSPARENT_COLOUR = (255, 255, 255)  # White

TOLERANCE = 30

image = Image.open(INPUT_FILE).convert("RGBA")
pixels = image.load()

width, height = image.size

for y in range(height):
    for x in range(width):
        r, g, b, a = pixels[x, y]

        if (
            abs(r - TRANSPARENT_COLOUR[0]) <= TOLERANCE
            and abs(g - TRANSPARENT_COLOUR[1]) <= TOLERANCE
            and abs(b - TRANSPARENT_COLOUR[2]) <= TOLERANCE
        ):
            pixels[x, y] = (r, g, b, 0)

image.save(OUTPUT_FILE, "PNG")

print(f"Converted successfully: {OUTPUT_FILE}")

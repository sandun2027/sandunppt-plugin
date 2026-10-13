from pathlib import Path
import sys
from PIL import Image, ImageDraw

target = Path(sys.argv[1])
image = Image.new("RGBA", (256, 256))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((12, 12, 244, 244), radius=56, fill="#FFFFFF", outline="#E1E7EF", width=2)
draw.rounded_rectangle((59, 57, 205, 166), radius=16, fill="#F0F3F7", outline="#D5DFEA", width=3)
draw.rounded_rectangle((43, 79, 187, 189), radius=16, fill="#FFFFFF", outline="#879DB7", width=5)
draw.rounded_rectangle((65, 108, 135, 116), radius=4, fill="#879DB7")
draw.rounded_rectangle((65, 133, 156, 139), radius=3, fill="#D0DAE6")
draw.rounded_rectangle((65, 153, 128, 159), radius=3, fill="#E2E8F0")
image.save(target / "Setup.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (256, 256)])

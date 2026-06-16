"""Generate Electron app icon — antenna / agent radial motif."""
from PIL import Image, ImageDraw
import math, os

SIZE = 1024
img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Rounded rectangle mask
margin = 64
r = 160
for y in range(SIZE):
    for x in range(SIZE):
        bx, by = margin, margin
        bw, bh = SIZE - 2*margin, SIZE - 2*margin
        inside = False
        if bx + r <= x <= bx + bw - r:
            inside = True
        elif by + r <= y <= by + bh - r:
            inside = True
        else:
            # Corner zones
            if x < bx + r and y < by + r:
                inside = (x - bx - r)**2 + (y - by - r)**2 <= r**2
            elif x > bx + bw - r and y < by + r:
                inside = (x - bx - bw + r)**2 + (y - by - r)**2 <= r**2
            elif x < bx + r and y > by + bh - r:
                inside = (x - bx - r)**2 + (y - by - bh + r)**2 <= r**2
            elif x > bx + bw - r and y > by + bh - r:
                inside = (x - bx - bw + r)**2 + (y - by - bh + r)**2 <= r**2
        if inside:
            t = y / SIZE
            rv = int(20 + t * 40)
            gv = int(50 + t * 120)
            bv = int(170 + t * 85)
            img.putpixel((x, y), (rv, gv, bv, 255))

draw = ImageDraw.Draw(img)
cx, cy = SIZE // 2, SIZE // 2

# Outer dashed ring
for angle in range(360):
    rad = angle * math.pi / 180
    r_outer = 340
    x = int(cx + r_outer * math.cos(rad))
    y = int(cy + r_outer * math.sin(rad))
    alpha = 100 + int(100 * (angle % 60) / 60)
    img.putpixel((x, y), (255, 255, 255, alpha))

# Radial spokes (16 spokes)
for i in range(16):
    angle = i * 360.0 / 16
    rad = angle * math.pi / 180
    for d in range(0, 120, 3):
        r2 = 340 - d
        x = int(cx + r2 * math.cos(rad))
        y = int(cy + r2 * math.sin(rad))
        alpha = max(20, 180 - d * 2)
        img.putpixel((x, y), (255, 255, 255, alpha))

# Thick nodes at spoke tips
for i in range(16):
    angle = i * 360.0 / 16
    rad = angle * math.pi / 180
    nx = int(cx + 340 * math.cos(rad))
    ny = int(cy + 340 * math.sin(rad))
    for dy in range(-10, 11):
        for dx in range(-10, 11):
            if dx*dx + dy*dy <= 100:
                img.putpixel((nx+dx, ny+dy), (255, 255, 255, 220))

# Center hub
for y in range(cy - 60, cy + 60):
    for x in range(cx - 60, cx + 60):
        if (x - cx)**2 + (y - cy)**2 <= 60**2:
            img.putpixel((x, y), (255, 255, 255, 255))

# Inner core
for y in range(cy - 18, cy + 18):
    for x in range(cx - 18, cx + 18):
        if (x - cx)**2 + (y - cy)**2 <= 18**2:
            img.putpixel((x, y), (25, 75, 200, 255))

# Output dir
out_dir = os.path.join(os.path.dirname(__file__), '..', 'build')
os.makedirs(out_dir, exist_ok=True)

# PNG
png_path = os.path.join(out_dir, 'icon.png')
img.save(png_path)
print(f"OK icon.png ({SIZE}x{SIZE})")

# ICO with multiple sizes
sizes = [16, 32, 48, 64, 128, 256]
ico_images = []
for s in sizes:
    resized = img.resize((s, s), Image.LANCZOS)
    ico_images.append(resized)

ico_path = os.path.join(out_dir, 'icon.ico')
ico_images[0].save(ico_path, format='ICO', sizes=[(s, s) for s in sizes], append_images=ico_images[1:])
print(f"OK icon.ico sizes={sizes}")
print(f"OUT {out_dir}")

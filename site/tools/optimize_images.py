"""Makes small web images: python3 -I tools/optimize_images.py

Takes every picture in site/originals/ (not in git) and writes a WebP to
site/public/images/ with the same name. Run it from the site folder.
"""
from pathlib import Path

from PIL import Image, ImageOps

MAX_WIDTH = 900  # the demo shows these about 450 px wide; this stays sharp on hi-res screens
QUALITY = 72

for src in sorted(Path('originals').iterdir()):
    if src.suffix.lower() not in ('.png', '.jpg', '.jpeg', '.webp'):
        continue
    with Image.open(src) as opened:
        image = ImageOps.exif_transpose(opened).convert('RGB')
    image.thumbnail((MAX_WIDTH, MAX_WIDTH * 2), Image.LANCZOS)
    # Pasting into a new image drops everything but the pixels, including any location data.
    clean = Image.new('RGB', image.size)
    clean.paste(image)
    out = Path('public/images') / f'{src.stem}.webp'
    clean.save(out, 'WEBP', quality=QUALITY, method=6)
    print(f'{src.name}: {src.stat().st_size // 1024} KB -> {out.name}: {out.stat().st_size // 1024} KB, {clean.width}x{clean.height}')

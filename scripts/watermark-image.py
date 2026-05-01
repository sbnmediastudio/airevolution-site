#!/usr/bin/env python3
"""Add SBN Media Studio watermark to images for Instagram publishing.

Usage:
  python watermark-image.py input.jpg output.jpg
  python watermark-image.py input.jpg              # overwrites in place
  python watermark-image.py --batch images/articles/  # watermark all in folder

The watermark is a semi-transparent "© SBN Media Studio" in the bottom-right corner.
"""
import sys, os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

# ── Watermark config ──
WATERMARK_TEXT = "\u00a9 SBN Media Studio"
OPACITY = 140           # 0=invisible, 255=solid (140 = ~55% visible)
FONT_SIZE_RATIO = 0.028 # font size as % of image width (2.8%)
MARGIN_RATIO = 0.02     # margin from edge as % of image width
POSITION = 'bottom-right'  # bottom-right, bottom-left, top-right, top-left
SHADOW = True           # add dark shadow behind text for readability


def get_font(size):
    """Try to load a clean sans-serif font, fallback to default."""
    font_paths = [
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/calibri.ttf",
        "C:/Windows/Fonts/verdana.ttf",
    ]
    for fp in font_paths:
        if os.path.exists(fp):
            return ImageFont.truetype(fp, size)
    return ImageFont.load_default()


def add_watermark(input_path, output_path=None):
    """Add watermark to a single image."""
    if output_path is None:
        output_path = input_path

    img = Image.open(input_path).convert('RGBA')
    w, h = img.size

    # Create transparent overlay
    overlay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Font size relative to image width
    font_size = max(int(w * FONT_SIZE_RATIO), 16)
    font = get_font(font_size)

    # Measure text
    bbox = draw.textbbox((0, 0), WATERMARK_TEXT, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

    # Position
    margin = int(w * MARGIN_RATIO)
    if POSITION == 'bottom-right':
        x, y = w - tw - margin, h - th - margin
    elif POSITION == 'bottom-left':
        x, y = margin, h - th - margin
    elif POSITION == 'top-right':
        x, y = w - tw - margin, margin
    elif POSITION == 'top-left':
        x, y = margin, margin
    else:
        x, y = w - tw - margin, h - th - margin

    # Shadow for readability
    if SHADOW:
        shadow_offset = max(2, font_size // 20)
        draw.text((x + shadow_offset, y + shadow_offset), WATERMARK_TEXT,
                  font=font, fill=(0, 0, 0, min(OPACITY + 40, 220)))

    # Main watermark text (white, semi-transparent)
    draw.text((x, y), WATERMARK_TEXT, font=font, fill=(255, 255, 255, OPACITY))

    # Composite
    watermarked = Image.alpha_composite(img, overlay)

    # Save as RGB (JPEG doesn't support alpha)
    out_ext = Path(output_path).suffix.lower()
    if out_ext in ('.jpg', '.jpeg'):
        watermarked = watermarked.convert('RGB')
        watermarked.save(output_path, 'JPEG', quality=95)
    else:
        watermarked.save(output_path)

    return output_path


def batch_watermark(folder, output_folder=None):
    """Watermark all images in a folder."""
    folder = Path(folder)
    if output_folder:
        out = Path(output_folder)
        out.mkdir(parents=True, exist_ok=True)
    else:
        out = folder

    count = 0
    for img_file in sorted(folder.glob('*')):
        if img_file.suffix.lower() in ('.jpg', '.jpeg', '.png'):
            out_path = out / img_file.name
            add_watermark(str(img_file), str(out_path))
            count += 1
            print(f"  Watermarked: {img_file.name}")

    print(f"\n  Done: {count} images watermarked")
    return count


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python watermark-image.py input.jpg [output.jpg]")
        print("  python watermark-image.py --batch folder/ [output_folder/]")
        sys.exit(1)

    if sys.argv[1] == '--batch':
        folder = sys.argv[2] if len(sys.argv) > 2 else '.'
        out_folder = sys.argv[3] if len(sys.argv) > 3 else None
        batch_watermark(folder, out_folder)
    else:
        inp = sys.argv[1]
        outp = sys.argv[2] if len(sys.argv) > 2 else None
        result = add_watermark(inp, outp)
        print(f"  Watermarked: {result}")

#!/usr/bin/env python3
"""Add SBN Media Studio watermark to images.

Usage:
  python watermark-image.py input.jpg output.jpg
  python watermark-image.py input.jpg              # overwrites in place
  python watermark-image.py --batch images/articles/  # watermark all in folder

The watermark is a semi-transparent "(c) SBN Media Studio" in the bottom-right
corner.

Idempotency: each processed image directory gets a `.watermark-manifest.json`
tracking which filenames have already been stamped. Single-file mode always
re-stamps (the publishing pipeline calls us right after generating a fresh
image). Batch mode skips files already in the manifest so older images get
watermarked exactly once even on repeat runs.
"""
import sys, os, json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

WATERMARK_TEXT = "© SBN Media Studio"
OPACITY = 140
FONT_SIZE_RATIO = 0.028
MARGIN_RATIO = 0.02
POSITION = 'bottom-right'
SHADOW = True
MANIFEST_NAME = '.watermark-manifest.json'
MANIFEST_VERSION = 1


def _manifest_path(folder):
    return Path(folder) / MANIFEST_NAME


def load_manifest(folder):
    p = _manifest_path(folder)
    if p.exists():
        try:
            return set(json.loads(p.read_text(encoding='utf-8')).get('watermarked', []))
        except Exception:
            return set()
    return set()


def save_manifest(folder, watermarked):
    p = _manifest_path(folder)
    p.write_text(json.dumps({'v': MANIFEST_VERSION, 'watermarked': sorted(watermarked)}, indent=2), encoding='utf-8')


def get_font(size):
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
    if output_path is None:
        output_path = input_path

    img = Image.open(input_path).convert('RGBA')
    w, h = img.size

    overlay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    font_size = max(int(w * FONT_SIZE_RATIO), 16)
    font = get_font(font_size)

    bbox = draw.textbbox((0, 0), WATERMARK_TEXT, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]

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

    if SHADOW:
        shadow_offset = max(2, font_size // 20)
        draw.text((x + shadow_offset, y + shadow_offset), WATERMARK_TEXT,
                  font=font, fill=(0, 0, 0, min(OPACITY + 40, 220)))

    draw.text((x, y), WATERMARK_TEXT, font=font, fill=(255, 255, 255, OPACITY))

    watermarked = Image.alpha_composite(img, overlay)

    out_ext = Path(output_path).suffix.lower()
    if out_ext in ('.jpg', '.jpeg'):
        watermarked = watermarked.convert('RGB')
        watermarked.save(output_path, 'JPEG', quality=95)
    else:
        watermarked.save(output_path)

    return output_path


def batch_watermark(folder, output_folder=None):
    folder = Path(folder)
    if output_folder:
        out = Path(output_folder)
        out.mkdir(parents=True, exist_ok=True)
        manifest_dir = out
    else:
        out = folder
        manifest_dir = folder

    manifest = load_manifest(manifest_dir)
    initial_size = len(manifest)
    new_count = 0
    skip_count = 0

    for img_file in sorted(folder.glob('*')):
        if img_file.suffix.lower() not in ('.jpg', '.jpeg', '.png'):
            continue
        if img_file.name in manifest:
            skip_count += 1
            continue
        out_path = out / img_file.name
        add_watermark(str(img_file), str(out_path))
        manifest.add(img_file.name)
        new_count += 1
        print(f"  Watermarked: {img_file.name}")

    if len(manifest) != initial_size:
        save_manifest(manifest_dir, manifest)

    print(f"\n  Done: {new_count} new watermark(s), {skip_count} already stamped")
    return new_count


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

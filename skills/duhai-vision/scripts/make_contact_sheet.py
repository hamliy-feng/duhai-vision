from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def iter_images(inputs: list[str]) -> list[Path]:
    files: list[Path] = []
    for raw in inputs:
        p = Path(raw)
        if p.is_dir():
            for child in p.rglob("*"):
                if child.is_file() and child.suffix.lower() in EXTS:
                    files.append(child)
        elif p.is_file() and p.suffix.lower() in EXTS:
            files.append(p)
    unique = []
    seen = set()
    for p in sorted(files, key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            key = (str(p.resolve()).lower(), p.stat().st_size)
        except OSError:
            continue
        if key in seen:
            continue
        seen.add(key)
        unique.append(p)
    return unique


def main() -> None:
    parser = argparse.ArgumentParser(description="Create numbered contact sheets for Duhai Vision review.")
    parser.add_argument("--input", action="append", required=True, help="Image file or directory; repeatable.")
    parser.add_argument("--out", required=True, help="Output directory.")
    parser.add_argument("--limit", type=int, default=96)
    parser.add_argument("--cols", type=int, default=4)
    parser.add_argument("--rows", type=int, default=4)
    parser.add_argument("--thumb", type=int, default=180)
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    picked = iter_images(args.input)[: args.limit]

    font = ImageFont.load_default()
    thumb_w = thumb_h = args.thumb
    label_h = 34
    per_sheet = args.cols * args.rows
    sheet_w = args.cols * thumb_w
    sheet_h = args.rows * (thumb_h + label_h)
    manifest = []
    sheets = []

    for sheet_idx in range((len(picked) + per_sheet - 1) // per_sheet):
        sheet = Image.new("RGB", (sheet_w, sheet_h), "white")
        draw = ImageDraw.Draw(sheet)
        subset = picked[sheet_idx * per_sheet : (sheet_idx + 1) * per_sheet]
        for i, p in enumerate(subset):
            idx = sheet_idx * per_sheet + i + 1
            x = (i % args.cols) * thumb_w
            y = (i // args.cols) * (thumb_h + label_h)
            try:
                im = Image.open(p).convert("RGB")
                im = ImageOps.exif_transpose(im)
                im.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
                bg = Image.new("RGB", (thumb_w, thumb_h), (245, 245, 245))
                bg.paste(im, ((thumb_w - im.width) // 2, (thumb_h - im.height) // 2))
                sheet.paste(bg, (x, y))
            except Exception:
                draw.rectangle([x, y, x + thumb_w, y + thumb_h], fill=(230, 230, 230))
                draw.text((x + 4, y + 70), "LOAD FAIL", fill="red", font=font)
            draw.rectangle([x, y, x + 54, y + 22], fill=(0, 0, 0))
            draw.text((x + 4, y + 4), f"#{idx}", fill="white", font=font)
            draw.text((x + 4, y + thumb_h + 3), p.name[:28], fill="black", font=font)
            manifest.append({"idx": idx, "path": str(p), "name": p.name})
        out = out_dir / f"sheet_{sheet_idx + 1:02d}.jpg"
        sheet.save(out, quality=90)
        sheets.append({"key": out.stem, "screenshot": str(out), "sheet": str(out)})

    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "sheet_index.json").write_text(json.dumps(sheets, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"count": len(manifest), "sheets": len(sheets), "out": str(out_dir)}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

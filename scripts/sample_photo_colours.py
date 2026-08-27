#!/usr/bin/env python3
"""Pick wall/roof RGB from a Wikimedia thumbnail. Prints 'r,g,b r,g,b'."""

from __future__ import annotations

import sys

from PIL import Image


def is_sky(r: int, g: int, b: int) -> bool:
    return b > r + 15 and b > 150 and g > 130


def is_veg(r: int, g: int, b: int) -> bool:
    return g > r + 25 and g > b + 10 and g > 80


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: sample_photo_colours.py <image>", file=sys.stderr)
        sys.exit(2)
    im = Image.open(sys.argv[1]).convert("RGB")
    im.thumbnail((96, 96))
    pixels = list(im.getdata())
    kept = [p for p in pixels if not is_sky(*p) and not is_veg(*p)]
    if len(kept) < 20:
        kept = pixels
    kept.sort(key=lambda p: max(p) - min(p), reverse=True)
    sample = kept[: max(20, len(kept) // 2)]
    wr = sum(p[0] for p in sample) // len(sample)
    wg = sum(p[1] for p in sample) // len(sample)
    wb = sum(p[2] for p in sample) // len(sample)
    # Roof: darker, slightly cooler
    rr = max(20, int(wr * 0.72))
    rg = max(20, int(wg * 0.72))
    rb = max(20, int(wb * 0.78))
    print(f"{wr},{wg},{wb} {rr},{rg},{rb}")


if __name__ == "__main__":
    main()

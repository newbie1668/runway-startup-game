"""Downsample a noticed still to kept RGB cells (skip overcast sky).

Prints JSON: bbox, pixels [x,y,r,g,b], and vertical stripe samples.
Used by bake-poultry-noticed.ts. Not a playtime fetch.
"""

from __future__ import annotations

import json
import sys

from PIL import Image


def is_sky(r: int, g: int, b: int) -> bool:
    mx, mn = max(r, g, b), min(r, g, b)
    if mn > 148 and mx - mn < 22:
        return True
    if mn > 210:
        return True
    return False


def median_rgb(samples: list[tuple[int, int, int]]) -> tuple[int, int, int]:
    if not samples:
        return (224, 144, 154)
    rs, gs, bs = zip(*samples)
    mid = len(samples) // 2
    return (sorted(rs)[mid], sorted(gs)[mid], sorted(bs)[mid])


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: still_pixels.py <image> [max_width]", file=sys.stderr)
        sys.exit(2)
    path = sys.argv[1]
    max_w = int(sys.argv[2]) if len(sys.argv) > 2 else 96
    im = Image.open(path).convert("RGB")
    w0, h0 = im.size
    w = max_w
    h = max(8, round(h0 * w / w0))
    im = im.resize((w, h), Image.Resampling.BOX)
    x_cut = int(w * 0.58)
    pixels: list[list[int]] = []
    for y in range(h):
        for x in range(x_cut):
            r, g, b = im.getpixel((x, y))
            if is_sky(r, g, b):
                continue
            pixels.append([x, y, r, g, b])
    if not pixels:
        raise SystemExit("no building pixels")
    xs = [p[0] for p in pixels]
    ys = [p[1] for p in pixels]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    stripes: list[list[int]] = []
    rows = 32
    for i in range(rows):
        y0 = min_y + int((i / rows) * (max_y - min_y + 1))
        y1 = min_y + int(((i + 1) / rows) * (max_y - min_y + 1))
        band = [
            (p[2], p[3], p[4])
            for p in pixels
            if y0 <= p[1] < y1 and max(p[2], p[3], p[4]) - min(p[2], p[3], p[4]) > 10
        ]
        if not band:
            band = [(p[2], p[3], p[4]) for p in pixels if y0 <= p[1] < y1]
        rgb = median_rgb(band)
        stripes.append([rgb[0], rgb[1], rgb[2]])
    print(
        json.dumps(
            {
                "w": w,
                "h": h,
                "minX": min_x,
                "maxX": max_x,
                "minY": min_y,
                "maxY": max_y,
                "pixels": pixels,
                "stripes": stripes,
            },
            separators=(",", ":"),
        )
    )


if __name__ == "__main__":
    main()

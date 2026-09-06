"""Sample limestone colours from a noticed still. Prints wall,roof RGB 0-255."""

from __future__ import annotations

import sys

from PIL import Image


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: still_rgba.py <image>", file=sys.stderr)
        sys.exit(2)
    im = Image.open(sys.argv[1]).convert("RGB")
    w, h = im.size
    px = list(im.getdata())
    ys0, ys1 = int(h * 0.18), int(h * 0.55)
    xs0, xs1 = int(w * 0.28), int(w * 0.72)
    stone: list[tuple[int, int, int]] = []
    for y in range(ys0, ys1, 3):
        for x in range(xs0, xs1, 3):
            r, g, b = px[y * w + x]
            mx, mn = max(r, g, b), min(r, g, b)
            if mx - mn < 18:
                continue
            if r < 110 or g < 80:
                continue
            stone.append((r, g, b))
    if not stone:
        stone = [(224, 144, 154), (240, 220, 154)]
    stone.sort(key=lambda c: c[0] + c[1] + c[2])
    mid = stone[len(stone) // 2]
    roof = tuple(max(20, int(c * 0.42)) for c in mid)
    print(f"{mid[0]},{mid[1]},{mid[2]} {roof[0]},{roof[1]},{roof[2]}")


if __name__ == "__main__":
    main()

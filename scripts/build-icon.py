#!/usr/bin/env python3
"""Build the AI包工头 app icon set from one vector-like source drawing.

Design: deep-green blueprint background + amber hard hat + terminal prompt
+ cyan AI spark. Run from repo root:

    python3 scripts/build-icon.py
"""
from __future__ import annotations

import math
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src-tauri" / "icons"

S = 2048  # supersampled canvas
F = 1024  # logical size
K = S / F


def sc(x: float) -> int:
    return int(round(x * K))


def box(x0: float, y0: float, x1: float, y1: float) -> list[int]:
    return [sc(x0), sc(y0), sc(x1), sc(y1)]


def rounded(draw: ImageDraw.ImageDraw, b: list[int], r: float, fill) -> None:
    draw.rounded_rectangle(b, radius=sc(r), fill=fill)


def star(draw: ImageDraw.ImageDraw, cx: int, cy: int, R: int, r: int, fill) -> None:
    pts = []
    for i in range(8):
        ang = -math.pi / 2 + i * math.pi / 4
        rad = R if i % 2 == 0 else r
        pts.append((cx + rad * math.cos(ang), cy + rad * math.sin(ang)))
    draw.polygon(pts, fill=fill)


def build_master() -> Image.Image:
    # ---------- background ----------
    bg = Image.new("RGB", (S, S), "#2a4a3a")
    px = bg.load()
    c0, c1 = (29, 56, 44), (61, 95, 75)
    for y in range(S):
        t = y / (S - 1)
        t = t * t * (3 - 2 * t)
        r = int(c0[0] + (c1[0] - c0[0]) * t)
        g = int(c0[1] + (c1[1] - c0[1]) * t)
        b = int(c0[2] + (c1[2] - c0[2]) * t)
        for x in range(S):
            px[x, y] = (r, g, b)

    glow = Image.new("L", (S, S), 0)
    gd = ImageDraw.Draw(glow)
    for i in range(28, 0, -1):
        rr = sc(560) * i / 28
        cx, cy = sc(760), sc(300)
        gd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=int(26 * (1 - i / 28)))
    glow = glow.filter(ImageFilter.GaussianBlur(sc(60)))
    bg = Image.composite(
        Image.new("RGB", (S, S), (120, 190, 160)),
        bg,
        glow.point(lambda v: int(v * 0.9)),
    )

    grid = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gdr = ImageDraw.Draw(grid)
    for i in range(-4, 14):
        x = i * sc(160)
        gdr.line([(x, 0), (x + S, S)], fill=(255, 255, 255, 7), width=sc(2))
    for i in range(-4, 14):
        y = i * sc(160)
        gdr.line([(0, y), (S, y)], fill=(255, 255, 255, 5), width=sc(2))
    bg = Image.alpha_composite(bg.convert("RGBA"), grid)

    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=sc(220), fill=255)
    bg.putalpha(mask)
    img = bg

    # ---------- soft shadow ----------
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse(box(170, 660, 854, 790), fill=(0, 0, 0, 95))
    img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(sc(26))))
    d = ImageDraw.Draw(img)

    amber = (246, 183, 60, 255)
    amber_dark = (214, 135, 38, 255)
    amber_light = (255, 214, 122, 255)

    # ---------- hard hat ----------
    d.pieslice(box(150, 250, 874, 820), 180, 360, fill=amber)
    d.rectangle(box(150, 482, 874, 548), fill=amber_dark)
    d.pieslice(box(150, 250, 874, 820), 180, 212, fill=amber_light)
    d.pieslice(box(150, 250, 874, 820), 328, 360, fill=amber_dark)

    rounded(d, box(270, 290, 314, 505), 18, amber_light)
    rounded(d, box(710, 290, 754, 505), 18, amber_light)
    rounded(d, box(490, 275, 534, 470), 16, (255, 228, 160, 180))

    rounded(d, box(96, 508, 928, 642), 66, amber)
    rounded(d, box(114, 512, 910, 552), 28, amber_light)
    rounded(d, box(114, 602, 910, 642), 28, amber_dark)

    # ---------- terminal prompt on the hat ----------
    green = (28, 58, 44, 255)
    d.line(
        [(sc(402), sc(382)), (sc(468), sc(445)), (sc(402), sc(508))],
        fill=green,
        width=sc(30),
        joint="curve",
    )
    rounded(d, box(502, 488, 600, 520), 14, green)

    # ---------- AI spark ----------
    cx, cy = sc(804), sc(276)
    gs = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gsd = ImageDraw.Draw(gs)
    for r in range(sc(85), 0, -sc(5)):
        a = int(16 * (1 - r / sc(85)))
        gsd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(52, 221, 215, a))
    img = Image.alpha_composite(img, gs.filter(ImageFilter.GaussianBlur(sc(10))))
    d = ImageDraw.Draw(img)

    cyan = (52, 221, 215, 255)
    star(d, cx, cy, sc(50), sc(15), cyan)
    star(d, cx, cy, sc(26), sc(8), (235, 255, 253, 255))
    star(d, sc(716), sc(194), sc(24), sc(7), cyan)

    # ---------- highlight ----------
    accent = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(accent).arc(
        box(120, 120, 900, 900), 200, 250, fill=(255, 255, 255, 22), width=sc(8)
    )
    img = Image.alpha_composite(img, accent.filter(ImageFilter.GaussianBlur(sc(3))))

    return img.resize((F, F), Image.LANCZOS)


def main() -> None:
    master = build_master()
    OUT.mkdir(parents=True, exist_ok=True)

    master.save(OUT / "icon.png")

    sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square107x107Logo.png": 107,
        "Square142x142Logo.png": 142,
        "Square150x150Logo.png": 150,
        "Square284x284Logo.png": 284,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }
    for name, size in sizes.items():
        master.resize((size, size), Image.LANCZOS).save(OUT / name)

    # Windows ICO (multi-resolution)
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    master.save(OUT / "icon.ico", sizes=[(s, s) for s in ico_sizes])

    # macOS ICNS
    iconset = OUT / "icon.iconset"
    if iconset.exists():
        try:
            shutil.rmtree(iconset)
        except OSError as exc:
            raise RuntimeError(f"cannot remove stale iconset {iconset}: {exc}") from exc
    iconset.mkdir()
    for size in [16, 32, 128, 256, 512]:
        master.resize((size, size), Image.LANCZOS).save(iconset / f"icon_{size}x{size}.png")
        master.resize((size * 2, size * 2), Image.LANCZOS).save(
            iconset / f"icon_{size}x{size}@2x.png"
        )
    try:
        subprocess.run(
            ["iconutil", "-c", "icns", str(iconset), "-o", str(OUT / "icon.icns")],
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimeError("iconutil failed to build icon.icns") from exc
    finally:
        try:
            shutil.rmtree(iconset)
        except OSError as exc:
            # Best-effort cleanup; the icon has already been written.
            print(f"warning: could not remove {iconset}: {exc}", file=sys.stderr)
    print(f"wrote icons to {OUT}")


if __name__ == "__main__":
    main()
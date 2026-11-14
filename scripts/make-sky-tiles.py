#!/usr/bin/env python3
"""Cut NASA's Deep Star Maps 2020 (equirectangular OpenEXR) into a pyramid of 512x512 WebP (or JPEG) tiles for the Sky view.

    python scripts/make-sky-tiles.py starmap_2020_64k.exr app/assets/skytiles

Level l is the whole map at 1024 * 2^l px wide: 2^(l+1) columns x 2^l rows of tiles (see app/js/sky/tilemath.js). A 64k
map gives levels 3..6 (level 6 = 65,536 px wide). Tiles are written to <out>/<level>/<col>_<row>.webp plus <out>/manifest.json.
WebP (quality 70) is both smaller and closer to the source than JPEG (quality 80): about 55 KB vs 85 KB per dense tile,
34.8 vs 32.1 dB PSNR, so the whole pyramid is roughly 500 MB instead of 780 MB (GitHub Pages sites are limited to 1 GB).

The EXR is read one tile-row strip (512 scanlines) at a time, so memory stays under ~0.6 GB for the 64k file. Coarser
levels are made by averaging 2x2 in *linear* light, then every level is converted linear -> sRGB (the same conversion
as app/assets/README.md) and clipped to 0..1.

Needs: pip install OpenEXR Imath numpy pillow
Source: NASA SVS 4851, https://svs.gsfc.nasa.gov/4851/  (NASA/GSFC Scientific Visualization Studio; Gaia DR2: ESA/Gaia/DPAC)
"""
import argparse
import gc
import json
import os
import sys
import time

import Imath
import numpy as np
import OpenEXR
from PIL import Image

TILE = 512


# The 64k map is exposed ~16x darker per pixel than the 4k map the app has always used (same sky, but each pixel holds less
# light), and the 4k map has a small dark-sky floor. Measured by averaging the 64k map down to 4096 x 2048 and fitting it to
# app/assets/sky_4k.jpg: linear 4k ~= sqrt((GAIN * x)^2 + FLOOR^2) (mean brightness within 0.2 / 255, large-scale glow within
# ~1.7 / 255). Using the same exposure keeps the zoomed-in sky the same sky as the zoomed-out one.
GAIN = 15.75
FLOOR = np.array([0.00243, 0.00212, 0.00212], dtype=np.float32)  # R, G, B


def srgb8(lin, gain=None, floor=None):
    """float32 linear (64k exposure) -> uint8 sRGB at the 4k map's exposure."""
    gain = GAIN if gain is None else gain
    floor = FLOOR if floor is None else floor
    c = np.clip(np.sqrt((gain * lin) ** 2 + floor ** 2), 0.0, 1.0)
    s = np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(c, 1 / 2.4) - 0.055)
    return np.rint(s * 255.0).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("exr")
    ap.add_argument("out")
    ap.add_argument("--min-level", type=int, default=3, help="coarsest level to write (default 3 = 8192 px wide)")
    ap.add_argument("--format", choices=["webp", "jpg"], default="webp")
    ap.add_argument("--quality", type=int, default=70)
    ap.add_argument("--subsampling", type=int, default=0, help="PIL JPEG subsampling: 0 = 4:4:4, 2 = 4:2:0")
    ap.add_argument("--gain", type=float, default=GAIN, help="exposure multiplier (default %(default)s; see GAIN)")
    ap.add_argument("--resume", action="store_true", help="skip tiles that already exist (a run that stopped part-way can be continued)")
    ap.add_argument("--rows", default="", help="debug: only these level-max tile rows, e.g. 40:44 (coarser levels are then partial)")
    a = ap.parse_args()

    f = OpenEXR.InputFile(a.exr)
    dw = f.header()["dataWindow"]
    W, H = dw.max.x - dw.min.x + 1, dw.max.y - dw.min.y + 1
    max_level = int(round(np.log2(W / 1024)))
    assert W == 1024 * 2 ** max_level and H == W // 2, f"unexpected size {W}x{H}"
    print(f"{W}x{H}: levels {a.min_level}..{max_level}", flush=True)
    r0, r1 = (0, H // TILE) if not a.rows else map(int, a.rows.split(":"))
    half = Imath.PixelType(Imath.PixelType.HALF)
    sizes = {l: [0, 0] for l in range(a.min_level, max_level + 1)}  # bytes, count
    pending = {l: [] for l in range(a.min_level, max_level)}

    def write_level_row(level, row, lin):
        os.makedirs(os.path.join(a.out, str(level)), exist_ok=True)
        for col in range(lin.shape[1] // TILE):
            p = os.path.join(a.out, str(level), f"{col}_{row}.{a.format}")
            if a.resume and os.path.exists(p):
                sizes[level][0] += os.path.getsize(p); sizes[level][1] += 1
                continue
            im = Image.fromarray(srgb8(lin[:, col * TILE:(col + 1) * TILE].astype(np.float32), a.gain))  # one tile at a time: keeps peak memory low
            if a.format == "webp":
                im.save(p, "WEBP", quality=a.quality, method=4)
            else:
                im.save(p, "JPEG", quality=a.quality, subsampling=a.subsampling, optimize=True)
            sizes[level][0] += os.path.getsize(p); sizes[level][1] += 1

    def emit(level, row, lin):
        if level >= a.min_level:
            write_level_row(level, row, lin)
        if level > a.min_level:
            h, w, _ = lin.shape
            down = np.empty((h // 2, w // 2, 3), dtype=np.float16)   # half precision keeps memory low (values are 0..1)
            for c0 in range(0, w, 8192):                              # in column chunks: no full-size float32 temporaries
                blk = lin[:, c0:c0 + 8192].astype(np.float32)
                down[:, c0 // 2:(c0 + 8192) // 2] = blk.reshape(h // 2, 2, blk.shape[1] // 2, 2, 3).mean(axis=(1, 3))
            pend = pending[level - 1]
            pend.append(down)
            if len(pend) == 2:
                merged = np.concatenate(pend, axis=0); pend.clear()
                emit(level - 1, row // 2, merged)

    def read_strip(row):
        """One tile-row strip as float16 (512, W, 3); retried a few times, so a short memory shortage does not end a long run."""
        for attempt in range(8):
            try:
                lin = np.empty((TILE, W, 3), dtype=np.float16)
                for k in range(0, TILE, 128):          # 128 scanlines at a time: ~50 MB of raw data instead of ~200 MB
                    y = row * TILE + k
                    ch = f.channels(["R", "G", "B"], half, y, y + 127)
                    for i, c in enumerate(ch):
                        lin[k:k + 128, :, i] = np.frombuffer(c, dtype=np.float16).reshape(128, W)
                    del ch
                return lin
            except MemoryError:
                print(f"row {row + 1}: out of memory, retrying ({attempt + 1}/8)", flush=True)
                gc.collect(); time.sleep(10)
        raise MemoryError("not enough free memory; close other programs and rerun with --resume")

    t0 = time.time()
    for row in range(r0, r1):
        emit(max_level, row, read_strip(row))
        done = row - r0 + 1
        print(f"row {row + 1}/{r1}  {time.time() - t0:5.0f}s", flush=True) if done % 4 == 0 or done == r1 - r0 else None
    # a partial --rows run leaves unmatched half-rows pending; that is expected
    total = sum(b for b, _ in sizes.values())
    for l, (b, n) in sizes.items():
        print(f"level {l}: {n:5d} tiles  {b / 1e6:8.1f} MB  avg {b / max(1, n) / 1e3:6.1f} KB")
    print(f"total {total / 1e6:.1f} MB")
    if not a.rows:
        with open(os.path.join(a.out, "manifest.json"), "w") as m:
            json.dump({"tileSize": TILE, "minLevel": a.min_level, "maxLevel": max_level, "ext": a.format, "width": W, "height": H,
                       "source": "NASA SVS 4851, Deep Star Maps 2020 (starmap_2020_%dk.exr)" % (W // 1024),
                       "gain": a.gain, "credit": "NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC."}, m, indent=1)


if __name__ == "__main__":
    sys.exit(main())

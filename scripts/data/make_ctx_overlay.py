"""Робить з CTX-мозаїки (GeoTIFF, 6 м/піксель) легку картинку-шар для карти місії.

Запуск з кореня репозиторію (zip можна не розпаковувати):
  python3 scripts/data/make_ctx_overlay.py \
    public/data/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.zip \
    public/data/jezero/ctx_mosaic.jpg --width 2048

Потрібно: numpy, tifffile, pillow
Результат: JPEG і рядок bbox для sites.js (виводиться в термінал).
Проєкція вихідного файлу рівнокутна (стандартна паралель 0), тож ширина і довгота
лінійно залежать від пікселя, а bbox береться з прив'язки файлу (краї пікселів).
"""
import argparse
import io
import math
import tempfile
import warnings
import zipfile
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src", help=".tif або .zip з одним .tif")
    ap.add_argument("out", help="куди зберегти .jpg")
    ap.add_argument("--width", type=int, default=2048, help="ширина картинки, px")
    ap.add_argument("--quality", type=int, default=82)
    a = ap.parse_args()

    tmp = None
    src = Path(a.src)
    if src.suffix.lower() == ".zip":
        tmp = tempfile.TemporaryDirectory()
        with zipfile.ZipFile(src) as z:
            name = next(n for n in z.namelist() if n.lower().endswith((".tif", ".tiff")))
            z.extract(name, tmp.name)
        src = Path(tmp.name) / name

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with tifffile.TiffFile(src) as t:
            img = t.pages[0].asarray()
            meta = t.geotiff_metadata
    sx, sy, _ = meta["ModelPixelScale"]
    x0, y0 = meta["ModelTiepoint"][3], meta["ModelTiepoint"][4]
    R = meta["GeogSemiMajorAxisGeoKey"]
    rows, cols = img.shape[:2]

    lat_max = math.degrees(y0 / R)
    lat_min = math.degrees((y0 - rows * sy) / R)
    lon_min = math.degrees(x0 / R)
    lon_max = math.degrees((x0 + cols * sx) / R)

    # Лінійне розтягування контрасту (1–99 перцентиль), щоб знімок читався краще
    lo, hi = np.percentile(img, [1, 99])
    img8 = np.clip((img.astype("float32") - lo) / (hi - lo), 0, 1) * 255
    im = Image.fromarray(img8.astype("uint8"))
    h = round(a.width * rows / cols)
    im = im.resize((a.width, h), Image.LANCZOS)

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, quality=a.quality, optimize=True)
    print(f"{out}: {a.width}x{h}px, {out.stat().st_size / 1e6:.2f} МБ")
    print(f"bbox: [{lat_min:.6f}, {lon_min:.6f}, {lat_max:.6f}, {lon_max:.6f}]")
    if tmp:
        tmp.cleanup()


if __name__ == "__main__":
    main()

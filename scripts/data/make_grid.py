"""Готує сітку ухилів для бекенду з DEM GeoTIFF (CTX, рівнокутна проєкція Марса).

Запуск з кореня репозиторію:
  python3 scripts/data/make_grid.py <dem.tif> public/data/jezero/grid --factor 4

Потрібно: numpy, tifffile  (pip install tifffile)
Результат: grid.json, slope.npy, dem.npy у вихідній папці.
"""
import argparse
import json
import math
import warnings
from pathlib import Path

import numpy as np
import tifffile

NODATA_LIMIT = -1e30   # GDAL nodata для float32 = -3.4e38


def read_dem(path):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with tifffile.TiffFile(path) as t:
            dem = t.pages[0].asarray().astype("float64")
            meta = t.geotiff_metadata
    if meta.get("ProjStdParallel1GeoKey", 0) != 0:
        raise SystemExit("Очікується рівнокутна проєкція зі стандартною паралеллю 0")
    sx, sy, _ = meta["ModelPixelScale"]
    x0, y0 = meta["ModelTiepoint"][3], meta["ModelTiepoint"][4]   # верхній лівий кут, м
    radius = meta["GeogSemiMajorAxisGeoKey"]                       # радіус сфери, м
    return dem, sx, sy, x0, y0, radius


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dem")
    ap.add_argument("out")
    ap.add_argument("--factor", type=int, default=4, help="у скільки разів укрупнити клітинки")
    a = ap.parse_args()

    dem, sx, sy, x0, y0, R = read_dem(a.dem)
    bad = ~np.isfinite(dem) | (dem < NODATA_LIMIT)
    dem[bad] = np.nan
    rows, cols = dem.shape

    # Метри на піксель зі сходу на захід зменшуються з широтою (cos lat)
    lat_rows = np.degrees((y0 - (np.arange(rows) + 0.5) * sy) / R)
    dx = sx * np.cos(np.radians(lat_rows))[:, None]
    dz_dr = np.gradient(dem, sy, axis=0)
    dz_dc = np.gradient(dem, axis=1) / dx
    slope = np.degrees(np.arctan(np.hypot(dz_dr, dz_dc)))
    slope[~np.isfinite(slope)] = 90.0      # немає даних = непрохідно

    f = a.factor
    rc, cc = rows // f * f, cols // f * f
    blocks = lambda arr: arr[:rc, :cc].reshape(rc // f, f, cc // f, f)
    slope_c = blocks(slope).max(axis=(1, 3))                  # найкрутіше в клітинці (обережно)
    dem_c = np.nanmean(blocks(dem), axis=(1, 3))

    # bbox по центрах крайніх клітинок: так рахує to_rowcol у бекенді
    lat_max = math.degrees((y0 - f * sy / 2) / R)
    lat_min = math.degrees((y0 - (rc - f / 2) * sy) / R)
    lon_min = math.degrees((x0 + f * sx / 2) / R)
    lon_max = math.degrees((x0 + (cc - f / 2) * sx) / R)
    lat_c = (lat_min + lat_max) / 2
    cell_m = f * (sy + sx * math.cos(math.radians(lat_c))) / 2

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    np.save(out / "slope.npy", slope_c.astype("float32"))
    np.save(out / "dem.npy", dem_c.astype("float32"))
    meta = {
        "cell_m": round(cell_m, 2),
        "bbox": [round(lat_min, 6), round(lon_min, 6), round(lat_max, 6), round(lon_max, 6)],
        "rows": int(slope_c.shape[0]), "cols": int(slope_c.shape[1]),
        "factor": f, "source": Path(a.dem).name,
    }
    (out / "grid.json").write_text(json.dumps(meta, indent=2))
    print(meta)
    print("ухил, градуси: p50=%.1f p90=%.1f p99=%.1f; клітинок > 25° : %.1f%%" % (
        *np.percentile(slope_c, [50, 90, 99]), (slope_c > 25).mean() * 100))


if __name__ == "__main__":
    main()

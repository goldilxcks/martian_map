"""
Готує текстури для глобуса з глобальних даних USGS.

На вході:
  --dem    глобальна карта висот Марса (GeoTIFF, значення в метрах),
           наприклад MOLA DEM. Обов'язково.
  --color  (необов'язково) глобальна кольорова мозаїка (JPG/PNG/TIFF).
           Якщо не вказати, кольорову текстуру буде згенеровано з висот
           (кольори за висотою + тіні рельєфу).

На виході в app/textures/:
  mars_height.png  — висоти, 8 біт (0 = мінімум, 255 = максимум)
  mars_color.jpg   — кольорова текстура
  meta.json        — мінімум і максимум у метрах (глобус бере звідси масштаб)

Обидві карти мають бути еквідистантні (equirectangular, «простий циліндр»),
лівий край = -180°. Якщо у файлі довгота 0..360, додай --lon0-360.

Залежності: numpy, Pillow (pip install numpy pillow).
Якщо встановлено rasterio, великі GeoTIFF читаються значно швидше
і без завантаження всього файлу в пам'ять.

Приклад (з кореня репозиторію):
  python scripts/data/prepare_textures.py --dem data/raw/megt.img
  python scripts/data/prepare_textures.py --dem data/raw/mola_dem.tif
"""

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # глобальні мозаїки дуже великі


# ---------------------------------------------------------------------------
# Читання висот
# ---------------------------------------------------------------------------
def read_megdr_img(path: Path) -> np.ndarray:
    """MOLA MEGDR з NASA PDS (*.img): 16-біт big-endian, рядки з 90°N, довгота 0..360°E.
    Розмір визначається з розміру файлу (ширина = 2 × висота)."""
    raw = np.fromfile(path, dtype=">i2")
    h = int(round((raw.size / 2) ** 0.5))
    if h * 2 * h != raw.size:
        raise SystemExit(f"Не схоже на глобальний MEGDR: {raw.size} значень")
    arr = raw.reshape(h, 2 * h)
    # 0..360 -> -180..180 (лівий край текстури має бути на -180°)
    return np.roll(arr, h, axis=1)


def read_dem(path: Path, out_w: int, out_h: int) -> np.ndarray:
    if path.suffix.lower() == ".img":
        print("Формат MEGDR (.img) з NASA PDS")
        return block_mean(read_megdr_img(path), out_w, out_h)
    try:
        import rasterio
        from rasterio.enums import Resampling

        with rasterio.open(path) as src:
            arr = src.read(
                1,
                out_shape=(out_h, out_w),
                resampling=Resampling.average,
                masked=True,
            )
            return arr.astype(np.float32).filled(np.nan)
    except ImportError:
        pass

    print("rasterio не знайдено, читаю через Pillow (може бути повільно і потребувати багато RAM)")
    img = Image.open(path)
    try:
        arr = np.asarray(img)
    except Exception:
        arr = np.asarray(img.convert("I"))
    if arr.ndim == 3:
        arr = arr[..., 0]
    # Масив лишається цілочисельним, у float переводяться лише шматки в block_mean,
    # тому 2-гігабайтний DEM не роздувається до 4+ ГБ у пам'яті.
    return block_mean(arr, out_w, out_h)


def block_mean(arr: np.ndarray, out_w: int, out_h: int) -> np.ndarray:
    """Зменшує масив усередненням блоків (ігнорує NaN)."""
    h, w = arr.shape
    # 1) цілочисельне зменшення блоками f×f (відкидається < f пікселів з краю)
    f = max(1, min(h // out_h, w // out_w))
    if f > 1:
        bh, bw = h // f, w // f
        arr = arr[: bh * f, : bw * f]
        small = np.empty((bh, bw), dtype=np.float32)
        rows_per_chunk = max(1, 512 // f)
        for r0 in range(0, bh, rows_per_chunk):
            r1 = min(bh, r0 + rows_per_chunk)
            chunk = arr[r0 * f : r1 * f].astype(np.float32)
            chunk[chunk < -30000] = np.nan  # типові значення "немає даних"
            small[r0:r1] = np.nanmean(chunk.reshape(r1 - r0, f, bw, f), axis=(1, 3))
        arr = small
    else:
        arr = arr.astype(np.float32)
        arr[arr < -30000] = np.nan
    # 2) точне доведення до потрібного розміру
    arr = fill_nan(arr)
    if arr.shape != (out_h, out_w):
        arr = np.asarray(Image.fromarray(arr, mode="F").resize((out_w, out_h), Image.BILINEAR))
    return arr


def fill_nan(arr: np.ndarray) -> np.ndarray:
    if np.isnan(arr).any():
        arr = np.where(np.isnan(arr), np.nanmedian(arr), arr)
    return arr


# ---------------------------------------------------------------------------
# Кольорова текстура з висот (якщо немає окремої мозаїки)
# ---------------------------------------------------------------------------
PALETTE = np.array(
    [  # позиція (0..1 висоти), R, G, B
        [0.00, 52, 24, 18],
        [0.20, 105, 48, 30],
        [0.35, 160, 82, 48],
        [0.50, 196, 118, 72],
        [0.70, 214, 156, 110],
        [0.85, 228, 196, 160],
        [1.00, 245, 235, 220],
    ],
    dtype=np.float32,
)


def color_from_dem(h01: np.ndarray, elev_m: np.ndarray) -> np.ndarray:
    rgb = np.stack(
        [np.interp(h01, PALETTE[:, 0], PALETTE[:, i]) for i in (1, 2, 3)], axis=-1
    )
    # Тіні рельєфу (hillshade): сонце з північного заходу, 35° над горизонтом.
    rows, cols = elev_m.shape
    cell = 2 * np.pi * 3389500 / cols  # метрів на піксель по екватору
    gy, gx = np.gradient(elev_m, cell)
    gx = gx / np.clip(np.cos(np.radians(np.linspace(89.9, -89.9, rows)))[:, None], 0.05, 1)
    slope = np.arctan(np.hypot(gx, gy) * 8)  # *8 = посилення для глобального масштабу
    aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(315), np.radians(35)
    shade = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    shade = np.clip(shade, 0, 1)
    rgb *= (0.55 + 0.6 * shade)[..., None]
    return np.clip(rgb, 0, 255).astype(np.uint8)


def read_color(path: Path, out_w: int, out_h: int) -> Image.Image:
    img = Image.open(path)
    img.draft("RGB", (out_w, out_h))  # прискорює великі JPEG
    return img.convert("RGB").resize((out_w, out_h), Image.LANCZOS)


# ---------------------------------------------------------------------------
def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dem", required=True, type=Path)
    p.add_argument("--color", type=Path)
    p.add_argument("--size", type=int, default=4096, help="ширина текстур (висота = ширина / 2)")
    p.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[2] / "app" / "textures",
                   help="куди покласти текстури (за замовчуванням app/textures)")
    p.add_argument("--lon0-360", action="store_true", help="у файлах довгота 0..360 замість -180..180")
    args = p.parse_args()

    out_w, out_h = args.size, args.size // 2
    args.out.mkdir(parents=True, exist_ok=True)

    print(f"Читаю висоти: {args.dem}")
    elev = fill_nan(read_dem(args.dem, out_w, out_h))
    if args.lon0_360:
        elev = np.roll(elev, out_w // 2, axis=1)

    lo, hi = np.percentile(elev, [0.01, 99.99])
    h01 = np.clip((elev - lo) / (hi - lo), 0, 1)
    Image.fromarray((h01 * 255).round().astype(np.uint8), mode="L").save(args.out / "mars_height.png")
    print(f"  висоти від {lo:.0f} до {hi:.0f} м")

    usgs_color = args.out / "mars_color_usgs.jpg"  # з fetch_color_tiles.py
    if not args.color and usgs_color.exists():
        args.color = usgs_color
    if args.color:
        print(f"Читаю кольорову мозаїку: {args.color}")
        with Image.open(args.color) as probe:
            cw = min(probe.width, 8192)  # кольору можна дати більшу роздільність, ніж висотам
        color = read_color(args.color, cw, cw // 2)
        # тайли USGS уже від -180°, тож зсуваємо лише власну мозаїку користувача
        if args.lon0_360 and args.color != usgs_color:
            color = Image.fromarray(np.roll(np.asarray(color), color.width // 2, axis=1))
    else:
        print("Кольорової мозаїки немає — генерую кольори з висот")
        color = Image.fromarray(color_from_dem(h01, elev))
    color.save(args.out / "mars_color.jpg", quality=90)

    meta = {
        "min_m": float(lo),
        "max_m": float(hi),
        "width": out_w,
        "height": out_h,
        "dem_source": args.dem.name,
        "color_source": args.color.name if args.color else "generated from DEM",
    }
    (args.out / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Готово: {args.out}")


if __name__ == "__main__":
    main()

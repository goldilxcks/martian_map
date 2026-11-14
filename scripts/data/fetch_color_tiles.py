"""
Збирає глобальну кольорову текстуру Марса з тайлів базового шару карти
USGS Interactive Maps: Mars (https://astrogeology-usgs.hub.arcgis.com/pages/interactive-maps-mars).

Базовий шар цієї карти — "Mars_MGS_MOLA_ClrShade_merge_global_463m"
(кольоровий рельєф MOLA), який віддається тайлами 256×256 з NASA Trek.
Скрипт качає тайли одного рівня і склеює їх в одну еквідистантну картинку.

  рівень 3 -> 4096×2048   (128 тайлів)
  рівень 4 -> 8192×4096   (512 тайлів)   <- за замовчуванням
  рівень 5 -> 16384×8192  (2048 тайлів, завелике для більшості відеокарт)

Тайли кешуються в data/raw/tiles_cache/, тож перерваний запуск продовжиться з місця зупинки.

Результат: app/textures/mars_color_usgs.jpg
(prepare_textures.py підхопить його автоматично замість згенерованих кольорів).

Залежності: Pillow.  Запуск з кореня репозиторію:
  python scripts/data/fetch_color_tiles.py
"""

import argparse
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image

LAYER = "Mars_MGS_MOLA_ClrShade_merge_global_463m"
TEMPLATE = (
    "https://trek.nasa.gov/tiles/Mars/EQ/" + LAYER +
    "/1.0.0//default/default028mm/{level}/{row}/{col}.jpg"
)
TILE = 256
REPO = Path(__file__).resolve().parents[2]  # scripts/data/ -> корінь репозиторію


def grid(level: int) -> tuple[int, int]:
    """(стовпці, рядки) тайлів на рівні: рівень 0 = 2×1, далі ×2."""
    return 2 ** (level + 1), 2 ** level


def fetch(url: str, dest: Path, retries: int = 4) -> None:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "marswalk-hackathon/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            tmp = dest.with_suffix(".part")
            tmp.write_bytes(data)
            tmp.replace(dest)
            return
        except Exception as e:  # мережеві збої — пробуємо ще
            if attempt == retries - 1:
                raise RuntimeError(f"{url}: {e}") from e
            time.sleep(2 * (attempt + 1))


def download_tiles(level: int, cache: Path, workers: int) -> None:
    cols, rows = grid(level)
    jobs = []
    for row in range(rows):
        for col in range(cols):
            dest = cache / f"{row}_{col}.jpg"
            if not dest.exists():
                jobs.append((TEMPLATE.format(level=level, row=row, col=col), dest))

    total = cols * rows
    print(f"Рівень {level}: {cols}×{rows} = {total} тайлів, треба докачати {len(jobs)}")
    done, failed = total - len(jobs), []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(fetch, url, dest): url for url, dest in jobs}
        for fut in as_completed(futures):
            try:
                fut.result()
                done += 1
            except Exception as e:
                failed.append(str(e))
            print(f"\r  {done}/{total}", end="", flush=True)
    print()
    if failed:
        print(f"Не вдалося завантажити {len(failed)} тайлів, наприклад:\n  {failed[0]}")
        print("Просто запусти скрипт ще раз — він докачає лише відсутні.")
        sys.exit(1)


def stitch(level: int, cache: Path, out: Path) -> None:
    cols, rows = grid(level)
    img = Image.new("RGB", (cols * TILE, rows * TILE))
    for row in range(rows):
        for col in range(cols):
            tile = Image.open(cache / f"{row}_{col}.jpg").convert("RGB")
            img.paste(tile, (col * TILE, row * TILE))
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, quality=92)
    print(f"Готово: {out}  ({img.width}×{img.height})")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--level", type=int, default=4, help="рівень деталізації (3, 4 або 5)")
    p.add_argument("--workers", type=int, default=8, help="скільки тайлів качати одночасно")
    p.add_argument("--out", type=Path, default=REPO / "app" / "textures", help="куди покласти текстуру")
    p.add_argument("--cache", type=Path, default=REPO / "data" / "raw" / "tiles_cache", help="кеш тайлів")
    args = p.parse_args()

    cache = args.cache / str(args.level)
    cache.mkdir(parents=True, exist_ok=True)
    download_tiles(args.level, cache, args.workers)
    stitch(args.level, cache, args.out / "mars_color_usgs.jpg")
    print("Тепер запусти prepare_textures.py — він візьме цю текстуру.")


if __name__ == "__main__":
    main()

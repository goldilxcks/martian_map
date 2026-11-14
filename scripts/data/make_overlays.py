"""Робить з сітки ухилів картинку-шар для карти місії: де круто, куди йти не можна.

Запуск з кореня репозиторію:
  python3 scripts/data/make_overlays.py public/data/jezero/grid public/data/jezero

Потрібно: numpy, pillow  (pip install pillow)
Результат: slope.png і фрагмент для sites.js (виводиться в термінал).
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

MAX_SLOPE = 25      # має збігатися з backend/planner.py
SAFETY_CELLS = 2    # те саме, що SAFETY_CELLS у backend/planner.py


def dilate(mask, n):
    out = mask.copy()
    for _ in range(n):
        out = (out | np.roll(out, 1, 0) | np.roll(out, -1, 0)
                   | np.roll(out, 1, 1) | np.roll(out, -1, 1))
    return out


def main():
    grid_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    meta = json.loads((grid_dir / "grid.json").read_text())
    slope = np.load(grid_dir / "slope.npy")
    rows, cols = slope.shape
    lat_min, lon_min, lat_max, lon_max = meta["bbox"]

    blocked = dilate(slope > MAX_SLOPE, SAFETY_CELLS)       # саме те, що бекенд вважає непрохідним
    rgba = np.zeros((rows, cols, 4), dtype=np.uint8)
    rgba[(slope >= 10) & (slope < 18)] = (255, 220, 60, 110)    # помірно круто
    rgba[(slope >= 18) & (slope <= MAX_SLOPE)] = (255, 140, 40, 150)  # круто
    rgba[blocked] = (230, 40, 40, 190)                           # заборонено для маршруту

    out_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(out_dir / "slope.png")

    # bbox у grid.json по центрах крайніх клітинок, а картинці потрібні краї
    dlat = (lat_max - lat_min) / (rows - 1) / 2
    dlon = (lon_max - lon_min) / (cols - 1) / 2
    bbox = [round(lat_min - dlat, 6), round(lon_min - dlon, 6),
            round(lat_max + dlat, 6), round(lon_max + dlon, 6)]
    print("Збережено", out_dir / "slope.png")
    print("Частка заборонених клітинок: %.1f%%" % (blocked.mean() * 100))
    print("\nДодай у layers у app/sites.js (ділянка jezero):\n")
    print(f"""      {{
        id: 'slope', name: 'Ухили (заборонені зони)', type: 'image', group: 'safety',
        url: '../public/data/jezero/slope.png',
        bbox: {bbox}, opacity: 0.75,
        legend: [['#ffdc3c', '10–18°'], ['#ff8c28', '18–25°'], ['#e62828', 'заборонено для маршруту']],
      }},""")


if __name__ == "__main__":
    main()

"""Робить з моделі висот шар «відносна радіація» для маршрутизатора.

Принцип (NASA/JPL, карта Estimated Radiation Dosage on Mars): чим нижче місце, тим більше
атмосфери над ним і тим менше космічної радіації доходить до поверхні.
Тому радіаційний індекс = нормована висота: 0 = найнижча точка ділянки, 1 = найвища.
Це ВІДНОСНИЙ індекс усередині ділянки, а не доза в мЗв.

Запуск з кореня репозиторію:
  python3 scripts/data/make_radiation.py public/data/jezero/grid

Потрібно: numpy. Створює radiation.npy поруч із dem.npy; бекенд підхоплює його сам
(штраф до вартості клітинки: cost + radiation * 3).
"""
import sys
from pathlib import Path

import numpy as np

grid_dir = Path(sys.argv[1])
dem = np.load(grid_dir / "dem.npy").astype("float64")
lo, hi = np.nanmin(dem), np.nanmax(dem)
radiation = ((dem - lo) / (hi - lo)).astype("float32")
np.save(grid_dir / "radiation.npy", radiation)
print(f"Збережено radiation.npy: висоти {lo:.0f}..{hi:.0f} м -> індекс 0..1 ({radiation.shape})")

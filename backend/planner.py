# import heapq
# import json
# import math
# import os
# from pathlib import Path

# import numpy as np

# ROOT = Path(__file__).resolve().parent.parent
# GRID_DIR = Path(os.environ.get("GRID_DIR", ROOT / "public" / "data" / "grid"))

# MAX_SLOPE = 25           # градуси: вище вважаємо непрохідним
# SPEED_KMH = 2.5          # швидкість у скафандрі
# MAX_EVA_H = 6            # ліміт одного виходу, години
# SAFETY_CELLS = 2         # запас безпеки навколо небезпек
# RAD_MSV_PER_DAY = 0.64   # TODO: перевірити за даними Curiosity RAD


# def slope_from_dem(dem, cell_m):
#     dz_dr, dz_dc = np.gradient(dem, cell_m)
#     return np.degrees(np.arctan(np.hypot(dz_dr, dz_dc)))


# def dilate(mask, n):
#     out = mask.copy()
#     for _ in range(n):
#         out = (out | np.roll(out, 1, 0) | np.roll(out, -1, 0)
#                    | np.roll(out, 1, 1) | np.roll(out, -1, 1))
#     return out


# def fake_slope(n, seed=1):
#     rng = np.random.default_rng(seed)
#     a = rng.random((n, n))
#     for _ in range(25):
#         a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0)
#                + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 5
#     a = (a - a.min()) / (a.max() - a.min())
#     return a * 35


# def astar(cost, start, goal):
#     rows, cols = cost.shape
#     h = lambda p: math.hypot(p[0] - goal[0], p[1] - goal[1])
#     pq = [(h(start), 0.0, start)]
#     g, prev = {start: 0.0}, {}
#     moves = [(-1, 0), (1, 0), (0, -1), (0, 1),
#              (-1, -1), (-1, 1), (1, -1), (1, 1)]
#     while pq:
#         _, gc, cur = heapq.heappop(pq)
#         if cur == goal:
#             path = [cur]
#             while cur in prev:
#                 cur = prev[cur]
#                 path.append(cur)
#             return path[::-1]
#         if gc > g[cur]:
#             continue
#         for dr, dc in moves:
#             nxt = (cur[0] + dr, cur[1] + dc)
#             if not (0 <= nxt[0] < rows and 0 <= nxt[1] < cols):
#                 continue
#             if not np.isfinite(cost[nxt]):
#                 continue
#             step = math.hypot(dr, dc) * (cost[cur] + cost[nxt]) / 2
#             ng = gc + step
#             if ng < g.get(nxt, math.inf):
#                 g[nxt], prev[nxt] = ng, cur
#                 heapq.heappush(pq, (ng + h(nxt), ng, nxt))
#     return None


# class Grid:
#     def __init__(self):
#         meta_path = GRID_DIR / "grid.json"
#         if meta_path.exists():
#             meta = json.loads(meta_path.read_text())
#             self.cell_m = meta["cell_m"]
#             self.bbox = tuple(meta["bbox"])  # lat_min, lon_min, lat_max, lon_max

#             def load(name):
#                 p = GRID_DIR / f"{name}.npy"
#                 return np.load(p) if p.exists() else None

#             slope = load("slope")
#             if slope is None:
#                 dem = load("dem")
#                 if dem is None:
#                     raise RuntimeError("Є grid.json, але немає slope.npy або dem.npy")
#                 slope = slope_from_dem(dem, self.cell_m)
#             hazard = load("hazard")
#             radiation = load("radiation")
#             self.source = "real"
#         else:
#             self.cell_m = 50
#             self.bbox = (-5.17, 137.76, -5.00, 137.93)  # ПЛЕЙСХОЛДЕР
#             slope = fake_slope(200)
#             hazard = radiation = None
#             self.source = "fake"

#         self.slope = slope
#         self.rows, self.cols = slope.shape
#         self.cost = self._cost_map(slope, hazard, radiation)

#     def _cost_map(self, slope, hazard, radiation):
#         cost = 1 + (slope / MAX_SLOPE) ** 2 * 10
#         blocked = slope > MAX_SLOPE
#         if hazard is not None:
#             blocked = blocked | hazard.astype(bool)
#         blocked = dilate(blocked, SAFETY_CELLS)
#         if radiation is not None:
#             cost = cost + radiation * 3
#         cost[blocked] = np.inf
#         return cost

#     def contains(self, lat, lon):
#         lat_min, lon_min, lat_max, lon_max = self.bbox
#         return lat_min <= lat <= lat_max and lon_min <= lon <= lon_max

#     def to_rowcol(self, lat, lon):
#         lat_min, lon_min, lat_max, lon_max = self.bbox
#         r = round((lat_max - lat) / (lat_max - lat_min) * (self.rows - 1))
#         c = round((lon - lon_min) / (lon_max - lon_min) * (self.cols - 1))
#         return r, c

#     def to_lonlat(self, rc):
#         lat_min, lon_min, lat_max, lon_max = self.bbox
#         lat = lat_max - rc[0] / (self.rows - 1) * (lat_max - lat_min)
#         lon = lon_min + rc[1] / (self.cols - 1) * (lon_max - lon_min)
#         return [lon, lat]  # GeoJSON: спочатку lon, потім lat

#     def demo_stops(self):
#         lat_min, lon_min, lat_max, lon_max = self.bbox

#         def pt(fr, fc):
#             return (lat_max - fr * (lat_max - lat_min),
#                     lon_min + fc * (lon_max - lon_min))

#         home = pt(0.05, 0.05)
#         return [home, pt(0.35, 0.75), pt(0.75, 0.85), home]

#     def info(self):
#         return {
#             "data_source": self.source,
#             "rows": self.rows,
#             "cols": self.cols,
#             "cell_m": self.cell_m,
#             "bbox": list(self.bbox),
#             "max_slope_deg": MAX_SLOPE,
#             "speed_kmh": SPEED_KMH,
#             "max_eva_h": MAX_EVA_H,
#         }

#     def plan(self, stops, max_eva_h=MAX_EVA_H):
#         """stops: список (lat, lon). Повертає словник з маршрутом і підсумком."""
#         for lat, lon in stops:
#             if not self.contains(lat, lon):
#                 return {"ok": False,
#                         "error": f"Точка ({lat}, {lon}) поза областю карти"}
#         cells = [self.to_rowcol(lat, lon) for lat, lon in stops]

#         warnings = []
#         cost = self.cost.copy()
#         for i, cell in enumerate(cells):
#             if not np.isfinite(cost[cell]):
#                 warnings.append(f"Точка {i + 1} лежить у небезпечній зоні")
#             cost[cell] = 1.0

#         path = []
#         for a, b in zip(cells, cells[1:]):
#             seg = astar(cost, a, b)
#             if seg is None:
#                 return {"ok": False, "error": "Безпечного шляху між точками немає"}
#             path += seg if not path else seg[1:]

#         dist_km = sum(math.hypot(p[0] - q[0], p[1] - q[1])
#                       for p, q in zip(path, path[1:])) * self.cell_m / 1000
#         time_h = dist_km / SPEED_KMH
#         within = time_h <= max_eva_h
#         if not within:
#             warnings.append(
#                 f"Маршрут {time_h:.1f} год перевищує ліміт {max_eva_h} год")

#         return {
#             "ok": True,
#             "data_source": self.source,
#             "route": {
#                 "type": "Feature",
#                 "properties": {},
#                 "geometry": {"type": "LineString",
#                              "coordinates": [self.to_lonlat(p) for p in path]},
#             },
#             "summary": {
#                 "distance_km": round(dist_km, 2),
#                 "time_h": round(time_h, 2),
#                 "max_slope_deg": round(float(max(self.slope[p] for p in path)), 1),
#                 "radiation_dose_msv": round(RAD_MSV_PER_DAY / 24 * time_h, 3),
#                 "within_eva_limit": within,
#                 "waypoints": [self.to_lonlat(c) for c in cells],
#             },
#             "warnings": warnings,
#         }

import heapq
import json
import math
import os
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "public" / "data"))
M_PER_DEG = 59_160       # метрів в 1° широти на Марсі (2π·3389.5 км / 360)
FAKE_N = 200             # розмір тестової сітки, клітинок

MAX_SLOPE = 25           # градуси: вище вважаємо непрохідним
SPEED_KMH = 2.5          # швидкість у скафандрі
MAX_EVA_H = 6            # ліміт одного виходу, години
SAFETY_CELLS = 2         # запас безпеки навколо небезпек
RAD_MSV_PER_DAY = 0.64   # TODO: перевірити за даними Curiosity RAD


def slope_from_dem(dem, cell_m):
    dz_dr, dz_dc = np.gradient(dem, cell_m)
    return np.degrees(np.arctan(np.hypot(dz_dr, dz_dc)))


def dilate(mask, n):
    out = mask.copy()
    for _ in range(n):
        out = (out | np.roll(out, 1, 0) | np.roll(out, -1, 0)
                   | np.roll(out, 1, 1) | np.roll(out, -1, 1))
    return out


def fake_slope(n, seed=1):
    rng = np.random.default_rng(seed)
    a = rng.random((n, n))
    for _ in range(25):
        a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0)
               + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 5
    a = (a - a.min()) / (a.max() - a.min())
    return a * 35


def astar(cost, start, goal):
    rows, cols = cost.shape
    h = lambda p: math.hypot(p[0] - goal[0], p[1] - goal[1])
    pq = [(h(start), 0.0, start)]
    g, prev = {start: 0.0}, {}
    moves = [(-1, 0), (1, 0), (0, -1), (0, 1),
             (-1, -1), (-1, 1), (1, -1), (1, 1)]
    while pq:
        _, gc, cur = heapq.heappop(pq)
        if cur == goal:
            path = [cur]
            while cur in prev:
                cur = prev[cur]
                path.append(cur)
            return path[::-1]
        if gc > g[cur]:
            continue
        for dr, dc in moves:
            nxt = (cur[0] + dr, cur[1] + dc)
            if not (0 <= nxt[0] < rows and 0 <= nxt[1] < cols):
                continue
            if not np.isfinite(cost[nxt]):
                continue
            step = math.hypot(dr, dc) * (cost[cur] + cost[nxt]) / 2
            ng = gc + step
            if ng < g.get(nxt, math.inf):
                g[nxt], prev[nxt] = ng, cur
                heapq.heappush(pq, (ng + h(nxt), ng, nxt))
    return None


class Grid:
    def __init__(self, grid_dir: Path, bbox, seed=1):
        """grid_dir: папка з grid.json і *.npy однієї ділянки.
        Поки даних немає — тестові ухили в межах bbox (lat_min, lon_min, lat_max, lon_max)."""
        meta_path = grid_dir / "grid.json"
        if meta_path.exists():
            meta = json.loads(meta_path.read_text())
            self.cell_m = meta["cell_m"]
            self.bbox = tuple(meta["bbox"])  # lat_min, lon_min, lat_max, lon_max

            def load(name):
                p = grid_dir / f"{name}.npy"
                return np.load(p) if p.exists() else None

            slope = load("slope")
            if slope is None:
                dem = load("dem")
                if dem is None:
                    raise RuntimeError("Є grid.json, але немає slope.npy або dem.npy")
                slope = slope_from_dem(dem, self.cell_m)
            hazard = load("hazard")
            radiation = load("radiation")
            self.source = "real"
        else:
            self.bbox = tuple(bbox)
            # розмір клітинки з розміру ділянки, щоб відстані й час були правдоподібні
            self.cell_m = (self.bbox[2] - self.bbox[0]) * M_PER_DEG / FAKE_N
            slope = fake_slope(FAKE_N, seed)
            hazard = radiation = None
            self.source = "fake"

        self.slope = slope
        self.rows, self.cols = slope.shape
        self.cost = self._cost_map(slope, hazard, radiation)

    def _cost_map(self, slope, hazard, radiation):
        cost = 1 + (slope / MAX_SLOPE) ** 2 * 10
        blocked = slope > MAX_SLOPE
        if hazard is not None:
            blocked = blocked | hazard.astype(bool)
        blocked = dilate(blocked, SAFETY_CELLS)
        if radiation is not None:
            cost = cost + radiation * 3
        cost[blocked] = np.inf
        return cost

    def contains(self, lat, lon):
        lat_min, lon_min, lat_max, lon_max = self.bbox
        return lat_min <= lat <= lat_max and lon_min <= lon <= lon_max

    def to_rowcol(self, lat, lon):
        lat_min, lon_min, lat_max, lon_max = self.bbox
        r = round((lat_max - lat) / (lat_max - lat_min) * (self.rows - 1))
        c = round((lon - lon_min) / (lon_max - lon_min) * (self.cols - 1))
        return r, c

    def to_lonlat(self, rc):
        lat_min, lon_min, lat_max, lon_max = self.bbox
        lat = lat_max - rc[0] / (self.rows - 1) * (lat_max - lat_min)
        lon = lon_min + rc[1] / (self.cols - 1) * (lon_max - lon_min)
        return [lon, lat]  # GeoJSON: спочатку lon, потім lat

    def demo_stops(self):
        lat_min, lon_min, lat_max, lon_max = self.bbox

        def pt(fr, fc):
            return (lat_max - fr * (lat_max - lat_min),
                    lon_min + fc * (lon_max - lon_min))

        home = pt(0.05, 0.05)
        return [home, pt(0.35, 0.75), pt(0.75, 0.85), home]

    def info(self):
        return {
            "data_source": self.source,
            "rows": self.rows,
            "cols": self.cols,
            "cell_m": self.cell_m,
            "bbox": list(self.bbox),
            "max_slope_deg": MAX_SLOPE,
            "speed_kmh": SPEED_KMH,
            "max_eva_h": MAX_EVA_H,
        }

    def plan(self, stops, max_eva_h=MAX_EVA_H):
        """stops: список (lat, lon). Повертає словник з маршрутом і підсумком."""
        for lat, lon in stops:
            if not self.contains(lat, lon):
                return {"ok": False,
                        "error": f"Точка ({lat}, {lon}) поза областю карти"}
        cells = [self.to_rowcol(lat, lon) for lat, lon in stops]

        warnings = []
        cost = self.cost.copy()
        for i, cell in enumerate(cells):
            if not np.isfinite(cost[cell]):
                warnings.append(f"Точка {i + 1} лежить у небезпечній зоні")
            cost[cell] = 1.0

        path = []
        for a, b in zip(cells, cells[1:]):
            seg = astar(cost, a, b)
            if seg is None:
                return {"ok": False, "error": "Безпечного шляху між точками немає"}
            path += seg if not path else seg[1:]

        dist_km = sum(math.hypot(p[0] - q[0], p[1] - q[1])
                      for p, q in zip(path, path[1:])) * self.cell_m / 1000
        time_h = dist_km / SPEED_KMH
        within = time_h <= max_eva_h
        if not within:
            warnings.append(
                f"Маршрут {time_h:.1f} год перевищує ліміт {max_eva_h} год")

        return {
            "ok": True,
            "data_source": self.source,
            "route": {
                "type": "Feature",
                "properties": {},
                "geometry": {"type": "LineString",
                             "coordinates": [self.to_lonlat(p) for p in path]},
            },
            "summary": {
                "distance_km": round(dist_km, 2),
                "time_h": round(time_h, 2),
                "max_slope_deg": round(float(max(self.slope[p] for p in path)), 1),
                "radiation_dose_msv": round(RAD_MSV_PER_DAY / 24 * time_h, 3),
                "within_eva_limit": within,
                "waypoints": [self.to_lonlat(c) for c in cells],
            },
            "warnings": warnings,
        }


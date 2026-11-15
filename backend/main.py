# import json
# from typing import List

# from fastapi import FastAPI, HTTPException
# from fastapi.middleware.cors import CORSMiddleware
# from pydantic import BaseModel

# from planner import MAX_EVA_H, ROOT, Grid

# TARGETS_PATH = ROOT / "public" / "data" / "targets.json"

# app = FastAPI(title="Martian Map API")
# app.add_middleware(CORSMiddleware, allow_origins=["*"],
#                    allow_methods=["*"], allow_headers=["*"])

# grid = Grid()


# class Point(BaseModel):
#     lat: float
#     lon: float


# class RouteRequest(BaseModel):
#     start: Point
#     targets: List[Point]
#     return_to_start: bool = True
#     max_eva_h: float = MAX_EVA_H


# def run_plan(stops, max_eva_h):
#     result = grid.plan(stops, max_eva_h)
#     if not result["ok"]:
#         raise HTTPException(status_code=422, detail=result["error"])
#     return result


# @app.get("/api/health")
# def health():
#     return {"status": "ok", "data_source": grid.source}


# @app.get("/api/grid")
# def grid_info():
#     return grid.info()


# @app.get("/api/targets")
# def targets():
#     if not TARGETS_PATH.exists():
#         raise HTTPException(status_code=404, detail="targets.json ще немає")
#     return json.loads(TARGETS_PATH.read_text())


# @app.get("/api/route/default")
# def default_route():
#     if TARGETS_PATH.exists():
#         t = json.loads(TARGETS_PATH.read_text())
#         home = (t["habitat"]["lat"], t["habitat"]["lon"])
#         stops = [home] + [(x["lat"], x["lon"]) for x in t["targets"]] + [home]
#     else:
#         stops = grid.demo_stops()
#     return run_plan(stops, MAX_EVA_H)


# @app.post("/api/route")
# def custom_route(req: RouteRequest):
#     stops = [(req.start.lat, req.start.lon)]
#     stops += [(t.lat, t.lon) for t in req.targets]
#     if req.return_to_start:
#         stops.append(stops[0])
#     return run_plan(stops, req.max_eva_h)

import json
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from planner import DATA_DIR, MAX_EVA_H, Grid

# Ділянки, на яких будуються маршрути: (lat_min, lon_min, lat_max, lon_max).
# Дані кожної ділянки — у public/data/<site>/: targets.json і grid/ (grid.json + *.npy).
SITES = {
    "jezero": {"name": "Кратер Jezero", "bbox": (18.30, 77.40, 18.50, 77.60)},
    "sharp": {"name": "Гора Шарп", "bbox": (-5.17, 137.76, -5.00, 137.93)},
}
DEFAULT_SITE = "jezero"

app = FastAPI(title="Martian Map API")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

grids = {
    sid: Grid(DATA_DIR / sid / "grid", cfg["bbox"], seed=i + 1)
    for i, (sid, cfg) in enumerate(SITES.items())
}


def get_grid(site: str) -> Grid:
    if site not in grids:
        raise HTTPException(status_code=404, detail=f"Немає ділянки '{site}'")
    return grids[site]


def targets_path(site: str):
    return DATA_DIR / site / "targets.json"


class Point(BaseModel):
    lat: float
    lon: float


class RouteRequest(BaseModel):
    start: Point
    targets: List[Point]
    return_to_start: bool = True
    max_eva_h: float = MAX_EVA_H
    optimize_order: bool = False      # переставити проміжні зупинки, щоб шлях був найдешевшим


def run_plan(grid, stops, max_eva_h, optimize_order=False):
    result = grid.plan(stops, max_eva_h, optimize_order)
    if not result["ok"]:
        raise HTTPException(status_code=422, detail=result["error"])
    return result


@app.get("/api/health")
def health():
    return {"status": "ok", "data_source": {k: g.source for k, g in grids.items()}}


@app.get("/api/sites")
def sites():
    return [{"id": k, "name": v["name"], "bbox": list(grids[k].bbox),
             "data_source": grids[k].source} for k, v in SITES.items()]


@app.get("/api/{site}/grid")
def grid_info(site: str):
    return get_grid(site).info()


@app.get("/api/{site}/targets")
def targets(site: str):
    get_grid(site)
    path = targets_path(site)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"public/data/{site}/targets.json ще немає")
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/api/{site}/route/default")
def default_route(site: str):
    grid = get_grid(site)
    path = targets_path(site)
    if path.exists():
        t = json.loads(path.read_text(encoding="utf-8"))
        home = (t["habitat"]["lat"], t["habitat"]["lon"])
        stops = [home] + [(x["lat"], x["lon"]) for x in t["targets"]] + [home]
    else:
        stops = grid.demo_stops()
    return run_plan(grid, stops, MAX_EVA_H)


@app.post("/api/{site}/route")
def custom_route(site: str, req: RouteRequest):
    grid = get_grid(site)
    stops = [(req.start.lat, req.start.lon)]
    stops += [(t.lat, t.lon) for t in req.targets]
    if req.return_to_start:
        stops.append(stops[0])
    return run_plan(grid, stops, req.max_eva_h, req.optimize_order)


# Старі адреси без назви ділянки — працюють з ділянкою за замовчуванням
@app.get("/api/grid")
def grid_info_default():
    return grid_info(DEFAULT_SITE)


@app.get("/api/targets")
def targets_default():
    return targets(DEFAULT_SITE)


@app.get("/api/route/default")
def default_route_default():
    return default_route(DEFAULT_SITE)


@app.post("/api/route")
def custom_route_default(req: RouteRequest):
    return custom_route(DEFAULT_SITE, req)

import json
from typing import List

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from planner import MAX_EVA_H, ROOT, Grid

TARGETS_PATH = ROOT / "public" / "data" / "targets.json"

app = FastAPI(title="Martian Map API")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])

grid = Grid()


class Point(BaseModel):
    lat: float
    lon: float


class RouteRequest(BaseModel):
    start: Point
    targets: List[Point]
    return_to_start: bool = True
    max_eva_h: float = MAX_EVA_H


def run_plan(stops, max_eva_h):
    result = grid.plan(stops, max_eva_h)
    if not result["ok"]:
        raise HTTPException(status_code=422, detail=result["error"])
    return result


@app.get("/api/health")
def health():
    return {"status": "ok", "data_source": grid.source}


@app.get("/api/grid")
def grid_info():
    return grid.info()


@app.get("/api/targets")
def targets():
    if not TARGETS_PATH.exists():
        raise HTTPException(status_code=404, detail="targets.json ще немає")
    return json.loads(TARGETS_PATH.read_text())


@app.get("/api/route/default")
def default_route():
    if TARGETS_PATH.exists():
        t = json.loads(TARGETS_PATH.read_text())
        home = (t["habitat"]["lat"], t["habitat"]["lon"])
        stops = [home] + [(x["lat"], x["lon"]) for x in t["targets"]] + [home]
    else:
        stops = grid.demo_stops()
    return run_plan(stops, MAX_EVA_H)


@app.post("/api/route")
def custom_route(req: RouteRequest):
    stops = [(req.start.lat, req.start.lon)]
    stops += [(t.lat, t.lon) for t in req.targets]
    if req.return_to_start:
        stops.append(stops[0])
    return run_plan(stops, req.max_eva_h)


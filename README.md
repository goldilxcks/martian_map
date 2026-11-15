# Martian Map — Marswalk Route Planner

> **NASA Space Apps Challenge 2026 · Interplanetary Survival Guide: Martian Map · Team ZAMAS**

A layered, hyperlocal map and route planner for a human **Marswalk** (an EVA on foot). A 3D globe built from NASA/USGS elevation data lets you pick a mission site; a detailed map of the excursion area then combines topography, slope hazards and science layers, and an A\* planner builds a safe round-trip route from the habitat through every stop and back, reporting distance, walking time, time spent at stops and the steepest slope against a 6-hour limit.

**The problem.** Mars is well mapped, but for scientists and robots. There is no ready-made tool that takes one excursion, one crew and a fixed time budget, and answers: *where can we walk, what do we want to see, and can we be back in time?*

**Our answer.** One map, many layers, one route, with the safety rules built in: no slopes over 25° (a team-chosen limit), a safety buffer around hazards, and a guaranteed return to base.

---

## Contents

1. [What works today](#what-works-today)
2. [Quick start](#quick-start)
3. [How it works](#how-it-works)
4. [The math](#the-math)
5. [Data sources (NASA only)](#data-sources-nasa-only)
6. [Assumptions](#assumptions)
7. [Limitations and known issues](#limitations-and-known-issues)
8. [Repository layout](#repository-layout)
9. [API](#api)
10. [Rebuilding the data](#rebuilding-the-data)
11. [Use of AI](#use-of-ai)
12. [Future work](#future-work)
13. [Credits](#credits)

---

## What works today

| Feature | Jezero Crater | Mount Sharp (Gale Crater) |
|---|---|---|
| 3D globe from NASA/USGS elevation data, click a site | ✅ | ✅ |
| Mission briefing page and map | ✅ | ✅ |
| NASA MOLA colour-relief base map | ✅ | ✅ |
| Slope map and no-go zones from a 20 m CTX DEM | ✅ real data | ❌ not yet |
| CTX orbital image (6 m/pixel) as a base layer | ✅ | ❌ |
| Aqueous-mineral detections | ✅ | ✅ (6 points) + Gale landmarks |
| Click-to-add stops and A\* route with safety rules | ✅ real terrain | ⚠️ **synthetic terrain only** (see [limitations](#limitations-and-known-issues)) |
| Route summary: distance, walking time, time at stops, max slope, EVA-limit bar | ✅ | ⚠️ |
| Automatic ordering of stops (cheapest safe order) | ✅ | ⚠️ |
| Elevation profile along the route, coloured by slope | ✅ | ❌ (needs a DEM) |
| Animated "walk" mode | ✅ | ⚠️ |

**Jezero is the fully working site.** Mount Sharp shows its map layers, but we have no regional elevation model for it yet.

---

## Quick start

Requirements: Python 3.10+ (we used 3.14) and a modern browser. Nothing else is needed to run the demo.

```bash
git clone https://github.com/goldilxcks/martian_map.git
cd martian_map

# 1. backend (route planner API) — terminal 1
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
cd backend
uvicorn main:app --reload            # http://127.0.0.1:8000  (docs at /docs)
```

```bash
# 2. frontend (static pages) — terminal 2, from the repository root
python3 -m http.server 5500
```

Open in the browser:

- Globe: <http://localhost:5500/app/index.html> — click a site label (the label, not the dot)
- Jezero map: <http://localhost:5500/app/mission.html?site=jezero>
- Mount Sharp map: <http://localhost:5500/app/mission.html?site=sharp>

On Debian/Ubuntu, if `python3 -m venv` fails, install `python3-venv` first (for example `sudo apt install python3.14-venv`).

**Using the planner:** open a map → **Планування** (Planning) → click the map to add stops → **Побудувати маршрут** (Build route). The route always returns to the base **Б**. The side panel shows distance, walking time, time at stops, maximum slope and a bar for the total EVA time against the 6-hour limit. **Вихід** (Walk) animates the astronaut along the route.

The frontend expects the API on `http://localhost:8000`. If you serve the pages from FastAPI itself (port 8000), it uses the same server automatically.

---

## How it works

```
NASA Mars Trek (CTX DEM, MOLA, aqueous minerals)
        │  scripts/data/make_grid.py   → slope.npy, dem.npy, grid.json
        │  scripts/data/make_overlays.py → slope.png (hazard overlay)
        ▼
 public/data/<site>/…  ──►  backend/planner.py (cost map + A*)  ──►  backend/main.py (FastAPI)
                                                                         │ JSON / GeoJSON
                                                                         ▼
                                          app/ (Three.js globe + Leaflet mission map)
```

1. **Terrain.** The 20 m CTX digital elevation model of Jezero is turned into a slope grid (coarsened ×4 to 78 m cells).
2. **Cost map.** Each cell gets a walking cost that grows with slope; steep or missing cells and a buffer around them become impassable.
3. **Routing.** A\* finds the cheapest path between consecutive stops; the legs are joined into one round trip that starts and ends at the habitat.
4. **Summary.** Distance, time, steepest slope and EVA-limit status are computed along the final path and returned together with warnings.
5. **Frontend.** The globe (Three.js) leads to a Leaflet map with toggleable layers (`app/sites.js` configures them per site), the planner, and the walk animation.

---

## The math

### 1. Slope from the DEM

The CTX DEM is a float32 raster, 1512 × 1596 pixels, 20 m per pixel, in an equirectangular projection (standard parallel 0°, Mars as a sphere of radius R = 3 396 190 m). In that projection north–south pixel size is constant, but **east–west ground distance shrinks with latitude**, so the pixel width is corrected:

$$\Delta x = s_x \cos\varphi, \qquad \Delta y = s_y$$

where $s_x, s_y$ are the file's pixel scales and $\varphi$ is the latitude of the row (about 18.5° N, so $\cos\varphi \approx 0.95$, about 5% shorter). The gradient components are central differences:

$$\frac{\partial z}{\partial y}=\frac{z_{r+1}-z_{r-1}}{2\,\Delta y},\qquad \frac{\partial z}{\partial x}=\frac{z_{c+1}-z_{c-1}}{2\,\Delta x}$$

and the slope angle is

$$\theta = \arctan\sqrt{\left(\frac{\partial z}{\partial x}\right)^2+\left(\frac{\partial z}{\partial y}\right)^2}\ \ \text{(in degrees)}$$

Pixels with no data (`-3.4·10³⁸`) get θ = 90°, i.e. impassable.

### 2. Coarsening: be conservative

The slope raster is reduced by a factor of 4 (20 m → 78 m cells). Each coarse cell takes the **maximum** slope of its 4 × 4 block, not the average. A single steep pixel therefore marks the whole cell as steep, which errs on the side of safety. Elevation (`dem.npy`) is averaged instead.

Result for Jezero: a 378 × 399 grid (≈ 29.5 × 31.1 km), cell size 77.94 m.

| Slope band | Share of cells |
|---|---|
| < 10° | ≈ 78% |
| 10–18° | ≈ 16% |
| 18–25° | ≈ 4.5% |
| > 25° (forbidden) | ≈ 1.0% |
| Blocked after the safety buffer | ≈ 4.4% |

Median slope is 5.1°, the 90th percentile is 14.8°.

### 3. Walking cost per cell

$$c(\theta)=1+10\left(\frac{\theta}{\theta_{max}}\right)^2,\qquad \theta_{max}=25^\circ$$

| Slope θ | 0° | 5° | 10° | 18° | 25° |
|---|---|---|---|---|---|
| Cost c | 1.0 | 1.4 | 2.6 | 6.2 | 11.0 |

Flat ground costs 1 per cell, and the cost rises quadratically, so the planner takes a detour around a steep patch long before it would walk over it. A cell is **impassable** (cost = ∞) if θ > 25°, if it is in the hazard mask, or if it lies within the safety buffer.

### 4. Safety buffer

Blocked cells are dilated by `SAFETY_CELLS = 2` steps using the 4-neighbourhood, so a diamond of radius 2 cells (≈ 156 m) around every forbidden cell is also forbidden. The route therefore never grazes a cliff edge.

### 5. A\* search

The grid is searched with 8-connected moves (including diagonals). The cost of one step from cell $a$ to neighbour $b$ is the average of the two cell costs times the step length in cells:

$$w(a,b)=\|b-a\|\cdot\frac{c(a)+c(b)}{2},\qquad \|b-a\|\in\{1,\sqrt2\}$$

A\* expands cells in order of

$$f(n)=g(n)+h(n)$$

where $g(n)$ is the accumulated cost from the start and $h(n)=\|goal-n\|$ is the straight-line distance in cells. This heuristic is **admissible and consistent**, because the cheapest possible cell costs 1 and no step can cover distance for less than its length. Therefore A\* returns the minimum-cost path, and it expands far fewer cells than Dijkstra. A binary heap (`heapq`) makes each step O(log n).

A route with several stops is built leg by leg (base → stop 1 → … → base) and the legs are concatenated.

### 6. Order of stops

For a round trip with $k$ intermediate stops there are $k!$ possible orders. We first compute the true minimum cost $d_{ij}$ between **every pair** of points with A\* (the cost is symmetric, so $\binom{k+1}{2}$ searches are enough, because the base counts once), then choose the order that minimises

$$\sum_{t=0}^{k} d_{\pi_t\,\pi_{t+1}},\qquad \pi_0=\pi_{k+1}=\text{base}$$

For $k \le 8$ all $k!$ orders are checked exactly (at most 40 320 sums of table lookups, which is instant); for $9$–$10$ stops we use nearest-neighbour followed by 2-opt improvement. Because $d_{ij}$ already includes slopes and no-go zones, "shortest" means the cheapest safe order, not just the shortest straight-line order. The response reports how much the cost dropped compared with the clicked order (`order_gain_pct`).

### 7. Elevation profile

For every cell on the final path the planner reads its elevation $z_i$ from `dem.npy` and the cumulative distance $s_i=\text{cell size}\cdot\sum \ell$ along the path. Ascent and descent are $\sum \max(\Delta z,0)$ and $\sum \max(-\Delta z,0)$. At most 160 points $(s_i, z_i, \theta_i)$ are returned and drawn as a chart whose line colour follows the slope $\theta_i$.

### 8. Route summary

Along the final cell path, with $N$ steps of length $\ell_i\in\{1,\sqrt2\}$ in cells:

$$D = \frac{\text{cell size}}{1000}\sum_{i=1}^{N}\ell_i\ \ [\text{km}],\qquad T_{walk}=\frac{D}{v},\quad v = 2.5\ \text{km/h}$$

The panel adds the time spent working at stops and compares the total with the EVA limit (6 h). Maximum slope is the largest θ among the cells on the path. If $T_{walk}$ exceeds the limit, a warning is shown.

### 9. Coordinates

The API works in latitude/longitude. A point is mapped to a grid cell by linear interpolation inside the grid bounding box. The bounding box is computed from cell **centres**, so conversion between map coordinates and cells is consistent in both directions. GeoJSON output uses `[lon, lat]` order.

---

## Data sources (NASA only)

By design the project uses only the resources provided by NASA for the challenge. All layers come from **NASA/JPL Mars Trek** (<https://trek.nasa.gov/mars/>) and the USGS-NASA mapping programme. Full details, limitations and citations are in [`public/data/sources.md`](public/data/sources.md).

| Layer | Source | Used for |
|---|---|---|
| **Jezero DEM**, 20 m/pixel (`JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m…tif`) | MRO CTX stereo DEM, USGS Astrogeology | Slope map, cost map, routing |
| **Jezero orthomosaic**, 6 m/pixel (`…orthoMosaic_6m…zip`) | MRO CTX, USGS Astrogeology | Optical base layer (downsampled to 2048 px, ≈ 2.9 m/pixel, contrast-stretched) |
| **MOLA colour relief**, 463 m/pixel | MGS MOLA, via Mars Trek tiles | Base map in the browser |
| **MOLA elevation (MEGDR)** | MGS MOLA | Height of the 3D globe |
| **Aqueous Mineral Distribution** | Mars Trek layer compiled from CRISM, OMEGA, THEMIS; Ehlmann & Edwards (2014), *Annu. Rev. Earth Planet. Sci.* 42:291–315 | Science layer (14 hand-collected points for Jezero, 6 for Gale) |
| **Gale points** (`public/data/Gale/`) | Mars Trek, collected by the team | Mount Sharp minerals and landmarks |

Notes on the data:

- The aqueous-mineral layer cannot be downloaded from Mars Trek, so the points were **collected by hand from map pop-ups**. They are detection points, not a continuous mineral map.
- Only 2 of the 14 Jezero points lie inside the 30 × 30 km study area; the others are regional context.
- Large global files are not stored in the repository; only regional extracts are.

---

## Assumptions

These are **our own modelling choices, not NASA values**, and they are labelled as such in the interface and presentation.

| Parameter | Value | Where |
|---|---|---|
| Maximum walkable slope | 25° | `MAX_SLOPE` in `backend/planner.py` |
| Walking speed in a suit | 2.5 km/h | `SPEED_KMH` |
| EVA limit | 6 hours | `MAX_EVA_H` |
| Crew size | 2 | `app/sites.js` |
| Safety buffer | 2 cells (≈ 156 m) | `SAFETY_CELLS` |
| Cost shape | $1 + 10(\theta/25)^2$ | `Grid._cost_map` |

The cost function treats slope as the only terrain factor.

---

## Limitations and known issues

We would rather state these than hide them.

- **Resolution.** The Jezero DEM is 20 m, coarsened to 78 m cells. Boulders, small craters and sand ripples cannot be seen at this scale. The global MOLA data (463 m/pixel) is even coarser. The map shows **slope**, not trafficability.
- **Mount Sharp has no real routing yet.** There is no regional DEM for it in the repository. For a site without a grid the backend falls back to **synthetic placeholder terrain** (`data_source: "fake"`). Routes there are for demonstration only and must not be read as real hazards.
- **"Standard targets" are not science targets.** There is no `targets.json` for Jezero, so the *Стандартні цілі* button uses the planner's placeholder demo stops. Real science targets would come from the team's science data.
- **Stop order.** With *Автоматично впорядкувати зупинки* ticked, the planner searches for the cheapest order (up to 10 stops; more than that keeps the order given). With it off, stops are visited in the order they were clicked. Scattered stops can still produce routes longer than 6 h; the planner then shows a warning. Finding the order takes a few seconds for 6–8 far-apart stops.
- **Elevation profile is approximate.** Heights come from the DEM averaged over ≈ 78 m cells, so small bumps are smoothed out and ascent/descent totals are estimates.
- **No time-dependent data.** Lighting, temperature, weather and dust storms are missing, though they decide when an excursion is safe.
- **Radiation is intentionally not modelled.** No radiation data was in the NASA resources provided for the challenge. The backend still contains an unverified placeholder (`RAD_MSV_PER_DAY`) that appears in the API response as `radiation_dose_msv`; **it is not a result and should be ignored.**
- **Ground-level imagery** (Perseverance raw images) is not yet linked to targets.
- **Manual data collection.** Part of the data was collected by hand because some Mars Trek layers cannot be downloaded.

---

## Repository layout

```
app/                    Frontend (static, no build step)
  index.html, main.js     3D globe (Three.js) and site selection
  mission.html/.js/.css   Leaflet mission map: briefing, planning, walk modes
  sites.js                Per-site configuration and layer list
  textures/               Globe textures (colour, height, meta.json)
backend/
  main.py                 FastAPI app (multi-site API)
  planner.py              Slope grid, cost map, A* route planner
  requirements.txt        fastapi, uvicorn[standard], numpy
public/data/
  jezero/                 grid/ (slope.npy, dem.npy, grid.json), slope.png, ctx_mosaic.jpg, aqueous_minerals.geojson
  sharp/                  Gale mineral and landmark layers (GeoJSON)
  Gale/                   Raw Gale points (tif + legend csv)
  JEZ_ctx_*               Source CTX DEM (tif) and orthomosaic (zip)
  sources.md              Data sources, citations, limitations
scripts/
  data/                   make_grid.py, make_overlays.py, make_ctx_overlay.py, prepare_textures.py, fetch_color_tiles.py
  routing/route.py        First standalone routing prototype
```

---

## API

Base URL: `http://localhost:8000` (interactive docs at `/docs`). `{site}` is `jezero` or `sharp`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Status and data source per site (`real` or `fake`) |
| GET | `/api/sites` | List of sites with their bounding boxes |
| GET | `/api/{site}/grid` | Grid info: size, cell size, bbox, slope limit, speed, EVA limit |
| GET | `/api/{site}/targets` | Habitat and targets (`public/data/{site}/targets.json`, if present) |
| GET | `/api/{site}/route/default` | Route through the default targets |
| POST | `/api/{site}/route` | Route through custom stops |

Example request:

```bash
curl -X POST http://localhost:8000/api/jezero/route \
  -H "Content-Type: application/json" \
  -d '{"start": {"lat": 18.5289, "lon": 77.3406},
       "targets": [{"lat": 18.5275, "lon": 77.3703}],
       "return_to_start": true, "max_eva_h": 6, "optimize_order": true}'
```

The response contains the route as a GeoJSON `LineString`, a `summary` (distance in km, time in hours, maximum slope, whether it fits the EVA limit, waypoints, the visiting `order` of the stops, `order_gain_pct`, `ascent_m` / `descent_m` and the elevation `profile` as `[km, metres, slope°]` triples) and a list of `warnings` (for example a stop inside a hazard zone, or a route longer than the limit). Old unprefixed endpoints (`/api/grid`, `/api/route`, …) use Jezero.

---

## Rebuilding the data

All steps are run from the repository root.

```bash
pip install numpy tifffile pillow

# 1. slope grid from the CTX DEM  → public/data/jezero/grid/{slope.npy, dem.npy, grid.json}
python3 scripts/data/make_grid.py \
  public/data/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif \
  public/data/jezero/grid --factor 4

# 2. hazard overlay for the map → public/data/jezero/slope.png (also prints the sites.js block)
python3 scripts/data/make_overlays.py public/data/jezero/grid public/data/jezero
```

`--factor` sets how many source pixels form one grid cell; 4 gives ≈ 78 m cells.

```bash
# 3. optical base layer from the CTX orthomosaic (reads the zip directly)
python3 scripts/data/make_ctx_overlay.py \
  public/data/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.zip \
  public/data/jezero/ctx_mosaic.jpg --width 2048
```

The script prints the `bbox` to put into `app/sites.js`.

---

## Use of AI

In line with the challenge rules on synthetic intelligence (SI):

- The **route-planning backend** (`backend/planner.py`, the multi-site API in `backend/main.py`), the **data-processing scripts** (`scripts/data/make_grid.py`, `scripts/data/make_overlays.py`), this README and the presentation text were written **with the assistance of Anthropic's Claude**. The team ran, tested and reviewed this work.
- No AI-generated images or video are used. No NASA branding was generated or modified by AI.
- All data come from NASA/USGS sources listed above; AI was not used to create or alter data.

---

## Future work

- Real routing for Mount Sharp (regional DEM and slope grid).
- More layers: THEMIS night infrared (thermal inertia), geologic map.
- Perseverance raw images linked to each target, so astronauts can preview a stop.
- Time-dependent factors: lighting, temperature, weather, dust.
- A mission editor and real-time data.

---

## Credits

Team **ZAMAS** — NASA International Space Apps Challenge 2026.

Data: NASA/JPL Mars Trek, USGS Astrogeology Science Center, MRO CTX, MGS MOLA, CRISM, OMEGA, THEMIS. See [`public/data/sources.md`](public/data/sources.md).

This project is a hackathon prototype for the *Interplanetary Survival Guide: Martian Map* challenge. It is not a flight-qualified planning tool, and its safety parameters are assumptions.

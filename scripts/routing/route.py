import heapq, json, math, os
import numpy as np

N = 200                      # розмір растру (N x N клітинок)
CELL_M = 50                  # розмір клітинки, метри
MAX_SLOPE = 25               # ухил вище цього вважаємо непрохідним, градуси
SPEED_KMH = 2.5              # швидкість у скафандрі
# lat_min, lon_min, lat_max, lon_max: замінити на область з data-contract.md
BBOX = (18.30, 77.40, 18.50, 77.60)

# Старт і цілі як (рядок, стовпець). Потім заміняться на targets.json
START = (10, 10)
TARGETS = [(60, 150), (150, 170), (170, 40)]

def fake_slope(seed=1):
    rng = np.random.default_rng(seed)
    a = rng.random((N, N))
    for _ in range(25):      # згладжування, щоб вийшли "пагорби"
        a = (a + np.roll(a, 1, 0) + np.roll(a, -1, 0)
               + np.roll(a, 1, 1) + np.roll(a, -1, 1)) / 5
    a = (a - a.min()) / (a.max() - a.min())
    return a * 35            # ухили 0..35 градусів

def cost_map(slope):
    cost = 1 + (slope / MAX_SLOPE) ** 2 * 10
    cost[slope > MAX_SLOPE] = np.inf     # непрохідно
    # TODO: додати штраф за радіацію та камені, коли будуть дані
    return cost

def astar(cost, start, goal):
    h = lambda p: math.hypot(p[0] - goal[0], p[1] - goal[1])
    pq = [(h(start), 0.0, start)]
    g, prev = {start: 0.0}, {}
    moves = [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]
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
            if not (0 <= nxt[0] < N and 0 <= nxt[1] < N):
                continue
            if not np.isfinite(cost[nxt]):
                continue
            step = math.hypot(dr, dc) * (cost[cur] + cost[nxt]) / 2
            ng = gc + step
            if ng < g.get(nxt, math.inf):
                g[nxt], prev[nxt] = ng, cur
                heapq.heappush(pq, (ng + h(nxt), ng, nxt))
    return None

def to_lonlat(p):
    lat_min, lon_min, lat_max, lon_max = BBOX
    lat = lat_max - p[0] / (N - 1) * (lat_max - lat_min)
    lon = lon_min + p[1] / (N - 1) * (lon_max - lon_min)
    return [lon, lat]        # GeoJSON: спочатку lon, потім lat

def main():
    slope = fake_slope()
    cost = cost_map(slope)
    stops = [START] + TARGETS + [START]   # туди й назад до habitat
    for s in stops:
        cost[s] = 1                       # старт і цілі завжди прохідні
    full = []
    for a, b in zip(stops, stops[1:]):
        seg = astar(cost, a, b)
        if seg is None:
            raise SystemExit(f"Немає шляху {a} -> {b}")
        full += seg if not full else seg[1:]
    dist_km = sum(math.hypot(p[0]-q[0], p[1]-q[1])
                  for p, q in zip(full, full[1:])) * CELL_M / 1000
    summary = {
        "distance_km": round(dist_km, 2),
        "time_h": round(dist_km / SPEED_KMH, 2),
        "max_slope_deg": round(float(max(slope[p] for p in full)), 1),
        "waypoints": [to_lonlat(s) for s in stops],
    }
    geo = {"type": "Feature", "properties": {},
           "geometry": {"type": "LineString",
                        "coordinates": [to_lonlat(p) for p in full]}}
    os.makedirs("public/data", exist_ok=True)
    json.dump(geo, open("public/data/route.geojson", "w"))
    json.dump(summary, open("public/data/route_summary.json", "w"), indent=2)
    print(summary)

if __name__ == "__main__":
    main()

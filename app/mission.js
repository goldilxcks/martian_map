/* Marswalk — карта місії.
 * Налаштування локацій: sites.js (назва, опис, шари команди даних).
 * Бекенд:  GET  /api/<site>/grid           — ділянка, на якій будуються маршрути
 *          GET  /api/<site>/targets        — база і цілі (public/data/<site>/targets.json)
 *          GET  /api/<site>/route/default  — маршрут через усі цілі
 *          POST /api/<site>/route          — маршрут через вибрані точки
 */
'use strict';

const SITE_ID = new URLSearchParams(location.search).get('site') || 'jezero';
const CFG = window.SITES_CONFIG[SITE_ID] || window.SITES_CONFIG.jezero;
// Якщо сторінку віддає сам FastAPI (порт 8000) — API на тому ж сервері, інакше на localhost:8000
const API = location.port === '8000' ? '' : 'http://localhost:8000';
const MARS_R = 3389500;           // м
const EARTH_R = 6371008.8;        // Leaflet рахує метри для Землі — переводимо
const TREK_MOLA = 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0//default/default028mm/{z}/{y}/{x}.jpg';
const PALETTE = ['#5ad1ff', '#ff7a3c', '#b38cff', '#6fcf8a', '#f2c14e', '#ff5a8a', '#9be3d3'];
const GROUPS = { base: 'Основа', safety: 'Безпека', science: 'Наука' };
const CLASS_NAMES = {
  phyllosilicate: 'Філосилікати (глини)',
  carbonate: 'Карбонати',
  silica: 'Кремнезем',
  hydrous_mineral_detection: 'Водні мінерали (CRISM)',
};

const $ = (id) => document.getElementById(id);
const state = { site: null, targets: null, stops: [], route: null, walk: null, routing: false };

// ---------------------------------------------------------------------------
// Утиліти
// ---------------------------------------------------------------------------
async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    let detail = r.statusText;
    try { detail = (await r.json()).detail || detail; } catch (_) { /* не JSON */ }
    throw new Error(detail);
  }
  return r.json();
}

function toast(text, ms = 5000) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  if (ms) toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

const rad = (d) => d * Math.PI / 180;
function marsDistance(a, b) {        // a, b: [lat, lon]; результат у метрах
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_R * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {             // градуси від півночі за годинниковою
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
const fmtH = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(2)} км` : `${Math.round(m)} м`);
const marsCircleRadius = (m) => m * EARTH_R / MARS_R;

// ---------------------------------------------------------------------------
// Карта
// ---------------------------------------------------------------------------
// Тайли NASA Trek мають ту саму сітку, що й EPSG4326 у Leaflet (рівень 0 = 2×1 тайли)
const map = L.map('map', { crs: L.CRS.EPSG4326, zoomControl: false, zoomSnap: 0.25, minZoom: 2, maxZoom: 15 });
L.control.zoom({ position: 'bottomright' }).addTo(map);
map.attributionControl.setPrefix(false);

map.on('mousemove', (e) => {
  const { lat, lng } = e.latlng;
  $('cursor-coords').textContent = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
});

const layerRegistry = [];   // { id, name, group, layer, legend, visible }

function registerLayer(def) {
  layerRegistry.push(def);
  if (def.visible) def.layer.addTo(map);
  renderLayerPanel();
}

function renderLayerPanel() {
  const list = $('layer-list');
  list.innerHTML = '';
  const groups = {};
  for (const l of layerRegistry) (groups[l.group] ||= []).push(l);
  for (const [g, items] of Object.entries(groups)) {
    const box = document.createElement('div');
    box.className = 'layer-group';
    box.innerHTML = `<div>${GROUPS[g] || g}</div>`;
    for (const l of items) {
      const row = document.createElement('label');
      row.className = 'layer-item';
      row.innerHTML = `<input type="checkbox" ${l.visible ? 'checked' : ''}/> <span>${l.name}</span>`;
      row.querySelector('input').addEventListener('change', (e) => {
        l.visible = e.target.checked;
        if (l.visible) l.layer.addTo(map); else map.removeLayer(l.layer);
        renderLegend();
      });
      box.appendChild(row);
    }
    list.appendChild(box);
  }
  renderLegend();
}

function renderLegend() {
  const el = $('legend');
  el.innerHTML = '';
  for (const l of layerRegistry) {
    if (!l.visible || !l.legend) continue;
    el.insertAdjacentHTML('beforeend', `<div class="lg-title">${l.name}</div>` +
      l.legend.map(([c, t]) => `<div class="lg"><span class="sw" style="background:${c}"></span>${t}</div>`).join(''));
  }
  el.hidden = !el.innerHTML;
}

// --- вбудовані шари ---------------------------------------------------------
function addBaseLayer() {
  registerLayer({
    id: 'mola', name: 'Кольоровий рельєф MOLA', group: 'base', visible: true,
    layer: L.tileLayer(TREK_MOLA, {
      maxNativeZoom: 7, maxZoom: 15, noWrap: true, bounds: [[-90, -180], [90, 180]],
      attribution: 'MOLA Color Shaded Relief · USGS Astrogeology / NASA Trek',
    }),
  });
}

function evaBounds(b) { return [[b[0], b[1]], [b[2], b[3]]]; }

function addEvaArea(bbox) {
  registerLayer({
    id: 'eva', name: 'Ділянка маршрутів (бекенд)', group: 'safety', visible: true,
    layer: L.rectangle(evaBounds(bbox), { color: '#f1e6dc', weight: 1.5, dashArray: '6 6', fill: false, interactive: false }),
  });
}

function targetPopup(t) {
  return `<b>${t.name}</b><br>${t.task || ''}${t.minutes ? `<br><small>≈ ${t.minutes} хв роботи</small>` : ''}` +
    (t.approx ? '<br><small style="color:#f2c14e">координати приблизні</small>' : '');
}

function numberedIcon(n, cls) {
  return L.divIcon({ className: '', html: `<div class="${cls}" style="width:26px;height:26px">${n}</div>`, iconSize: [26, 26] });
}

function addTargetsLayer(t) {
  const g = L.layerGroup();
  L.marker([t.habitat.lat, t.habitat.lon], { icon: numberedIcon('Б', 'marker-home') })
    .bindPopup(`<b>${t.habitat.name}</b>`).addTo(g);
  t.targets.forEach((x, i) => L.marker([x.lat, x.lon], { icon: numberedIcon(i + 1, 'marker-target') })
    .bindPopup(targetPopup(x)).addTo(g));
  registerLayer({ id: 'targets', name: 'Цілі місії', group: 'science', visible: true, layer: g });
  return g;
}

// --- шари команди даних (перелік у sites.js) --------------------------------
async function addTeamLayers() {
  for (const def of CFG.layers || []) {
    try {
      if (def.type === 'geojson') registerLayer(await geojsonLayer(def, def.url));
      else if (def.type === 'image') {
        registerLayer({
          id: def.id, name: def.name, group: def.group || 'other', visible: def.visible !== false,
          layer: L.imageOverlay(def.url, evaBounds(def.bbox), { opacity: def.opacity ?? 0.7 }),
          legend: def.legend || null,
        });
      }
    } catch (e) {
      console.warn(`Шар «${def.name}» не завантажився (${def.url}):`, e.message);
    }
  }
}

async function geojsonLayer(def, url) {
  const data = await getJSON(url);
  const key = def.styleBy;
  const values = key ? [...new Set(data.features.map((f) => f.properties?.[key]))] : [];
  const colorOf = (f) => (key ? PALETTE[values.indexOf(f.properties?.[key]) % PALETTE.length] : def.color || PALETTE[0]);
  const label = (v) => CLASS_NAMES[v] || v;
  const layer = L.geoJSON(data, {
    pointToLayer: (f, latlng) => L.circleMarker(latlng, {
      radius: 6, color: '#120c0a', weight: 1.5, fillColor: colorOf(f), fillOpacity: 0.95, bubblingMouseEvents: false,
    }),
    style: (f) => ({ color: colorOf(f), weight: 2, fillOpacity: 0.25 }),
    onEachFeature: (f, l) => {
      const p = f.properties || {};
      const rows = Object.entries(p).filter(([, v]) => v !== null && v !== '')
        .map(([k, v]) => `<tr><td style="color:#8f8076;padding-right:8px">${k}</td><td>${k === key ? label(v) : v}</td></tr>`).join('');
      l.bindPopup(`<b>${def.name}</b><table>${rows}</table>${data.description ? `<small style="color:#8f8076">${data.description}</small>` : ''}`,
        { maxWidth: 320 });
    },
  });
  return {
    id: def.id, name: def.name, group: def.group || 'other', visible: def.visible !== false, layer,
    legend: key ? values.map((v, i) => [PALETTE[i % PALETTE.length], label(v)]) : null,
  };
}

// ---------------------------------------------------------------------------
// Брифінг
// ---------------------------------------------------------------------------
function renderBriefing() {
  const s = state.site;
  $('objective').textContent = s.objective || '';
  $('f-limit').textContent = `${s.eva.max_h} год`;
  $('f-crew').textContent = `${s.eva.crew} астронавти`;
  $('f-speed').textContent = `${s.eva.speed_kmh} км/год`;
  $('site-note').textContent = s.note || '';
  const list = state.targets?.targets || [];
  $('brief-targets').innerHTML = list.length
    ? list.map((t) => `<li><b>${t.name}</b><small>${t.task || ''}${t.minutes ? ` · ${t.minutes} хв` : ''}</small></li>`).join('')
    : '<li class="note">Цілі з бекенду ще не задані.</li>';
}

// ---------------------------------------------------------------------------
// Планування
// ---------------------------------------------------------------------------
const planLayer = L.layerGroup();
let routeLine = null;

function setDefaultStops() {
  state.stops = (state.targets?.targets || []).map((t) => ({ ...t }));
  clearRoute();
  renderStops();
}

function clearRoute() {
  state.route = null;
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
  $('summary').hidden = true;
  $('modes').querySelector('[data-mode="walk"]').disabled = false;
}

function renderStops() {
  const home = state.targets.habitat;
  $('stops').innerHTML = `<li class="home">Б · ${home.name}</li>` +
    state.stops.map((s, i) => `<li><span>${i + 1} · ${s.name}</span><button data-del="${i}" title="Прибрати">✕</button></li>`).join('') +
    `<li class="home">Б · повернення на базу</li>`;
  $('stops').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    state.stops.splice(Number(b.dataset.del), 1);
    clearRoute();
    renderStops();
  }));

  planLayer.clearLayers();
  L.marker([home.lat, home.lon], { icon: numberedIcon('Б', 'marker-home') }).bindPopup(`<b>${home.name}</b>`).addTo(planLayer);
  state.stops.forEach((s, i) => {
    const m = L.marker([s.lat, s.lon], { icon: numberedIcon(i + 1, 'marker-target'), draggable: true })
      .bindPopup(targetPopup(s)).addTo(planLayer);
    m.on('dragend', () => {
      const p = m.getLatLng();
      s.lat = p.lat; s.lon = p.lng;
      clearRoute();
    });
  });
}

map.on('click', (e) => {
  if (!document.body.classList.contains('mode-plan')) return;
  state.stops.push({
    name: `Точка ${state.stops.length + 1}`, lat: e.latlng.lat, lon: e.latlng.lng,
    task: 'Власна зупинка', minutes: 15,
  });
  clearRoute();
  renderStops();
});

async function buildRoute() {
  const home = state.targets.habitat;
  const limit = state.site.eva.max_h;
  $('btn-route').disabled = true;
  if ($('opt-order').checked && state.stops.length >= 5) toast('Шукаю найкращий порядок зупинок, це може зайняти кілька секунд…', 6000);
  try {
    const res = await getJSON(`${API}/api/${SITE_ID}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        start: { lat: home.lat, lon: home.lon },
        targets: state.stops.map((s) => ({ lat: s.lat, lon: s.lon })),
        return_to_start: true,
        max_eva_h: limit,
        optimize_order: $('opt-order').checked,
      }),
    });
    state.route = res;
    applyStopOrder(res);
    drawRoute(res);
    renderSummary(res, limit);
    return true;
  } catch (e) {
    toast(`Маршрут не побудовано: ${e.message}`);
    return false;
  } finally {
    $('btn-route').disabled = false;
  }
}

// Якщо бекенд переставив зупинки — показуємо їх у новому порядку (і для режиму «Вихід»)
function applyStopOrder(res) {
  const sum = res.summary;
  if (!sum.optimized || !Array.isArray(sum.order) || sum.order.length !== state.stops.length) return;
  const old = state.stops;
  state.stops = sum.order.map((i) => old[i]);
  state.stops.forEach((s, i) => { if (/^Точка \d+$/.test(s.name)) s.name = `Точка ${i + 1}`; });
  renderStops();
  if (sum.order_gain_pct > 0) toast(`Порядок зупинок оптимізовано: шлях коротший приблизно на ${sum.order_gain_pct}%`, 5000);
}

// Профіль висоти: висота вздовж маршруту, колір лінії — за ухилом
function drawProfile(sum) {
  const box = $('profile-box');
  const pts = sum.profile;
  if (!pts || pts.length < 2) { box.hidden = true; return; }
  box.hidden = false;
  const cv = $('s-profile');
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 300, H = 110;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const padL = 40, padR = 8, padT = 10, padB = 20;
  const maxKm = pts[pts.length - 1][0] || 1;
  const zs = pts.map((p) => p[1]);
  let zmin = Math.min(...zs), zmax = Math.max(...zs);
  if (zmax - zmin < 20) { const m = (zmax + zmin) / 2; zmin = m - 10; zmax = m + 10; }
  const X = (km) => padL + (km / maxKm) * (W - padL - padR);
  const Y = (z) => padT + (1 - (z - zmin) / (zmax - zmin)) * (H - padT - padB);
  g.fillStyle = 'rgba(90,209,255,0.10)';
  g.beginPath(); g.moveTo(X(0), H - padB);
  pts.forEach((p) => g.lineTo(X(p[0]), Y(p[1])));
  g.lineTo(X(maxKm), H - padB); g.closePath(); g.fill();
  const slopeColor = (a) => (a > 25 ? '#e62828' : a > 18 ? '#ff8c28' : a > 10 ? '#ffdc3c' : '#5ad1ff');
  g.lineWidth = 2; g.lineJoin = 'round';
  for (let i = 1; i < pts.length; i++) {
    g.strokeStyle = slopeColor(Math.max(pts[i - 1][2], pts[i][2]));
    g.beginPath(); g.moveTo(X(pts[i - 1][0]), Y(pts[i - 1][1])); g.lineTo(X(pts[i][0]), Y(pts[i][1])); g.stroke();
  }
  g.fillStyle = '#8f8076'; g.font = '10px sans-serif'; g.textBaseline = 'middle';
  g.textAlign = 'right';
  g.fillText(`${Math.round(zmax)} м`, padL - 4, Y(zmax)); g.fillText(`${Math.round(zmin)} м`, padL - 4, Y(zmin));
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText('0 км', padL, H - 5);
  g.textAlign = 'right'; g.fillText(`${maxKm.toFixed(1)} км`, W - padR, H - 5);
  const gain = sum.ascent_m != null ? `Набір висоти ${Math.round(sum.ascent_m)} м, спуск ${Math.round(sum.descent_m)} м. ` : '';
  $('s-profile-note').textContent = `${gain}Висоти — з DEM CTX (клітинки ≈ 78 м), тому дрібні перепади згладжено. Колір лінії — ухил.`;
}

function routeLatLngs(res) {
  return res.route.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
}

function drawRoute(res) {
  if (routeLine) map.removeLayer(routeLine);
  routeLine = L.polyline(routeLatLngs(res), { color: '#5ad1ff', weight: 4, opacity: 0.95 }).addTo(map);
}

function renderSummary(res, limit) {
  const s = res.summary;
  const workH = state.stops.reduce((a, t) => a + (t.minutes || 0), 0) / 60;
  const total = s.time_h + workH;
  $('s-dist').textContent = `${s.distance_km} км`;
  $('s-walk').textContent = fmtH(s.time_h);
  $('s-work').textContent = fmtH(workH);
  $('s-slope').textContent = `${s.max_slope_deg}°`;
  $('s-dose').textContent = `${s.radiation_dose_msv} мЗв`;
  $('s-total').textContent = `${fmtH(total)} з ${limit}:00`;
  const bar = $('s-bar');
  const frac = total / limit;
  bar.style.width = `${Math.min(frac, 1) * 100}%`;
  bar.className = frac > 1 ? 'over' : frac > 0.8 ? 'warn' : '';
  const warnings = [...res.warnings];
  if (frac > 1) warnings.push(`Разом з роботами вихід триває ${fmtH(total)} і перевищує ліміт ${limit} год`);
  $('warnings').innerHTML = warnings.map((w) => `<li>${w}</li>`).join('');
  $('data-source').textContent = res.data_source === 'fake'
    ? 'Маршрут побудовано на тестових ухилах. Коли команда додасть справжню сітку в grid/, він стане реальним.' : '';
  $('summary').hidden = false;
  drawProfile(s);
}

// ---------------------------------------------------------------------------
// Вихід (HUD-симуляція)
// ---------------------------------------------------------------------------
const walkLayer = L.layerGroup();

function prepareWalk() {
  const path = routeLatLngs(state.route);
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + marsDistance(path[i - 1], path[i]));

  // Положення кожної цілі на маршруті (шукаємо по черзі вперед)
  const cps = [];
  let from = 0;
  for (const stop of state.stops) {
    let best = from, bestD = Infinity;
    for (let i = from; i < path.length; i++) {
      const d = marsDistance(path[i], [stop.lat, stop.lon]);
      if (d < bestD) { bestD = d; best = i; }
    }
    cps.push({ stop, s: cum[best], latlng: path[best] });
    from = best;
  }

  walkLayer.clearLayers();
  const astro = L.marker(path[0], { icon: L.divIcon({ className: '', html: '<div class="marker-astro"></div>', iconSize: [16, 16] }) });
  const circle = L.circle(path[0], { radius: marsCircleRadius(5), color: '#5ad1ff', weight: 1, fillOpacity: 0.12 });
  circle.addTo(walkLayer);
  astro.addTo(walkLayer);

  state.walk = {
    path, cum, total: cum[cum.length - 1], cps, next: 0,
    s: 0, elapsed: 0, lastFix: 0, sigma: 5,
    running: false, paused: false, astro, circle,
    speed: state.site.eva.speed_kmh / 3.6,     // м/с
    limit: state.site.eva.max_h * 3600,        // с
  };
  map.setView(path[0], 13);
  updateHud();
}

function positionAt(w, s) {
  let i = w.cum.findIndex((c) => c >= s);
  if (i <= 0) return w.path[Math.max(i, 0)];
  const k = (s - w.cum[i - 1]) / (w.cum[i] - w.cum[i - 1] || 1);
  const a = w.path[i - 1], b = w.path[i];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

let lastTick = performance.now();
function tick(now) {
  const dtReal = Math.min((now - lastTick) / 1000, 0.1);
  lastTick = now;
  const w = state.walk;
  if (w && w.running && !w.paused) {
    const dt = dtReal * Number($('hud-speed').value);
    w.elapsed += dt;
    w.s = Math.min(w.s + w.speed * dt, w.total);
    w.sigma = 5 + 0.03 * (w.s - w.lastFix);   // похибка росте ~3 % від пройденого
    const cp = w.cps[w.next];
    if (cp && w.s >= cp.s) { w.s = cp.s; showCheckpoint(cp); }
    if (w.s >= w.total) finishWalk();
    const pos = positionAt(w, w.s);
    w.astro.setLatLng(pos);
    w.circle.setLatLng(pos).setRadius(marsCircleRadius(w.sigma));
    map.panTo(pos, { animate: false });
    updateHud();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function updateHud() {
  const w = state.walk;
  if (!w) return;
  const pos = positionAt(w, w.s);
  const cp = w.cps[w.next];
  const target = cp ? cp.latlng : w.path[w.path.length - 1];
  const along = (cp ? cp.s : w.total) - w.s;
  $('hud-next').textContent = cp ? `${w.next + 1} · ${cp.stop.name}` : 'База';
  $('hud-next-dist').textContent = `${fmtDist(along)} по маршруту`;
  $('hud-arrow').style.transform = `rotate(${bearing(pos, target)}deg)`;
  $('hud-elapsed').textContent = fmtH(w.elapsed / 3600);
  const left = w.limit - w.elapsed;
  const workLeft = w.cps.slice(w.next).reduce((a, c) => a + (c.stop.minutes || 0) * 60, 0);
  const need = (w.total - w.s) / w.speed + workLeft;
  $('hud-left').textContent = left > 0 ? fmtH(left / 3600) : 'ВИЧЕРПАНО';
  $('hud-need').textContent = fmtH(need / 3600);
  $('hud-sigma').textContent = `± ${Math.round(w.sigma)} м`;
  $('hud-done').textContent = `${(w.s / 1000).toFixed(2)} км`;
  const res = $('hud-res');
  res.style.width = `${Math.max(0, left / w.limit) * 100}%`;
  res.className = need > left ? 'over' : need > left * 0.85 ? 'warn' : '';

  const alerts = [];
  if (need > left) alerts.push('Не встигаєш: пропусти зупинки і повертайся на базу');
  else if (need > left * 0.85) alerts.push('Запас часу менше 15 % — не затримуйся');
  if (w.sigma > 150) alerts.push('Невпевнена позиція — йди до найближчого орієнтира');
  $('hud-alert').hidden = !alerts.length;
  $('hud-alert').textContent = alerts.join(' · ');
}

function showCheckpoint(cp) {
  const w = state.walk;
  w.paused = true;
  $('cp-name').textContent = cp.stop.name;
  $('cp-task').textContent = `${cp.stop.task || ''}${cp.stop.minutes ? ` (≈ ${cp.stop.minutes} хв)` : ''}`;
  $('cp-photo').innerHTML = cp.stop.photo
    ? `<img src="${cp.stop.photo}" alt="Фото Perseverance">`
    : '<div class="ph">Фото з поверхні для цієї точки ще не додане.<br>Додай посилання на кадр з raw images у поле "photo" в targets.json</div>';
  $('checkpoint').hidden = false;
}

$('cp-confirm').addEventListener('click', () => {
  const w = state.walk;
  const cp = w.cps[w.next];
  w.elapsed += (cp.stop.minutes || 0) * 60;   // час роботи на зупинці
  w.sigma = 5;
  w.lastFix = w.s;
  w.next += 1;
  w.paused = false;
  $('checkpoint').hidden = true;
  updateHud();
});

function finishWalk() {
  const w = state.walk;
  w.running = false;
  $('hud-play').textContent = '▶ Старт';
  const ok = w.elapsed <= w.limit;
  toast(ok ? `Вихід завершено за ${fmtH(w.elapsed / 3600)}. Екіпаж на базі.`
    : `Вихід завершено, але ліміт перевищено (${fmtH(w.elapsed / 3600)}).`, 8000);
}

$('hud-play').addEventListener('click', () => {
  const w = state.walk;
  if (!w) return;
  if (w.s >= w.total) prepareWalk();
  state.walk.running = !state.walk.running;
  $('hud-play').textContent = state.walk.running ? '❚❚ Пауза' : '▶ Старт';
});
$('hud-restart').addEventListener('click', () => {
  $('checkpoint').hidden = true;
  prepareWalk();
  $('hud-play').textContent = '▶ Старт';
});

// ---------------------------------------------------------------------------
// Режими
// ---------------------------------------------------------------------------
async function setMode(mode) {
  if (mode !== 'briefing' && !state.routing) {
    toast(state.routingReason, 7000);
    return;
  }
  if (mode === 'walk' && !state.route) {
    if (!state.stops.length) setDefaultStops();
    toast('Будую маршрут для виходу…', 2000);
    if (!(await buildRoute())) return;
  }
  document.body.className = `mode-${mode}`;
  document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));

  if (mode === 'plan') planLayer.addTo(map); else map.removeLayer(planLayer);
  if (mode === 'walk') {
    walkLayer.addTo(map);
    prepareWalk();
    $('hud-play').textContent = '▶ Старт';
  } else {
    map.removeLayer(walkLayer);
    if (state.walk) state.walk.running = false;
    $('checkpoint').hidden = true;
  }
  if (mode === 'briefing' || mode === 'plan') map.fitBounds(evaBounds(state.site.eva_bbox), { padding: [40, 40] });
  // у плануванні цілі показує planLayer, тож загальний шар цілей ховаємо, щоб не дублювати
  const t = layerRegistry.find((l) => l.id === 'targets');
  if (t && t.visible) { if (mode === 'briefing') t.layer.addTo(map); else map.removeLayer(t.layer); }
}

document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.goto)));
$('btn-default').addEventListener('click', setDefaultStops);
$('btn-clear').addEventListener('click', () => { state.stops = []; clearRoute(); renderStops(); });
$('btn-route').addEventListener('click', buildRoute);

// ---------------------------------------------------------------------------
// Старт
// ---------------------------------------------------------------------------
(async function init() {
  addBaseLayer();
  document.title = `Marswalk — ${CFG.name}`;
  $('site-name').textContent = CFG.name;
  $('site-subtitle').textContent = CFG.subtitle || '';
  state.site = { ...CFG, eva_bbox: CFG.view_bbox };
  map.fitBounds(evaBounds(CFG.view_bbox), { padding: [40, 40] });

  let grid = null;
  try {
    grid = await getJSON(`${API}/api/${SITE_ID}/grid`);
  } catch (e) {
    state.routingReason = 'Немає зв\'язку з бекендом. Запусти його: cd backend → uvicorn main:app --reload';
  }

  if (grid) {
    state.routing = true;
    if (state.routing) {
      state.site.eva_bbox = grid.bbox;
      state.site.eva = { ...CFG.eva, max_h: grid.max_eva_h ?? CFG.eva.max_h, speed_kmh: grid.speed_kmh ?? CFG.eva.speed_kmh };
      if (grid.data_source === 'fake') state.site.note = 'Маршрути зараз будуються на тестових ухилах бекенду.';
      addEvaArea(grid.bbox);
      map.fitBounds(evaBounds(grid.bbox), { padding: [40, 40] });
    }
  }
  if (!state.routing) {
    state.site.note = state.routingReason;
    document.querySelectorAll('#modes [data-mode="plan"], #modes [data-mode="walk"]').forEach((b) => { b.disabled = true; });
  }

  if (state.routing) {
    // Цілі: з public/data/<site>/targets.json через бекенд, інакше — тестові точки бекенду
    state.targets = await getJSON(`${API}/api/${SITE_ID}/targets`).catch(() => null);
    if (!state.targets) {
      const def = await getJSON(`${API}/api/${SITE_ID}/route/default`).catch(() => null);
      const wps = def?.summary?.waypoints || [];
      if (wps.length) {
        state.targets = {
          habitat: { name: 'База', lat: wps[0][1], lon: wps[0][0] },
          targets: wps.slice(1, -1).map(([lon, lat], i) => ({ name: `Ціль ${i + 1}`, lat, lon, minutes: 20, task: 'Тестова ціль з бекенду' })),
        };
      }
    }
  }
  if (!state.targets) {
    state.targets = { habitat: { name: 'База', lat: CFG.center[0], lon: CFG.center[1] }, targets: [] };
  } else {
    addTargetsLayer(state.targets);
  }
  await addTeamLayers();

  renderBriefing();
  if (state.routing) setDefaultStops();
})();

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------------------------------------------------------------------------
// Налаштування
// ---------------------------------------------------------------------------
const MARS_RADIUS_M = 3389500;          // середній радіус Марса, м
const DEFAULT_MIN_M = -8200;            // приблизний мінімум MOLA (Еллада)
const DEFAULT_MAX_M = 21200;            // приблизний максимум MOLA (Олімп)
const SEGMENTS_W = 512;                 // деталізація сфери (більше = гладкіший рельєф)
const SEGMENTS_H = 256;

// Місця на глобусі. lon: східна довгота в діапазоні -180..180.
const SITES = [
  {
    id: 'jezero',
    name: 'Кратер Jezero',
    lat: 18.38, lon: 77.58,
    radiusKm: 22.5,          // діаметр кратера ~45 км
    status: 'active',
    desc: 'Давнє озеро з річковою дельтою. Тут працює Perseverance, а на поверхні лежить депо зразків Three Forks. Мета виходу: дослідити породи дельти і забрати пробірки.',
  },
  {
    id: 'gale',
    name: 'Кратер Гейл',
    lat: -5.4, lon: 137.8,
    status: 'soon',
    desc: 'Гора Шарп і boxwork-утворення, які досліджує Curiosity.',
  },
  {
    id: 'olympus',
    name: 'Гора Олімп',
    lat: 18.65, lon: -133.8,
    status: 'soon',
    desc: 'Найвищий вулкан Сонячної системи.',
  },
  {
    id: 'valles',
    name: 'Долина Марінер',
    lat: -13.9, lon: -59.2,
    status: 'soon',
    desc: 'Система каньйонів завдовжки близько 4000 км.',
  },
];

// ---------------------------------------------------------------------------
// Координати: широта/довгота <-> точка на сфері.
// Відповідає UV-розгортці THREE.SphereGeometry та еквідистантній
// (equirectangular) текстурі, де лівий край = -180°, правий = +180°.
// ---------------------------------------------------------------------------
function latLonToVector3(lat, lon, radius = 1) {
  const u = (lon + 180) / 360;
  const phi = u * Math.PI * 2;
  const theta = (90 - lat) * Math.PI / 180;
  return new THREE.Vector3(
    -radius * Math.cos(phi) * Math.sin(theta),
    radius * Math.cos(theta),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function vector3ToLatLon(v) {
  const n = v.clone().normalize();
  const lat = Math.asin(THREE.MathUtils.clamp(n.y, -1, 1)) * 180 / Math.PI;
  let phi = Math.atan2(n.z, -n.x);
  if (phi < 0) phi += Math.PI * 2;
  const lon = (phi / (Math.PI * 2)) * 360 - 180;
  return { lat, lon };
}

function formatLatLon(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns}  ${Math.abs(lon).toFixed(2)}°${ew}`;
}

// ---------------------------------------------------------------------------
// Сцена
// ---------------------------------------------------------------------------
const container = document.getElementById('globe');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, 0.6, 3.4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.04;  // інерція після руху мишкою
controls.enablePan = false;
controls.minDistance = 1.03;   // ~100 км над поверхнею
controls.maxDistance = 8;
controls.rotateSpeed = 0.3;
controls.zoomSpeed = 0.6;
controls.autoRotate = false;  // автообертання робимо самі, без інерції OrbitControls (див. updateAutoRotate)

let interacting = false;          // користувач зараз тягне або крутить коліщатко
let hoveringLabel = false;        // курсор на мітці місця
let lastInteraction = -Infinity;  // коли користувач востаннє щось робив

// Світло прив'язане до камери, щоб видима сторона завжди була освітлена,
// але збоку, щоб рельєф давав тіні.
scene.add(new THREE.AmbientLight(0xffffff, 0.25));
const sun = new THREE.DirectionalLight(0xfff1e0, 2.2);
sun.position.set(-2.5, 1.5, 2);
camera.add(sun);
scene.add(camera);

addStars();

// ---------------------------------------------------------------------------
// Текстури: справжні дані з textures/ або згенеровані, якщо їх немає
// ---------------------------------------------------------------------------
const loader = new THREE.TextureLoader();
const loadTex = (url) => loader.loadAsync(url).catch(() => null);
const loadJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

const [colorTexFile, heightTexFile, meta] = await Promise.all([
  loadTex('textures/mars_color.jpg'),
  loadTex('textures/mars_height.png'),
  loadJson('textures/meta.json'),
]);

let colorTex = colorTexFile;
let heightTex = heightTexFile;
let heightImage = heightTexFile ? heightTexFile.image : null;

if (!colorTex || !heightTex) {
  document.getElementById('demo-banner').hidden = false;
  const demo = makeProceduralTextures(1024, 512);
  colorTex = colorTex || demo.color;
  if (!heightTex) {
    heightTex = demo.height;
    heightImage = demo.heightCanvas;
  }
}
colorTex.colorSpace = THREE.SRGBColorSpace;
colorTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

const minM = meta?.min_m ?? DEFAULT_MIN_M;
const maxM = meta?.max_m ?? DEFAULT_MAX_M;
const heightSampler = makeHeightSampler(heightImage);

// ---------------------------------------------------------------------------
// Глобус
// ---------------------------------------------------------------------------
const globeMaterial = new THREE.MeshStandardMaterial({
  map: colorTex,
  displacementMap: heightTex,
  bumpMap: heightTex,
  roughness: 1,
  metalness: 0,
});
const globe = new THREE.Mesh(new THREE.SphereGeometry(1, SEGMENTS_W, SEGMENTS_H), globeMaterial);
scene.add(globe);

let exaggeration = 10;

// Висота точки в метрах -> зміщення по нормалі в одиницях радіуса:
// offset = exag * (min + h * (max - min)) / R  =  h * scale + bias
function applyExaggeration(exag) {
  exaggeration = exag;
  globeMaterial.displacementScale = (exag * (maxM - minM)) / MARS_RADIUS_M;
  globeMaterial.displacementBias = (exag * minM) / MARS_RADIUS_M;
  globeMaterial.bumpScale = 1.5;
  updateMarkerPositions();
}

function surfaceRadius(lat, lon) {
  const h = heightSampler(lat, lon); // 0..1
  return 1 + globeMaterial.displacementBias + h * globeMaterial.displacementScale;
}

// ---------------------------------------------------------------------------
// Мітки місць
// ---------------------------------------------------------------------------
const labelsEl = document.getElementById('labels');
const markers = SITES.map((site) => {
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.0025, 16, 16),
    new THREE.MeshBasicMaterial({ color: site.status === 'active' ? 0xff7a3c : 0xbbbbbb }),
  );
  scene.add(dot);

  const el = document.createElement('div');
  el.className = `site-label${site.status === 'active' ? '' : ' soon'}`;
  el.innerHTML = `<div class="name">${site.name}</div><div class="stem"></div>`;
  // Поки курсор на мітці, планета не обертається, щоб мітка не «втікала»
  el.addEventListener('pointerenter', () => { hoveringLabel = true; });
  el.addEventListener('pointerleave', () => { hoveringLabel = false; lastInteraction = performance.now(); });
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    flyToSite(site);
  });
  labelsEl.appendChild(el);

  return { site, dot, el, position: new THREE.Vector3() };
});

function updateMarkerPositions() {
  for (const m of markers) {
    const r = surfaceRadius(m.site.lat, m.site.lon) + 0.004;
    m.position.copy(latLonToVector3(m.site.lat, m.site.lon, r));
    m.dot.position.copy(m.position);
  }
}

const tmp = new THREE.Vector3();
function updateLabels() {
  const camDir = camera.position.clone().normalize();
  for (const m of markers) {
    const facing = m.position.clone().normalize().dot(camDir);
    tmp.copy(m.position).project(camera);
    const x = (tmp.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-tmp.y * 0.5 + 0.5) * window.innerHeight;
    m.el.style.left = `${x}px`;
    m.el.style.top = `${y}px`;
    m.el.classList.toggle('hidden', facing < 0.15);
  }
}

// ---------------------------------------------------------------------------
// Переліт до місця
// ---------------------------------------------------------------------------
let flight = null;

function flyToSite(site, distance = site.radiusKm ? 1.1 : 1.45, duration = 3200) {
  const startDir = camera.position.clone().normalize();
  const endDir = latLonToVector3(site.lat, site.lon).normalize();
  const startDist = camera.position.length();
  flight = {
    q: new THREE.Quaternion().setFromUnitVectors(startDir, endDir),
    startDir, startDist, endDist: distance,
    t0: performance.now(), duration,
    onDone: site ? () => showSitePanel(site) : null,
  };
  controls.enabled = false;
  hideSitePanel();
}

function flyOut() {
  const dir = camera.position.clone().normalize();
  flight = {
    q: new THREE.Quaternion(), startDir: dir,
    startDist: camera.position.length(), endDist: 3.4,
    t0: performance.now(), duration: 2200, onDone: null,
  };
  controls.enabled = false;
  hideSitePanel();
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const identity = new THREE.Quaternion();

function updateFlight(now) {
  if (!flight) return;
  const t = Math.min((now - flight.t0) / flight.duration, 1);
  const k = ease(t);
  const q = identity.clone().slerp(flight.q, k);
  const dir = flight.startDir.clone().applyQuaternion(q);
  const dist = THREE.MathUtils.lerp(flight.startDist, flight.endDist, k);
  camera.position.copy(dir.multiplyScalar(dist));
  camera.lookAt(0, 0, 0);
  if (t >= 1) {
    const done = flight.onDone;
    flight = null;
    controls.enabled = true;
    controls.update();
    if (done) done();
  }
}

// ---------------------------------------------------------------------------
// Панель місця
// ---------------------------------------------------------------------------
const panel = document.getElementById('site-panel');
function showSitePanel(site) {
  document.getElementById('site-name').textContent = site.name;
  document.getElementById('site-coords').textContent = formatLatLon(site.lat, site.lon);
  document.getElementById('site-desc').textContent = site.desc;
  const status = document.getElementById('site-status');
  const open = document.getElementById('site-open');
  if (site.status === 'active') {
    status.textContent = 'Місія доступна';
    open.classList.remove('disabled');
    open.textContent = 'Відкрити карту місії →';
    open.href = `mission.html?site=${site.id}`;
  } else {
    status.textContent = 'Скоро';
    open.classList.add('disabled');
    open.textContent = 'Карта ще не готова';
    open.href = '#';
  }
  panel.hidden = false;
}
function hideSitePanel() { panel.hidden = true; }
document.getElementById('site-back').addEventListener('click', flyOut);

// ---------------------------------------------------------------------------
// Керування
// ---------------------------------------------------------------------------
const exagInput = document.getElementById('exag');
const exagValue = document.getElementById('exag-value');
exagInput.addEventListener('input', () => {
  exagValue.textContent = `${exagInput.value}×`;
  applyExaggeration(Number(exagInput.value));
});

// Автообертання: планета крутиться сама, але
//  - поки користувач тягне/наближає — керує тільки він;
//  - після відпускання чекаємо 3 с і плавно розганяємось знову;
//  - якщо планета наближена — стоїть на місці.
controls.addEventListener('start', () => { interacting = true; });
controls.addEventListener('end', () => { interacting = false; lastInteraction = performance.now(); });

const AUTO_ROTATE_SPEED = 0.0125;   // рад/с (повний оберт ≈ 8 хв)
const AUTO_ROTATE_DELAY = 3000;     // мс бездіяльності до автообертання
const AUTO_ROTATE_MIN_ALT = 1.2;    // ближче цього (у радіусах над поверхнею) — не обертаємо
const Y_AXIS = new THREE.Vector3(0, 1, 0);

// Повертаємо камеру навколо осі планети напряму, а не через autoRotate:
// так обертання не накопичує інерцію і зупиняється миттєво, щойно користувач торкнувся.
function updateAutoRotate(now, alt, dt) {
  const idle = now - lastInteraction - AUTO_ROTATE_DELAY;
  const allowed = !interacting && !hoveringLabel && !flight && panel.hidden && alt > AUTO_ROTATE_MIN_ALT && idle > 0;
  if (!allowed) return;
  const ramp = THREE.MathUtils.clamp(idle / 2000, 0, 1);  // плавний розгін протягом 2 с
  camera.position.applyAxisAngle(Y_AXIS, -AUTO_ROTATE_SPEED * ramp * dt);
}

// Координати під курсором: зручно перевірити, що текстура лягла правильно
// (навівши на Jezero, маєш побачити приблизно 18.4°N 77.6°E).
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const coordsEl = document.getElementById('coords');
renderer.domElement.addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  const hit = raycaster.intersectObject(globe)[0];
  if (hit) {
    const { lat, lon } = vector3ToLatLon(hit.point);
    const elev = minM + heightSampler(lat, lon) * (maxM - minM);
    coordsEl.textContent = `${formatLatLon(lat, lon)}   висота ≈ ${(elev / 1000).toFixed(1)} км`;
  } else {
    coordsEl.textContent = 'наведи на планету';
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Посилання виду index.html#jezero одразу летить до місця
const hashSite = SITES.find((s) => s.id === location.hash.slice(1));

// ---------------------------------------------------------------------------
// Запуск
// ---------------------------------------------------------------------------
applyExaggeration(exaggeration);
document.getElementById('loading').classList.add('done');
if (hashSite) setTimeout(() => flyToSite(hashSite), 400);

let lastFrame = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  updateFlight(now);
  if (!flight) {
    // Чим ближче до поверхні, тим повільніше обертання від мишки,
    // інакше біля поверхні планета «пролітає» під курсором.
    const alt = camera.position.length() - 1;
    controls.rotateSpeed = 0.3 * THREE.MathUtils.clamp(alt / 2.4, 0.04, 1);
    updateAutoRotate(now, alt, dt);
    controls.update();
  }
  updateLabels();
  renderer.render(scene, camera);
});

// ===========================================================================
// Допоміжне
// ===========================================================================
function makeHeightSampler(image) {
  if (!image) return () => 0.5;
  const w = Math.min(image.width, 4096);
  const h = Math.round(w / 2);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  return (lat, lon) => {
    const x = Math.min(w - 1, Math.max(0, Math.floor(((lon + 180) / 360) * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * h)));
    return data[(y * w + x) * 4] / 255;
  };
}

function addStars() {
  const n = 4000;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(40 + Math.random() * 20);
    pos.set([v.x, v.y, v.z], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.08, sizeAttenuation: true })));
}

function addAtmosphere() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    uniforms: { color: { value: new THREE.Color(0xff8a4a) } },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        float rim = pow(1.0 - abs(dot(vNormal, vView)), 3.0);
        gl_FragColor = vec4(color, rim * 0.6);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.06, 64, 64), material));
}

// Згенерований «марсоподібний» рельєф, щоб сайт працював і без даних.
// Шум рахується на сфері (3D), тому немає шва на 180°.
function makeProceduralTextures(w, h) {
  const hash = (x, y, z) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise3 = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
    let v = 0;
    for (let dx = 0; dx <= 1; dx++)
      for (let dy = 0; dy <= 1; dy++)
        for (let dz = 0; dz <= 1; dz++) {
          const wgt = (dx ? xf : 1 - xf) * (dy ? yf : 1 - yf) * (dz ? zf : 1 - zf);
          v += wgt * hash(xi + dx, yi + dy, zi + dz);
        }
    return v;
  };

  const heights = new Float32Array(w * h);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) / h) * 180;
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * 360 - 180;
      const p = latLonToVector3(lat, lon);
      let v = 0, amp = 1, freq = 1.5;
      for (let o = 0; o < 6; o++) {
        v += amp * noise3(p.x * freq + 10, p.y * freq + 10, p.z * freq + 10);
        amp *= 0.5;
        freq *= 2.1;
      }
      heights[y * w + x] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }

  const colorCanvas = document.createElement('canvas');
  const heightCanvas = document.createElement('canvas');
  colorCanvas.width = heightCanvas.width = w;
  colorCanvas.height = heightCanvas.height = h;
  const cImg = colorCanvas.getContext('2d').createImageData(w, h);
  const hImg = heightCanvas.getContext('2d').createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const t = (heights[i] - lo) / (hi - lo);
    const g = Math.round(t * 255);
    hImg.data.set([g, g, g, 255], i * 4);
    const r = 90 + t * 130, gg = 40 + t * 75, b = 25 + t * 40;
    cImg.data.set([r, gg, b, 255], i * 4);
  }
  colorCanvas.getContext('2d').putImageData(cImg, 0, 0);
  heightCanvas.getContext('2d').putImageData(hImg, 0, 0);

  return {
    color: new THREE.CanvasTexture(colorCanvas),
    height: new THREE.CanvasTexture(heightCanvas),
    heightCanvas,
  };
}

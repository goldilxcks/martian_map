/* Налаштування локацій для фронтенду.
 *
 * Тут лише те, що потрібно сторінці: назва, опис, де показати карту і які шари підключити.
 * Маршрут, цілі та сітка ухилів приходять з бекенду (/api/<site>/grid, /targets, /route).
 *
 * layers — файли шарів, які готує команда даних. Шлях відносно папки app/.
 *   type: 'geojson' | 'image'
 *   styleBy: властивість GeoJSON, за якою розфарбувати точки (легенда створиться сама)
 *   bbox (для image): [lat_min, lon_min, lat_max, lon_max]
 * Якщо файлу ще немає, шар просто не з'явиться.
 */
window.SITES_CONFIG = {
  jezero: {
    name: 'Кратер Jezero',
    subtitle: 'Давнє озеро і річкова дельта',
    center: [18.42, 77.48],
    view_bbox: [18.20, 77.20, 18.65, 77.80],
    objective: 'Дослідити породи давньої дельти, де вода відкладала осад, і забрати пробірки зі зразками з депо Perseverance. Повернутися на базу до вичерпання ліміту виходу.',
    eva: { max_h: 6, crew: 2, speed_kmh: 2.5 },
    layers: [
      {
        id: 'aqueous_minerals', name: 'Водні мінерали', type: 'geojson', group: 'science',
        url: '../public/data/jezero/aqueous_minerals.geojson', styleBy: 'class',
      },
      {
        id: 'slope', name: 'Ухили (заборонені зони)', type: 'image', group: 'safety',
        url: '../public/data/jezero/slope.png',
        bbox: [18.211027, 77.160465, 18.721195, 77.698975], opacity: 0.75,
        legend: [['#ffdc3c', '10–18°'], ['#ff8c28', '18–25°'], ['#e62828', 'заборонено для маршруту']],
      },
    ],
  },
  sharp: {
    name: 'Гора Шарп',
    subtitle: 'Шаруваті осадові породи в кратері Гейл',
    center: [-5.085, 137.845],
    view_bbox: [-5.25, 137.65, -4.92, 138.03],
    objective: 'Дослідити boxwork — сітку мінеральних жил, які утворилися, коли підземна вода текла тріщинами в породі. Порівняти шари на різних висотах і повернутися на базу в межах ліміту виходу.',
    eva: { max_h: 6, crew: 2, speed_kmh: 2.5 },
    layers: [
      {
        id: 'gale_minerals', name: 'Водні мінерали', type: 'geojson', group: 'science',
        url: '../public/data/sharp/gale_minerals.geojson', styleBy: 'class',
      },
      {
        id: 'gale_landmarks', name: 'Орієнтири Gale', type: 'geojson', group: 'base',
        url: '../public/data/sharp/gale_landmarks.geojson', color: '#f2c14e',
      },
    ],
  },
};

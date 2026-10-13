'use strict';

/* ================= Константы ================= */
const GAME_STATUSES = ['В библиотеке', 'Хочу поиграть', 'Играю', 'Прошёл', 'Бросил'];
const PROJECT_STATUSES = ['Идея', 'В работе', 'Завершён', 'На паузе'];
const STATUS_COLORS = {
  'В библиотеке': '#7d8aa8', 'Хочу поиграть': '#f0b34a', 'Играю': '#c8f542', 'Прошёл': '#5fd68a', 'Бросил': '#e0645c',
  'Идея': '#f0b34a', 'В работе': '#6cb6ff', 'Завершён': '#5fd68a', 'На паузе': '#8b8b96',
};
const GAME_FIELDS = [
  { key: 'name', label: 'Название', type: 'text', required: true },
  { key: 'genre', label: 'Жанр / платформа', type: 'text' },
  { key: 'status', label: 'Статус', type: 'choice', options: GAME_STATUSES },
  { key: 'hours', label: 'Наиграно часов', type: 'number' },
  { key: 'rating', label: 'Оценка', type: 'range', min: 0, max: 10, suffix: '/10' },
  { key: 'notes', label: 'Заметки', type: 'long' },
  { key: 'tags', label: 'Метки (через запятую)', type: 'tags' },
  { key: 'process', label: 'Процесс для авто-учёта времени (.exe)', type: 'text' },
];
const PROJECT_FIELDS = [
  { key: 'name', label: 'Название', type: 'text', required: true },
  { key: 'notes', label: 'Описание', type: 'long' },
  { key: 'tech', label: 'Технологии (через запятую)', type: 'text' },
  { key: 'status', label: 'Статус', type: 'choice', options: PROJECT_STATUSES },
  { key: 'progress', label: 'Прогресс', type: 'range', min: 0, max: 100, suffix: '%' },
  { key: 'path', label: 'Папка проекта', type: 'folder' },
  { key: 'link', label: 'Ссылка (GitHub / сайт)', type: 'text' },
];
const PAGE_SIZE = 60;

/* ================= Утилиты ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isNaN(n) ? 0 : n; };
const fmtH = (v) => String(Math.round(num(v) * 10) / 10);
const hueOf = (s) => { let x = 0; for (const ch of s || '') x = (x * 31 + ch.charCodeAt(0)) % 360; return x; };

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

/* Иконки: линейные, одной толщины. Пути статичные, пользовательских данных в них нет. */
const ICONS = {
  home: '<path d="M3 11l9-7.5L21 11"/><path d="M5.5 9.5V20h13V9.5"/>',
  gamepad: '<path d="M6 8.5h12a4 4 0 0 1 4 4v1.5a3 3 0 0 1-5.2 2L15 14H9l-1.8 2A3 3 0 0 1 2 14v-1.5a4 4 0 0 1 4-4z"/><path d="M7.5 11v3M6 12.5h3"/><circle cx="16" cy="12" r=".6"/><circle cx="18" cy="13.5" r=".6"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.2h8.5A1.5 1.5 0 0 1 21 8.7V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none"/>',
  chart: '<path d="M4 4v16h16"/><path d="M8 15l3.5-4.5 3 2.5L19 7"/>',
  edit: '<path d="M4 20h4L19.5 8.5a1.9 1.9 0 0 0 0-2.7l-1.3-1.3a1.9 1.9 0 0 0-2.7 0L4 16z"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.8 12.5h9.4L17.5 7"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-3.6M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 3.6M20 20v-4h-4"/>',
  layers: '<path d="M12 3.5l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r=".8"/><circle cx="12" cy="12" r=".8"/><circle cx="15" cy="15" r=".8"/>',
  list: '<path d="M4 7l2 2 3-3.5M4 16l2 2 3-3.5M12.5 8h7.5M12.5 17h7.5"/>',
  code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12"/>',
  terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M7 10l3 2-3 2M12.5 15h4"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14"/>',
  bars: '<path d="M5 20v-9M12 20V4M19 20v-6"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.6M12 18.4V21M3 12h2.6M18.4 12H21M5.6 5.6l1.9 1.9M16.5 16.5l1.9 1.9M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9"/>',
};
function ico(name, size = 16) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}
const tbtn = (icon, label, onclick, cls = '', title = '') =>
  h('button', { class: `tbtn ${cls}`, title: title || label || null, onclick }, icon && ico(icon, 14), label || null);

function toast(text, kind = '') {
  const el = h('div', { class: `toast ${kind}` }, text);
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 4200);
}

/* ================= API (pywebview или заглушка для браузера) ================= */
const api = new Proxy({}, { get: (_, name) => (...args) => window.pywebview.api[name](...args) });

function installMockApi() {
  const KEY = 'hub-mock';
  const read = () => JSON.parse(localStorage.getItem(KEY) || '{"games":[],"projects":[]}');
  const demo = [
    { appid: '1245620', name: 'ELDEN RING', hours: 112.4 }, { appid: '1145360', name: 'Hades', hours: 41.7 },
    { appid: '292030', name: 'The Witcher 3: Wild Hunt', hours: 203 }, { appid: '570', name: 'Dota 2', hours: 880.5 },
  ];
  window.pywebview = { api: {
    load: async () => ({ data: read(), settings: { steamid: '', has_key: false, last_sync: '' }, tools: { code: true, git: true }, prefs: { break_hours: 2, day_limit_hours: 0, notify: true, steam_autosync: true, discount_alert: 50 } }),
    save_data: async (d) => { localStorage.setItem(KEY, JSON.stringify(d)); return true; },
    pick_folder: async () => 'C:\\demo\\folder', open_path: async () => true, open_link: async () => true,
    launch_steam: async () => true, detect_steam_user: async () => '76561198000000000',
    save_steam_settings: async (k, id) => ({ steamid: id, has_key: !!k }),
    forget_steam_key: async () => true,
    steam_import: async () => {
      const d = read();
      demo.forEach((g) => { if (!d.games.some((x) => x.appid === g.appid)) d.games.push({ ...g, id: uid(), genre: 'Steam', status: g.hours > 100 ? 'Играю' : 'В библиотеке', rating: 0, notes: '', source: 'steam', installed: g.hours > 100 }); });
      localStorage.setItem(KEY, JSON.stringify(d));
      return { ok: true, data: d, added: demo.length, updated: 0 };
    },
    steam_scan_local: async () => ({ ok: false, error: 'В режиме браузера недоступно.' }),
    get_tracking: async () => JSON.parse(localStorage.getItem('hub-mock-track') || '{"tracking":{},"running":[]}'),
    get_catalog: async () => [
      { key: 'minecraft_java', name: 'Minecraft: Java Edition', genre: 'Песочница · Java', hue: 118, process: 'javaw.exe', process_cmd: 'minecraft', template: 'minecraft', edition: 'java', installed: true },
      { key: 'osu', name: 'osu!', genre: 'Ритм-игра', hue: 330, process: 'osu!.exe', process_cmd: '', template: 'osu', edition: '', installed: true },
      { key: 'roblox', name: 'Roblox', genre: 'Платформа игр', hue: 0, process: 'RobloxPlayerBeta.exe', process_cmd: '', template: 'roblox', edition: '', installed: false },
      { key: 'valorant', name: 'VALORANT', genre: 'Тактический шутер', hue: 350, process: 'VALORANT-Win64-Shipping.exe', process_cmd: '', template: 'valorant', edition: '', installed: false },
    ],
    steam_achievements: async (appid) => ({ ok: true, unlocked: 3, total: 6, items: [
      { id: 'a', name: 'Первый шаг', desc: 'Начни игру', achieved: true, time: 1790000000, icon: '', icon_gray: '', percent: 91.2, hidden: false },
      { id: 'b', name: 'Босс', desc: 'Победи первого босса', achieved: true, time: 1790500000, icon: '', icon_gray: '', percent: 34.5, hidden: false },
      { id: 'c', name: 'Редкая находка', desc: 'Найди секретную комнату', achieved: true, time: 1790900000, icon: '', icon_gray: '', percent: 2.3, hidden: false },
      { id: 'd', name: 'Мастер', desc: 'Пройди без урона', achieved: false, time: 0, icon: '', icon_gray: '', percent: 1.1, hidden: false },
      { id: 'e', name: 'Секрет', desc: '', achieved: false, time: 0, icon: '', icon_gray: '', percent: 8.0, hidden: true },
      { id: 'f', name: 'Коллекционер', desc: 'Собери всё', achieved: false, time: 0, icon: '', icon_gray: '', percent: 15.4, hidden: false }] }),
    project_scan: async (path) => (path ? { ok: true, name: 'my-game', tech: ['Python', 'Pygame'], description: 'Платформер про кота', files: 40, modified: new Date().toISOString(),
      git: { branch: 'main', dirty: 3, commits: 27, last_message: 'Добавил уровень 2', last_time: Math.floor(Date.now() / 1000) - 86400 * 2, remote: 'https://github.com/me/my-game' } } : { ok: false }),
    open_in_code: async () => true, open_terminal: async () => true,
    export_backup: async () => ({ ok: true, path: 'C:\\backup.zip' }), import_backup: async () => ({ ok: false, cancelled: true }),
    skill_fetch: async (kind) => ({ ok: true, values: kind === 'osu' ? { 'PP': 4720.5, 'Глобальный ранг': 78450, 'Точность, %': 97.12 } : { 'Достижения, %': 54.7, 'Редкие достижения': 3 } }),
    author_projects: async () => ({ ok: true, ts: Date.now() / 1000, repos: [
      { name: 'Lotos-Outer', desc: 'Майнкрафт', lang: 'Java', stars: 0, url: 'https://github.com/Reranyti/Lotos-Outer', homepage: '', updated: '2026-10-01T10:00:00Z', versions: [
        { kind: 'mod', tag: 'v2.0008', title: 'Сложность «Хромо»', asset: 'lotusblight-2.0008.jar, lotuslib-2.0008.jar', url: '', size: 150335580, published: '2026-09-20T10:00:00Z' },
        { kind: 'mod', tag: 'v1.1050', title: '', asset: 'LotusBlight-Pack-1.1050.2.zip', url: '', size: 33052843, published: '2026-07-01T10:00:00Z' }] },
      { name: 'DeltaKind', desc: 'Проект основанный на базе Kristal, Фан игра на дельтарун.', lang: 'Lua', stars: 2, url: 'https://github.com/Reranyti/DeltaKind', homepage: '', updated: '2026-10-10T10:00:00Z', versions: [
        { kind: 'game', tag: '1.4.1', title: 'Attacking_Roating Part 1/5', asset: 'deltakind-0.11.0-dev-win.zip', url: '', size: 56089534, published: '2026-10-05T10:00:00Z' },
        { kind: 'game', tag: '1.4.0', title: 'After_Descripting', asset: 'deltakind-0.11.0-dev-win.zip', url: '', size: 56089534, published: '2026-09-15T10:00:00Z' },
        { kind: 'game', tag: 'v1.1.0', title: 'Save Upgrade', asset: 'deltakind-win.zip', url: '', size: 40000000, published: '2026-03-01T10:00:00Z' }] }] }),
    author_status: async () => ({ installed: window.__mockInstalled || {}, progress: window.__mockProgress || {} }),
    author_install: async () => ({ ok: true }), author_launch: async () => true, author_uninstall: async () => true, reveal_download: async () => true,
    author_support: async () => ({ links: window.__mockSupport || [] }),
    get_meta: async () => ({ rev: 1, pending: 0, meta: window.__mockMeta || {} }), meta_rev: async () => 1,
    set_prefs: async (p) => p, test_notify: async () => true,
    get_wishlist: async () => ({ ts: Date.now() / 1000, items: window.__mockWish || [] }),
    refresh_wishlist: async () => ({ ok: true, ts: Date.now() / 1000, items: window.__mockWish || [], deals: [] }),
    epic_import: async () => ({ ok: false, error: 'В режиме браузера недоступно.' }),
    minecraft_info: async () => ({ found: true, total_hours: 37.5, worlds: [
      { name: 'Выживание 1.21', last: '2026-10-10 21:14', hours: 30.2 }, { name: 'Креатив', last: '2026-09-28 18:02', hours: 7.3 }] }),
  } };
}

/* ================= Состояние ================= */
const state = {
  data: { games: [], projects: [] },
  settings: { steamid: '', has_key: false },
  tracking: {}, running: [], trackSig: '', tools: { code: false, git: false },
  meta: {}, metaRev: -1, metaPending: 0,
  prefs: { break_hours: 0, day_limit_hours: 0, notify: true, steam_autosync: true, discount_alert: 50 },
  page: 'home',
  games: { q: '', status: 'Все', sort: 'new', filter: 'all', limit: PAGE_SIZE, built: false },
  projects: { q: '', status: 'Все', sort: 'new', limit: PAGE_SIZE, built: false },
};
const persist = () => api.save_data(state.data);

/* ================= Обложки Steam: зеркала + повторы ================= */
const STEAM_ART_HOSTS = [
  'https://cdn.cloudflare.steamstatic.com/steam/apps',
  'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps',
  'https://cdn.akamai.steamstatic.com/steam/apps',
];
const failedArt = new Set();

/* Пробует зеркала по очереди; после полного круга ждёт и повторяет. Картинку не удаляем:
   пока она не загрузилась, под ней видна плитка с буквой. */
function loadSteamArt(img, appid, attempt = 0) {
  const hosts = STEAM_ART_HOSTS.length;
  img.dataset.appid = appid;
  img.onload = () => { img.classList.add('loaded'); failedArt.delete(img); };
  img.onerror = () => {
    if (attempt + 1 >= hosts * 3) { failedArt.add(img); return; }
    const endOfRound = (attempt + 1) % hosts === 0;
    setTimeout(() => { if (img.isConnected) loadSteamArt(img, appid, attempt + 1); }, endOfRound ? 5000 : 0);
  };
  img.src = `${STEAM_ART_HOSTS[attempt % hosts]}/${appid}/header.jpg`;
}
window.addEventListener('online', () => {
  const retry = [...failedArt]; failedArt.clear();
  retry.forEach((img) => { if (img.isConnected) loadSteamArt(img, img.dataset.appid); });
});

/* ================= Фон из обложки ================= */
const backdrop = { cur: 0, key: '', hoverTimer: null, leaveTimer: null };

function setBackdrop(g) {
  const key = g ? (g.appid ? `a${g.appid}` : `h${g.hue ?? hueOf(g.name)}`) : '';
  if (key === backdrop.key) return;
  backdrop.key = key;
  const layers = [$('#bg-a'), $('#bg-b')];
  const prev = layers[backdrop.cur], next = layers[1 - backdrop.cur];
  if (!g) { prev.classList.remove('on'); return; }
  const apply = (image) => {
    if (backdrop.key !== key) return; // за время загрузки фон уже сменили
    next.style.backgroundImage = image;
    next.classList.add('on'); prev.classList.remove('on');
    backdrop.cur = 1 - backdrop.cur;
  };
  if (g.appid) {
    const tryHost = (i) => {
      if (i >= STEAM_ART_HOSTS.length) { apply('none'); return; }
      const url = `${STEAM_ART_HOSTS[i]}/${g.appid}/header.jpg`;
      const img = new Image();
      img.onload = () => apply(`url("${url}")`);
      img.onerror = () => tryHost(i + 1);
      img.src = url;
    };
    tryHost(0);
  } else {
    apply(`linear-gradient(150deg, hsl(${g.hue ?? hueOf(g.name)} 40% 24%), #0c0c0e 75%)`);
  }
}

function hoverBackdrop(g) {
  clearTimeout(backdrop.leaveTimer); clearTimeout(backdrop.hoverTimer);
  backdrop.hoverTimer = setTimeout(() => setBackdrop(g), 130);
}
function releaseBackdrop() {
  clearTimeout(backdrop.hoverTimer); clearTimeout(backdrop.leaveTimer);
  backdrop.leaveTimer = setTimeout(() => setBackdrop(state.page === 'projects' ? null : featuredGame()), 500);
}

function featuredGame() {
  const games = state.data.games;
  if (!games.length) return null;
  const live = games.find(isLive);
  if (live) return live;
  const recent = games.filter((g) => lastPlayedMs(g)).sort((a, b) => lastPlayedMs(b) - lastPlayedMs(a));
  return recent[0] || [...games].sort((a, b) => gameHours(b) - gameHours(a))[0];
}

/* ================= Модальные окна ================= */
function openModal(content, cls = '', onClose = null) {
  const root = $('#modal-root');
  const back = h('div', { class: 'backdrop' }, h('div', { class: `modal ${cls}` }, content));
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    document.removeEventListener('keydown', onKey);
    back.classList.remove('open');
    setTimeout(() => back.remove(), 260);
    if (onClose) onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey);
  root.append(back);
  requestAnimationFrame(() => requestAnimationFrame(() => back.classList.add('open')));
  return close;
}

function openForm(title, fields, item = {}) {
  return new Promise((resolve) => {
    const inputs = {}, setters = {};
    const form = h('form', { novalidate: 'true' });
    fields.forEach((f) => {
      const value = item[f.key] ?? '';
      let control;
      if (f.type === 'choice') {
        control = h('select', {}, f.options.map((o) => h('option', { value: o, selected: o === (value || f.options[0]) }, o)));
        inputs[f.key] = () => control.value;
      } else if (f.type === 'long') {
        control = h('textarea', {}); control.value = value;
        inputs[f.key] = () => control.value.trim();
        setters[f.key] = (v) => { control.value = v; };
      } else if (f.type === 'range') {
        const out = h('output', {}, `${Math.round(num(value))}${f.suffix}`);
        const range = h('input', { type: 'range', min: f.min, max: f.max, step: 1, value: Math.round(num(value)),
          oninput: () => { out.textContent = `${range.value}${f.suffix}`; } });
        control = h('div', { class: 'range-row' }, range, out);
        inputs[f.key] = () => Number(range.value);
      } else if (f.type === 'tags') {
        control = h('input', { class: 'input', type: 'text', value: Array.isArray(value) ? value.join(', ') : value, placeholder: 'кооп, с друзьями, расслабляющая' });
        inputs[f.key] = () => control.value.split(',').map((x) => x.trim()).filter(Boolean);
        setters[f.key] = (v) => { control.value = v; };
      } else if (f.type === 'folder') {
        const input = h('input', { class: 'input', type: 'text', value });
        const detect = async () => {
          const info = await api.project_scan(input.value.trim());
          if (!info.ok) { toast('Сначала выберите существующую папку', 'err'); return; }
          const fillIfEmpty = (key, value) => { if (value && setters[key] && !inputs[key]()) setters[key](value); };
          fillIfEmpty('name', info.name); fillIfEmpty('notes', info.description);
          fillIfEmpty('tech', (info.tech || []).join(', ')); fillIfEmpty('link', info.git && info.git.remote);
          toast('Данные проекта определены по папке');
        };
        control = h('div', { class: 'inline' }, input,
          h('button', { type: 'button', class: 'btn ghost', onclick: async () => {
            const folder = await api.pick_folder(); if (folder) { input.value = folder; detect(); }
          } }, 'Обзор'),
          h('button', { type: 'button', class: 'btn ghost', title: 'Заполнить пустые поля по папке: язык, описание, ссылку на git', onclick: detect }, 'Определить'));
        inputs[f.key] = () => input.value.trim();
      } else {
        control = h('input', { class: 'input', type: 'text', value, inputmode: f.type === 'number' ? 'decimal' : null });
        inputs[f.key] = () => control.value.trim();
        setters[f.key] = (v) => { control.value = v; };
      }
      form.append(h('div', { class: 'field' }, h('label', {}, f.label), control));
    });

    let close, resolved = false;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const result = {};
      for (const f of fields) result[f.key] = inputs[f.key]();
      if (!result.name) { toast('Введите название', 'err'); return; }
      resolved = true; close(); resolve(result);
    });
    form.append(h('div', { class: 'modal-actions' },
      h('button', { type: 'button', class: 'btn ghost', onclick: () => close() }, 'Отмена'),
      h('button', { type: 'submit', class: 'btn' }, 'Сохранить')));

    close = openModal([h('h2', {}, title), form]);
    const watcher = setInterval(() => {
      if (!$('#modal-root .backdrop.open')) { clearInterval(watcher); if (!resolved) resolve(null); }
    }, 200);
    setTimeout(() => $('input.input', form)?.focus(), 300);
  });
}

function confirmBox(title, text, label = 'Удалить', tone = 'danger') {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; close(); resolve(v); };
    const close = openModal([
      h('h2', {}, title), h('p', { class: 'lead' }, text),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn ghost', onclick: () => finish(false) }, 'Отмена'),
        h('button', { class: `btn ${tone === 'danger' ? 'danger' : ''}`, onclick: () => finish(true) }, label)),
    ]);
    const watcher = setInterval(() => {
      if (!$('#modal-root .backdrop.open')) { clearInterval(watcher); if (!done) { done = true; resolve(false); } }
    }, 200);
  });
}

/* ================= Навигация ================= */
function show(page) {
  state.page = page;
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active', 'enter'));
  const el = $(`#page-${page}`);
  el.classList.add('active');
  void el.offsetWidth;
  el.classList.add('enter');
  el.scrollTop = 0;
  setBackdrop(page === 'projects' ? null : featuredGame());
  render(true);
}

function render(animate = false) {
  if (state.page === 'home') renderHome();
  else if (state.page === 'stats') renderStats();
  else if (state.page === 'wishlist') renderWishlist();
  else if (state.page === 'author') renderAuthor();
  else renderLibrary(state.page, animate);
  updateSteamChip();
}

function updateSteamChip() {
  const count = state.data.games.filter((g) => g.source === 'steam').length;
  const on = state.settings.has_key || count > 0;
  $('#steam-chip').classList.toggle('on', on);
  $('#steam-chip-text').textContent = on ? `Steam · ${count} игр` : 'Подключить Steam';
  $('#steam-chip').title = state.settings.last_sync ? `Синхронизировано: ${agoText(Date.parse(state.settings.last_sync))}` : '';
}

/* ================= Сводка ================= */
function animateCount(el, target, isFloat) {
  const start = performance.now(), dur = 900;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 3);
    el.textContent = isFloat ? String(Math.round(target * e * 10) / 10) : String(Math.round(target * e));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const statusDot = (status) => h('span', { class: 'st' }, h('i', { style: `background:${STATUS_COLORS[status] || '#8b8b96'}` }), status);

function artEl(g, cls = 'art') {
  const box = h('div', { class: cls });
  box.append(monoTile(g.name, g.hue ?? hueOf(g.name), g.ckey, cls === 'hero-art' ? 72 : 44, 'mono', g.icon));
  if (g.appid) {
    const img = h('img', { alt: '' });
    loadSteamArt(img, g.appid);
    box.append(img);
  }
  return box;
}

function renderHome() {
  const page = $('#page-home');
  const { games, projects } = state.data;
  page.replaceChildren();

  /* герой */
  const hero = featuredGame();
  if (hero) {
    const label = isLive(hero) ? 'Сейчас в игре' : lastPlayedMs(hero) ? `Последняя игра · ${agoText(lastPlayedMs(hero))}` : 'Больше всего времени';
    const art = artEl(hero, 'hero-art');
    const skill = skillBadge(hero);
    page.append(h('div', { class: 'hero' }, art,
      h('div', {},
        h('div', { class: 'eyebrow' }, label),
        h('div', { class: 'hero-title' }, hero.name),
        h('div', { class: 'hero-meta' }, h('span', {}, h('b', {}, fmtH(gameHours(hero))), ' ч'), statusDot(hero.status), skill && h('span', {}, skill.text)),
        h('div', { class: 'hero-actions' },
          hero.appid && h('button', { class: 'btn', onclick: () => { api.launch_steam(hero.appid); toast(`Запуск «${hero.name}» через Steam`); } }, ico('play', 14), 'Играть'),
          h('button', { class: 'btn ghost', onclick: () => openProfile(hero) }, ico('chart', 14), 'Профиль')))));
  } else {
    page.append(h('div', { class: 'hero-empty' }, h('div', { class: 'eyebrow' }, 'Добро пожаловать'),
      h('h2', {}, 'С чего начать'),
      h('p', { class: 'lead' }, 'Соберите свои игры и проекты в одном месте. Любой из трёх вариантов можно комбинировать.'),
      h('div', { class: 'welcome-steps' },
        h('div', { class: 'welcome-step' }, h('b', {}, '1  Библиотека Steam'), h('p', {}, 'Игры, часы, обложки, жанры и скидки на вишлист. Понадобится бесплатный ключ — в окне подскажем, как его получить за минуту.'),
          h('button', { class: 'btn', onclick: openSteamModal }, ico('refresh', 14), 'Подключить Steam')),
        h('div', { class: 'welcome-step' }, h('b', {}, '2  Игры вне Steam'), h('p', {}, 'Minecraft, osu!, Roblox и другие: время считается само, пока игра запущена, а скилл можно отслеживать.'),
          h('button', { class: 'btn ghost', onclick: () => { show('games'); openCatalog(); } }, ico('layers', 14), 'Особые игры')),
        h('div', { class: 'welcome-step' }, h('b', {}, '3  Вручную'), h('p', {}, 'Любая игра или проект: добавьте сами. Проект можно создать из папки: язык и git определятся сами.'),
          h('button', { class: 'btn ghost', onclick: () => { show('games'); addItem('games'); } }, ico('plus', 14), 'Добавить игру'))),
      h('p', { class: 'hint', style: 'margin-top:18px' }, 'Все данные хранятся только на этом компьютере. Приложение обращается лишь к Steam и сайтам игр и ничего никуда не отправляет.')));
  }

  if (hero && !state.settings.has_key && !games.some((g) => g.source === 'steam')) {
    page.append(h('div', { class: 'cta-strip' }, h('div', {}, h('b', {}, 'Steam не подключён'),
      h('p', {}, 'Импорт подтянет игры, часы наигрыша и обложки.')),
    h('button', { class: 'btn', onclick: openSteamModal }, 'Подключить')));
  }

  /* цифры */
  const totalHours = games.reduce((s, g) => s + gameHours(g), 0);
  const stats = [
    ['Игр', games.length, false], ['Пройдено', games.filter((g) => g.status === 'Прошёл').length, false],
    ['Часов', totalHours, true], ['Проектов', projects.length, false],
    ['В работе', projects.filter((p) => p.status === 'В работе').length, false],
  ];
  const statsEl = h('div', { class: 'stats' });
  stats.forEach(([lbl, value, isFloat]) => {
    const n = h('div', { class: 'num' }, '0');
    statsEl.append(h('div', { class: 'stat' }, n, h('div', { class: 'lbl' }, lbl)));
    animateCount(n, value, isFloat);
  });
  page.append(statsEl);

  /* таблицы */
  const bars = [];
  const top = [...games].sort((a, b) => gameHours(b) - gameHours(a)).slice(0, 6);
  const maxH = Math.max(1, ...top.map(gameHours));
  const topBlock = h('div', { class: 'block' }, h('h3', {}, 'Больше всего времени'));
  if (!top.length) topBlock.append(h('div', { class: 'empty' }, 'Данных пока нет'));
  top.forEach((g, i) => {
    const fill = h('i', {}); bars.push([fill, (gameHours(g) / maxH) * 100]);
    topBlock.append(h('div', { class: 'trow' }, h('span', { class: 'idx' }, String(i + 1).padStart(2, '0')),
      h('span', { class: 'nm', title: g.name }, g.name), h('div', { class: 'bar' }, fill), h('span', { class: 'val' }, `${fmtH(gameHours(g))} ч`)));
  });

  const recentGames = games.filter((g) => lastPlayedMs(g)).sort((a, b) => lastPlayedMs(b) - lastPlayedMs(a)).slice(0, 6);
  const recentBlock = h('div', { class: 'block' }, h('h3', {}, 'Недавно играли'));
  if (!recentGames.length) recentBlock.append(h('div', { class: 'empty' }, 'Когда игры запустятся, они появятся здесь'));
  recentGames.forEach((g, i) => recentBlock.append(h('div', { class: 'trow clickable', onclick: () => openProfile(g) },
    h('span', { class: 'idx' }, String(i + 1).padStart(2, '0')), h('span', { class: 'nm', style: 'flex:1', title: g.name }, (isLive(g) ? '● ' : '') + g.name),
    g.recent > 0 && h('span', { class: 'skill' }, `${fmtH(g.recent)} ч за 2 нед.`), h('span', { class: 'skill' }, isLive(g) ? 'сейчас' : agoText(lastPlayedMs(g))))));

  const active = projects.filter((p) => p.status === 'В работе');
  const projBlock = h('div', { class: 'block' }, h('h3', {}, 'Проекты в работе'));
  if (!active.length) projBlock.append(h('div', { class: 'empty' }, 'Активных проектов нет'));
  active.slice(0, 6).forEach((p, i) => {
    const fill = h('i', {}); bars.push([fill, num(p.progress)]);
    projBlock.append(h('div', { class: 'trow' }, h('span', { class: 'idx' }, String(i + 1).padStart(2, '0')),
      h('span', { class: 'nm', title: p.name }, p.name), h('div', { class: 'bar' }, fill), h('span', { class: 'val' }, `${Math.round(num(p.progress))}%`)));
  });

  const perDay = {};
  Object.values(state.tracking).forEach((t) => Object.entries(t.days || {}).forEach(([d, s]) => { perDay[d] = (perDay[d] || 0) + s; }));
  const activity = h('div', { class: 'block' }, h('h3', {}, 'Активность за 14 дней'));
  if (Object.keys(perDay).length) activity.append(daysChart(perDay));
  else activity.append(h('div', { class: 'empty' }, 'Время считается автоматически для игр с указанным процессом. Добавьте игру через «Особые игры» в разделе «Игры».'));

  page.append(h('div', { class: 'grid2' }, recentBlock, topBlock, projBlock, activity));
  setTimeout(() => bars.forEach(([el, pct]) => { el.style.width = `${pct}%`; }), 200);
}

/* ================= Библиотеки (игры / проекты) ================= */
const LIBS = {
  games: {
    eyebrow: 'Библиотека', title: 'Игры', noun: 'игру', fields: GAME_FIELDS, statuses: GAME_STATUSES,
    defaults: { status: 'Хочу поиграть', hours: 0, rating: 0 },
    sorts: [['new', 'Сначала новые'], ['name', 'По названию'], ['hours', 'По часам'], ['rating', 'По оценке']],
  },
  projects: {
    eyebrow: 'Мои работы', title: 'Проекты', noun: 'проект', fields: PROJECT_FIELDS, statuses: PROJECT_STATUSES,
    defaults: { status: 'Идея', progress: 0 },
    sorts: [['new', 'Сначала новые'], ['name', 'По названию'], ['progress', 'По прогрессу']],
  },
};

function renderLibrary(kind, animate) {
  const st = state[kind], page = $(`#page-${kind}`);
  if (!st.built) { buildToolbar(kind); st.built = true; }
  const items = state.data[kind];
  $('.count', page).textContent = kind === 'games'
    ? `${items.length} в списке · ${fmtH(items.reduce((s, g) => s + gameHours(g), 0))} ч всего`
    : `${items.length} в списке`;
  const filterSel = $('.filter-sel', page);
  if (filterSel) st.filter = fillFilterSelect(filterSel, st.filter);
  const triageBtn = $('#btn-triage');
  if (triageBtn) {
    const left = triageQueue().length;
    triageBtn.lastChild.textContent = `Разобрать ${left}`;
    triageBtn.style.display = left ? '' : 'none';
  }
  page.querySelectorAll('.stab').forEach((b) => {
    const s = b.dataset.status;
    $('sup', b).textContent = s === 'Все' ? items.length : items.filter((it) => it.status === s).length;
  });
  renderGrid(kind, animate);
}

function buildToolbar(kind) {
  const cfg = LIBS[kind], st = state[kind], page = $(`#page-${kind}`);
  const actions = h('div', { class: 'head-actions' });
  if (kind === 'games') {
    const unsorted = triageQueue().length;
    actions.append(h('button', { class: 'btn ghost', onclick: openRoulette }, ico('dice', 14), 'Что поиграть?'),
      unsorted > 0 && h('button', { class: 'btn ghost', id: 'btn-triage', onclick: openTriage }, ico('list', 14), `Разобрать ${unsorted}`),
      h('button', { class: 'btn ghost', onclick: openCatalog }, ico('layers', 14), 'Особые игры'),
      h('button', { class: 'btn ghost', onclick: openSteamModal }, ico('refresh', 14), 'Steam'));
  } else {
    actions.append(h('button', { class: 'btn ghost', onclick: projectFromFolder }, ico('folder', 14), 'Из папки'));
  }
  actions.append(h('button', { class: 'btn', onclick: () => addItem(kind) }, ico('plus', 14), `Добавить ${cfg.noun}`));

  const tabs = h('div', { class: 'stabs' });
  ['Все', ...cfg.statuses].forEach((s) => tabs.append(h('button', { class: `stab${s === 'Все' ? ' active' : ''}`, 'data-status': s, onclick: (e) => {
    st.status = s; st.limit = PAGE_SIZE;
    tabs.querySelectorAll('.stab').forEach((t) => t.classList.toggle('active', t === e.currentTarget));
    renderGrid(kind, true);
  } }, s, h('sup', {}, '0'))));

  const search = h('input', { type: 'text', placeholder: 'Поиск', oninput: (e) => { st.q = e.target.value.trim().toLowerCase(); st.limit = PAGE_SIZE; renderGrid(kind, false); } });
  const sort = h('select', { class: 'sort', onchange: (e) => { st.sort = e.target.value; renderGrid(kind, true); } },
    cfg.sorts.map(([v, l]) => h('option', { value: v }, l)));

  page.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', {}, h('div', { class: 'eyebrow' }, cfg.eyebrow), h('h1', {}, cfg.title), h('p', { class: 'sub count' }, '')),
      actions),
    h('div', { class: 'toolbar' }, h('label', { class: 'search' }, ico('search', 15), search), tabs,
      kind === 'games' && h('select', { class: 'sort filter-sel', title: 'Жанр, особенность или ваша метка', onchange: (e) => { st.filter = e.target.value; st.limit = PAGE_SIZE; renderGrid(kind, true); } }),
      sort),
    h('div', { class: 'cards', id: `grid-${kind}` }),
  );
}

function sortedFiltered(kind) {
  const st = state[kind];
  let items = state.data[kind].filter((it) => {
    if (st.status !== 'Все' && it.status !== st.status) return false;
    if (kind === 'games' && !matchFilter(it, st.filter)) return false;
    const extra = kind === 'games' ? `${gameGenres(it).join(' ')} ${gameTags(it).join(' ')}` : '';
    if (st.q && !`${it.name} ${it.genre || ''} ${it.notes || ''} ${it.tech || ''} ${extra}`.toLowerCase().includes(st.q)) return false;
    return true;
  });
  const by = { name: (a, b) => a.name.localeCompare(b.name, 'ru'), hours: (a, b) => gameHours(b) - gameHours(a),
    rating: (a, b) => num(b.rating) - num(a.rating), progress: (a, b) => num(b.progress) - num(a.progress) };
  if (st.sort === 'new') items = items.slice().reverse();
  else items.sort(by[st.sort]);
  return items;
}

function renderGrid(kind, animate) {
  const grid = $(`#grid-${kind}`), st = state[kind], cfg = LIBS[kind];
  grid.classList.toggle('noanim', !animate);
  grid.onmouseleave = kind === 'games' ? releaseBackdrop : null;
  const items = sortedFiltered(kind);
  grid.replaceChildren();
  if (!items.length) {
    const none = state.data[kind].length === 0;
    grid.append(h('div', { class: 'big-empty' }, none
      ? `Список пуст. Нажмите «Добавить ${cfg.noun}»${kind === 'games' ? ' или подключите Steam' : ''}.` : 'Ничего не найдено.'));
    return;
  }
  items.slice(0, st.limit).forEach((item, i) => {
    const card = kind === 'games' ? gameCard(item) : projectCard(item);
    card.style.setProperty('--d', `${Math.min(i, 18) * 28}ms`);
    grid.append(card);
  });
  if (items.length > st.limit) {
    grid.append(h('div', { class: 'more' }, h('button', { class: 'btn ghost', onclick: () => { st.limit += PAGE_SIZE; renderGrid(kind, false); } },
      `Показать ещё ${items.length - st.limit}`)));
  }
}

/* --- карточка игры --- */
function gameCard(g) {
  const art = artEl(g);
  if (isLive(g)) art.append(h('span', { class: 'tag live' }, 'В ИГРЕ'));
  else if (g.source === 'steam') art.append(h('span', { class: 'tag' }, 'STEAM'));
  else if (g.source === 'epic') art.append(h('span', { class: 'tag' }, 'EPIC'));

  const rating = Math.round(num(g.rating));
  const skill = skillBadge(g);
  const actions = h('div', { class: 'card-actions' },
    g.appid && tbtn('play', 'Играть', () => { api.launch_steam(g.appid); toast(`Запуск «${g.name}» через Steam`); }, 'primary'),
    g.source === 'author' && tbtn('play', 'Играть', async () => { if (await api.author_launch(g.ckey.slice(7))) toast(`Запуск «${g.name}»`); else toast('Игра не установлена: откройте раздел «Автор»', 'err'); }, 'primary'),
    tbtn('chart', 'Профиль', () => openProfile(g), '', 'Время, скилл и разделы игры'),
    tbtn('', '+1 ч', () => { g.hours = Math.round((num(g.hours) + 1) * 10) / 10; persist(); render(false); }, '', 'Добавить час вручную'),
    tbtn('edit', '', () => editItem('games', g), '', 'Изменить'),
    tbtn('trash', '', () => deleteItem('games', g), 'del', 'Удалить'));

  const card = h('article', { class: 'card' }, art,
    h('div', { class: 'g-body' },
      h('div', { class: 'g-title clickable', onclick: () => openProfile(g) }, g.name),
      h('div', { class: 'g-sub' }, statusDot(g.status), gameGenre(g) && h('span', {}, gameGenre(g) + (g.installed ? ' · установлена' : ''))),
      gameTags(g).length > 0 && h('div', { class: 'techs' }, gameTags(g).slice(0, 3).map((t) => h('span', { class: 'tech' }, t))),
      h('div', { class: 'g-nums' }, h('span', { class: 'hrs' }, fmtH(gameHours(g)), h('small', {}, 'ч')), rating > 0 && h('span', { class: 'rate' }, `${rating}/10`)),
      skill && h('div', { class: `skill-line ${skill.good === true ? 'up' : skill.good === false ? 'down' : ''}` }, skill.text),
      g.notes && h('div', { class: 'g-notes' }, g.notes),
      actions));
  card.addEventListener('mouseenter', () => hoverBackdrop(g));
  return card;
}

/* --- карточка проекта --- */
function projectCard(p) {
  const pct = Math.max(0, Math.min(100, Math.round(num(p.progress))));
  const fill = h('i', { style: `background:${STATUS_COLORS[p.status] || '#c8f542'}` });
  setTimeout(() => { fill.style.width = `${pct}%`; }, 120);
  const tech = (p.tech || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 6);
  return h('article', { class: 'card' },
    h('div', { class: 'g-body', style: 'padding-top:14px' },
      h('div', { class: 'g-title' }, p.name),
      h('div', { class: 'g-sub' }, statusDot(p.status)),
      p.notes && h('div', { class: 'g-notes' }, p.notes),
      tech.length > 0 && h('div', { class: 'techs' }, tech.map((t) => h('span', { class: 'tech' }, t))),
      h('div', { class: 'p-prog' }, h('div', { class: 'bar' }, fill), h('span', { class: 'pct' }, `${pct}%`)),
      projectInfoLine(p),
      h('div', { class: 'card-actions' },
        state.tools.code && p.path && tbtn('code', 'VS Code', () => api.open_in_code(p.path), '', 'Открыть папку в VS Code'),
        p.path && tbtn('terminal', '', () => api.open_terminal(p.path), '', 'Открыть терминал в папке'),
        tbtn('folder', 'Папка', async () => { if (!(await api.open_path(p.path))) toast('Папка не найдена. Укажите её в настройках проекта', 'err'); }),
        tbtn('link', 'Ссылка', async () => { if (!(await api.open_link(p.link))) toast('Ссылка не указана', 'err'); }),
        tbtn('edit', '', () => editItem('projects', p), '', 'Изменить'),
        tbtn('trash', '', () => deleteItem('projects', p), 'del', 'Удалить'))));
}

/* --- CRUD --- */
async function addItem(kind) {
  const cfg = LIBS[kind];
  const result = await openForm(`Добавить ${cfg.noun}`, cfg.fields, cfg.defaults);
  if (!result) return;
  result.id = uid();
  state.data[kind].push(result);
  persist(); render(true); toast('Добавлено');
}
async function editItem(kind, item) {
  const result = await openForm('Изменить', LIBS[kind].fields, item);
  if (!result) return;
  Object.assign(item, result);
  persist(); render(false); toast('Сохранено');
}
async function deleteItem(kind, item) {
  if (!(await confirmBox('Удалить?', `«${item.name}» будет удалено из списка.`))) return;
  const list = state.data[kind];
  list.splice(list.indexOf(item), 1);
  persist(); render(false);
}

/* ================= Steam ================= */
async function openSteamModal() {
  const detected = state.settings.steamid || await api.detect_steam_user();
  const keyInput = h('input', { class: 'input', type: 'password', autocomplete: 'off',
    placeholder: state.settings.has_key ? 'Ключ сохранён — оставьте пустым, чтобы не менять' : 'API-ключ Steam' });
  const idInput = h('input', { class: 'input', type: 'text', value: detected || '', placeholder: 'SteamID64, ник или ссылка на профиль' });
  let close;
  const withBusy = async (btn, fn) => { btn.classList.add('busy'); try { await fn(); } finally { btn.classList.remove('busy'); } };

  const importBtn = h('button', { class: 'btn', onclick: () => withBusy(importBtn, async () => {
    state.settings = await api.save_steam_settings(keyInput.value, idInput.value);
    const res = await api.steam_import();
    if (!res.ok) { toast(res.error, 'err'); return; }
    state.data = res.data; state.settings.steamid = res.steamid; state.settings.has_key = true;
    close(); toast(`Импорт завершён: новых ${res.added}, обновлено ${res.updated}`); render(true);
  }) }, 'Импортировать библиотеку');

  const scanBtn = h('button', { class: 'btn ghost', onclick: () => withBusy(scanBtn, async () => {
    const res = await api.steam_scan_local();
    if (!res.ok) { toast(res.error, 'err'); return; }
    state.data = res.data;
    close(); toast(`Установленные игры: новых ${res.added}, обновлено ${res.updated}`); render(true);
  }) }, 'Только установленные');

  const children = [
    h('h2', {}, 'Steam'),
    h('p', { class: 'lead' }, 'Импорт подтянет все игры, часы в них и обложки. Профиль и «Сведения об играх» в настройках приватности Steam должны быть открыты.'),
    h('div', { class: 'field' }, h('label', {}, 'Web API ключ'), keyInput,
      h('ol', { class: 'steps-help' },
        h('li', {}, 'Откройте ', h('span', { class: 'link', onclick: () => api.open_link('https://steamcommunity.com/dev/apikey') }, 'страницу ключа Steam'), ' и войдите в аккаунт.'),
        h('li', {}, 'В поле «Домен» впишите ', h('b', {}, 'localhost'), ' и нажмите «Зарегистрировать».'),
        h('li', {}, 'Скопируйте 32 символа ключа и вставьте сюда.')),
      h('div', { class: 'hint' }, 'Ключ хранится только на этом компьютере и нужен лишь для списка игр и часов. Достижения и вишлист работают и без него.')),
    h('div', { class: 'field' }, h('label', {}, 'Профиль'), idInput,
      h('div', { class: 'hint' }, detected ? 'ID определён по установленному Steam.' : 'Можно указать ссылку на профиль или ник.')),
    h('div', { class: 'divider' }),
    h('div', { class: 'modal-actions', style: 'margin-top:0' }, scanBtn, importBtn),
    h('div', { class: 'hint', style: 'margin-top:10px' }, 'Без ключа можно добавить только установленные игры, без часов наигрыша.'),
  ];
  if (state.settings.has_key) {
    children.push(h('div', { class: 'hint', style: 'margin-top:10px' }, h('span', { class: 'link', onclick: async () => {
      await api.forget_steam_key(); state.settings.has_key = false; close(); toast('Ключ удалён'); render(false);
    } }, 'Забыть сохранённый ключ')));
  }
  close = openModal(children);
}

/* ================= Запуск ================= */
async function boot() {
  const loaded = await api.load();
  state.data = loaded.data; state.settings = loaded.settings; state.tools = loaded.tools || state.tools; state.prefs = loaded.prefs || state.prefs;
  document.querySelectorAll('[data-ico]').forEach((el) => el.replaceWith(ico(el.dataset.ico, 18)));
  document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.page)));
  $('#steam-chip').addEventListener('click', openSteamModal);
  $('#open-search').addEventListener('click', openPalette);
  $('#open-settings').addEventListener('click', openSettings);
  await pollTracking();
  setInterval(pollTracking, 20000);
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
    else if (e.key === '/' && !typing && !document.querySelector('.backdrop')) { e.preventDefault(); openPalette(); }
  });
  show('home');
  autoSync();
  setTimeout(autoSkillRun, 9000);
  pollMeta(true);
  setInterval(pollMeta, 20000);
  if (state.settings.has_key && state.prefs.discount_alert > 0) {
    setTimeout(() => refreshWishlist(false), 15000);
    setInterval(() => refreshWishlist(false), 6 * 3600 * 1000);
  }
}

let started = false;
const start = () => { if (started) return; started = true; boot(); };
if (window.pywebview && window.pywebview.api) start();
else {
  window.addEventListener('pywebviewready', start);
  setTimeout(() => { if (!window.pywebview) { installMockApi(); start(); } }, 900);
}

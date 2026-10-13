'use strict';
/* Данные магазина Steam (жанры, описания), вишлист со скидками, настройки и метки.
   Загружается ДО app.js: здесь только объявления, обращения к state/h/api происходят позже. */

/* ---------- Метаданные игры ---------- */
const FEATURE_RULES = [
  ['Одиночная', /одного игрока/i], ['Мультиплеер', /нескольких игроков/i], ['Кооператив', /кооператив/i],
  ['PvP', /игрок против игрока/i], ['Геймпад', /контроллер/i],
];

const metaOf = (g) => (g.appid ? state.meta[g.appid] : null);
const gameGenres = (g) => { const m = metaOf(g); return m && !m.missing ? m.genres : []; };
const gameFeatures = (g) => {
  const m = metaOf(g);
  return m && !m.missing ? FEATURE_RULES.filter(([, re]) => m.cats.some((c) => re.test(c))).map(([name]) => name) : [];
};
const gameGenre = (g) => { const genres = gameGenres(g); return genres.length ? genres.slice(0, 2).join(' · ') : (g.genre || ''); };
const gameTags = (g) => (Array.isArray(g.tags) ? g.tags : []);

/* Значение фильтра: all | g:<жанр> | f:<особенность> | t:<метка> */
function matchFilter(item, value) {
  if (!value || value === 'all') return true;
  const kind = value.slice(0, 1), v = value.slice(2);
  if (kind === 'g') return gameGenres(item).includes(v);
  if (kind === 'f') return gameFeatures(item).includes(v);
  if (kind === 't') return gameTags(item).includes(v);
  return true;
}

function fillFilterSelect(select, current) {
  const count = (list) => { const map = new Map(); list.forEach((x) => map.set(x, (map.get(x) || 0) + 1)); return [...map].sort((a, b) => b[1] - a[1]); };
  const games = state.data.games;
  const groups = [
    ['Жанры', 'g', count(games.flatMap((g) => gameGenres(g).slice(0, 1))).slice(0, 14)],
    ['Особенности', 'f', count(games.flatMap(gameFeatures))],
    ['Мои метки', 't', count(games.flatMap(gameTags))],
  ];
  select.replaceChildren(h('option', { value: 'all' }, 'Все жанры и метки'),
    ...groups.filter((gr) => gr[2].length).map(([label, key, rows]) => h('optgroup', { label },
      rows.map(([name, n]) => h('option', { value: `${key}:${name}` }, `${name} (${n})`)))));
  select.value = [...select.options].some((o) => o.value === current) ? current : 'all';
  return select.value;
}

async function pollMeta(force = false) {
  try {
    const rev = await api.meta_rev();
    if (!force && rev === state.metaRev) return;
    const res = await api.get_meta();
    state.meta = res.meta; state.metaRev = res.rev; state.metaPending = res.pending;
    if (!document.querySelector('.backdrop') && ['games', 'stats', 'wishlist'].includes(state.page)) render(false);
  } catch (err) { /* окно могло закрываться */ }
}

/* ---------- Вкладка «Обзор» в профиле игры ---------- */
function tagsEditor(g) {
  const wrap = h('div', { class: 'tags-edit' });
  const draw = () => {
    wrap.replaceChildren(...gameTags(g).map((t) => h('span', { class: 'tag-chip' }, t,
      h('button', { title: 'Убрать метку', onclick: () => { g.tags = gameTags(g).filter((x) => x !== t); persist(); draw(); } }, ico('close', 10)))));
    const input = h('input', { class: 'input tag-input', type: 'text', placeholder: gameTags(g).length ? 'ещё метка…' : 'Метка: кооп, с друзьями, расслабляющая…' });
    const add = () => {
      const value = input.value.trim().replace(/,+$/, '');
      if (!value || gameTags(g).includes(value)) { input.value = ''; return; }
      g.tags = [...gameTags(g), value]; persist(); draw(); wrap.querySelector('input').focus();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } });
    input.addEventListener('blur', add);
    wrap.append(input);
  };
  draw();
  return wrap;
}

function overviewTab(g) {
  const m = metaOf(g);
  const box = h('div', {});
  if (m && !m.missing) {
    box.append(h('p', { class: 'ov-desc' }, m.desc || 'Описания нет.'),
      h('div', { class: 'ov-meta' },
        m.dev && h('span', {}, m.dev), m.year > 0 && h('span', {}, String(m.year)),
        m.score > 0 && h('span', { class: `score ${m.score >= 75 ? 'good' : m.score >= 50 ? 'mid' : 'bad'}`, title: 'Оценка Metacritic' }, `Metacritic ${m.score}`)),
      h('div', { class: 'techs', style: 'margin-top:12px' }, m.genres.map((x) => h('span', { class: 'tech' }, x))),
      gameFeatures(g).length > 0 && h('div', { class: 'techs feat', style: 'margin-top:8px' }, gameFeatures(g).map((x) => h('span', { class: 'tech' }, x))));
  } else if (g.appid) {
    box.append(h('div', { class: 'empty' }, m && m.missing ? 'Страницы игры в магазине Steam нет: описание недоступно.'
      : 'Данные из магазина Steam загружаются в фоне, это займёт несколько минут.'));
  } else if (g.genre) {
    box.append(h('p', { class: 'ov-desc' }, g.genre));
  }
  if (g.appid) {
    box.append(h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn ghost', onclick: () => api.open_link(`https://store.steampowered.com/app/${g.appid}`) },
      ico('link', 14), 'Страница в магазине Steam')));
  }
  box.append(h('h3', { class: 'sub-h' }, 'Мои метки'), tagsEditor(g));
  return box;
}

/* ---------- Блок «Жанры» на странице «Итоги» ---------- */
function genreStatsBlock(bars) {
  const games = state.data.games;
  const withMeta = games.filter((g) => gameGenres(g).length);
  const block = h('div', { class: 'block' }, h('h3', {}, 'Жанры по времени'));
  if (withMeta.length < 5) {
    block.append(h('div', { class: 'empty' }, state.metaPending > 0
      ? `Данные магазина Steam загружаются в фоне: осталось ${state.metaPending} игр.` : 'Пока нет данных о жанрах.'));
    return block;
  }
  const byGenre = new Map();
  withMeta.forEach((g) => { const key = gameGenres(g)[0]; byGenre.set(key, (byGenre.get(key) || 0) + gameHours(g)); });
  const rows = [...byGenre].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = Math.max(1, rows[0][1]);
  rows.forEach(([genre, hours]) => {
    const fill = h('i', {}); bars.push([fill, (hours / max) * 100]);
    block.append(h('div', { class: 'trow' }, h('span', { class: 'nm', style: 'flex-basis:130px' }, genre), h('div', { class: 'bar' }, fill), h('span', { class: 'val' }, `${fmtH(hours)} ч`)));
  });
  const coopHours = withMeta.filter((g) => gameFeatures(g).includes('Кооператив')).reduce((s, g) => s + gameHours(g), 0);
  const total = withMeta.reduce((s, g) => s + gameHours(g), 0);
  if (total > 0) block.append(h('p', { class: 'fact' }, 'Время в кооперативных играх: ', h('b', {}, `${Math.round((coopHours / total) * 100)}%`), '.'));
  if (state.metaPending > 0) block.append(h('p', { class: 'hint' }, `Ещё загружаются: ${state.metaPending} игр.`));
  return block;
}

/* ---------- Желаемое (вишлист Steam) ---------- */
const wish = { data: { items: [], ts: 0 }, sort: 'discount', onlyDeals: false, busy: false, loaded: false };

async function refreshWishlist(manual = false) {
  if (wish.busy) return;
  wish.busy = true;
  if (state.page === 'wishlist') renderWishlist();
  try {
    const res = await api.refresh_wishlist();
    if (!res.ok) { if (manual) toast(res.error, 'err'); return; }
    wish.data = { items: res.items, ts: res.ts };
    if (manual) toast(res.deals.length ? `Скидки: ${res.deals.map((d) => `${d.name} −${d.discount}%`).slice(0, 3).join('; ')}` : 'Цены обновлены');
    else if (res.deals.length) toast(`Скидка в вишлисте: ${res.deals[0].name} −${res.deals[0].discount}%`);
  } catch (err) { if (manual) toast('Не удалось обновить вишлист', 'err'); }
  finally { wish.busy = false; if (state.page === 'wishlist') renderWishlist(); }
}

async function renderWishlist() {
  const page = $('#page-wishlist');
  if (!wish.loaded) {
    wish.loaded = true;
    wish.data = await api.get_wishlist();
    if (Date.now() / 1000 - (wish.data.ts || 0) > 6 * 3600) refreshWishlist(false);
  }
  const items = wish.data.items || [];
  const price = (i) => (i.price ? i.price.final : Infinity);
  let rows = items.filter((i) => !wish.onlyDeals || (i.price && i.price.discount > 0));
  const nameOf = (i) => (state.meta[i.appid] && state.meta[i.appid].name) || `Игра #${i.appid}`;
  const sorters = { discount: (a, b) => (b.price?.discount || 0) - (a.price?.discount || 0) || price(a) - price(b),
    price: (a, b) => price(a) - price(b), added: (a, b) => b.added - a.added, name: (a, b) => nameOf(a).localeCompare(nameOf(b), 'ru') };
  rows = rows.slice().sort(sorters[wish.sort]);
  const deals = items.filter((i) => i.price && i.price.discount > 0).length;

  const sortSel = h('select', { class: 'sort', onchange: (e) => { wish.sort = e.target.value; renderWishlist(); } },
    [['discount', 'По скидке'], ['price', 'По цене'], ['added', 'Недавно добавленные'], ['name', 'По названию']].map(([v, l]) => h('option', { value: v, selected: v === wish.sort }, l)));
  const tabs = h('div', { class: 'stabs' }, [[false, 'Все'], [true, 'Со скидкой']].map(([flag, label]) => h('button', {
    class: `stab${wish.onlyDeals === flag ? ' active' : ''}`, onclick: () => { wish.onlyDeals = flag; renderWishlist(); } },
  label, h('sup', {}, String(flag ? deals : items.length)))));

  page.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', {}, h('div', { class: 'eyebrow' }, 'Steam'), h('h1', {}, 'Желаемое'),
        h('p', { class: 'sub' }, items.length ? `${items.length} в списке · ${deals} со скидкой${wish.data.ts ? ` · обновлено ${agoText(wish.data.ts * 1000)}` : ''}` : 'Список из вашего вишлиста Steam')),
      h('div', { class: 'head-actions' }, h('button', { class: `btn ghost${wish.busy ? ' busy' : ''}`, onclick: () => refreshWishlist(true) }, ico('refresh', 14), 'Обновить цены'))),
    h('div', { class: 'toolbar' }, tabs, sortSel),
    h('div', { class: 'cards', id: 'grid-wishlist' }));
  const grid = $('#grid-wishlist');
  if (!rows.length) {
    grid.append(h('div', { class: 'big-empty' }, items.length ? 'Со скидкой сейчас ничего нет.'
      : wish.busy ? 'Загружаю вишлист…' : 'Вишлист пуст или недоступен. Нужны ID профиля (кнопка «Steam») и открытый вишлист в настройках приватности.'));
    return;
  }
  rows.forEach((i, idx) => {
    const m = state.meta[i.appid];
    const art = artEl({ name: nameOf(i), appid: i.appid, hue: (idx * 47) % 360 });
    if (i.price && i.price.discount > 0) art.append(h('span', { class: 'tag deal' }, `−${i.price.discount}%`));
    const card = h('article', { class: 'card', style: `--d:${Math.min(idx, 18) * 28}ms` }, art,
      h('div', { class: 'g-body' },
        h('div', { class: 'g-title' }, nameOf(i)),
        h('div', { class: 'g-sub' }, m && !m.missing && m.genres.length ? m.genres.slice(0, 2).join(' · ') : '', m && m.year > 0 && h('span', {}, String(m.year))),
        h('div', { class: 'price' }, i.price
          ? [i.price.discount > 0 && h('s', {}, i.price.initial_text), h('b', { class: i.price.discount > 0 ? 'sale' : '' }, i.price.final_text)]
          : h('span', { class: 'g-sub' }, 'Цены нет или игра бесплатная')),
        h('div', { class: 'card-actions' }, tbtn('link', 'В магазин', () => api.open_link(`https://store.steampowered.com/app/${i.appid}`), 'primary'))));
    grid.append(card);
  });
}

/* ---------- Настройки ---------- */
function switchRow(title, hint, checked, onChange) {
  const row = h('div', { class: `toggle${checked ? ' on' : ''}`, role: 'switch', tabindex: '0', 'aria-checked': String(checked) },
    h('div', { class: 'txt' }, h('b', {}, title), hint && h('small', {}, hint)), h('div', { class: 'switch' }));
  const flip = () => { const now = !row.classList.contains('on'); row.classList.toggle('on', now); row.setAttribute('aria-checked', String(now)); onChange(now); };
  row.addEventListener('click', flip);
  row.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
  return row;
}

function numberRow(title, hint, value, suffix, onInput) {
  const input = h('input', { class: 'input num-input', type: 'text', inputmode: 'decimal', value: String(value) });
  input.addEventListener('input', () => onInput(input.value));
  return h('div', { class: 'toggle static' }, h('div', { class: 'txt' }, h('b', {}, title), hint && h('small', {}, hint)),
    h('div', { class: 'num-wrap' }, input, h('span', {}, suffix)));
}

function openSettings() {
  const draft = { ...state.prefs };
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isNaN(n) ? 0 : Math.max(0, n); };
  let close;
  const save = async () => {
    state.prefs = await api.set_prefs(draft);
    close(); toast('Настройки сохранены');
  };
  close = openModal([
    h('h2', {}, 'Настройки'),
    h('div', { class: 'sub-h' }, 'Здоровые привычки'),
    h('div', { class: 'toggles' },
      numberRow('Напоминать о перерыве', 'Если игра идёт подряд дольше. 0 — выключено. Работает для игр с авто-учётом времени.', draft.break_hours, 'ч', (v) => { draft.break_hours = num(v); }),
      numberRow('Дневной лимит игр', 'Предупредить, когда за день набралось больше. 0 — выключено.', draft.day_limit_hours, 'ч', (v) => { draft.day_limit_hours = num(v); }),
      switchRow('Уведомления Windows', 'Показывать напоминания и скидки во всплывающем окне.', draft.notify, (v) => { draft.notify = v; })),
    h('div', { class: 'sub-h' }, 'Steam'),
    h('div', { class: 'toggles' },
      numberRow('Сообщать о скидках от', 'Для игр из вашего вишлиста. 0 — выключено.', draft.discount_alert, '%', (v) => { draft.discount_alert = Math.min(100, num(v)); }),
      switchRow('Синхронизировать при запуске', 'Подтягивать часы и последний запуск из Steam.', draft.steam_autosync, (v) => { draft.steam_autosync = v; })),
    h('p', { class: 'hint' }, 'Данные хранятся только на этом компьютере. Ничего, кроме запросов к Steam и сайтам игр, приложение не отправляет.'),
    h('div', { class: 'modal-actions', style: 'justify-content:space-between' },
      h('button', { class: 'btn ghost', onclick: async () => { await api.set_prefs(draft); state.prefs = { ...draft }; const ok = await api.test_notify(); toast(ok ? 'Уведомление отправлено' : 'Не удалось показать уведомление', ok ? '' : 'err'); } }, 'Проверить уведомление'),
      h('div', { class: 'hero-actions' }, h('button', { class: 'btn ghost', onclick: () => close() }, 'Отмена'), h('button', { class: 'btn', onclick: save }, 'Сохранить'))),
  ]);
}

/* ---------- Проекты автора ---------- */
const AUTHOR_URL = 'https://github.com/Reranyti';
/* Запасной список на случай, если GitHub недоступен и кэша ещё нет */
const AUTHOR_FALLBACK = [
  { name: 'Lotos-Outer', desc: 'Майнкрафт', lang: 'Java', stars: 0, url: `${AUTHOR_URL}/Lotos-Outer`, homepage: '', updated: '', play: null },
  { name: 'DeltaKind', desc: 'Проект основанный на базе Kristal, фан-игра по Deltarune.', lang: 'Lua', stars: 0, url: `${AUTHOR_URL}/DeltaKind`, homepage: '', updated: '', play: null },
];
const authorState = { repos: null, status: { installed: {}, progress: {} }, mods: { path: '', forge: false, installed: {} }, timer: null, open: new Set() };

function supportBlock(links) {
  const box = h('div', { class: 'support' }, h('h3', {}, 'Поддержать автора'));
  if (links.length) {
    box.append(h('p', { class: 'sup-lead' }, 'Проекты делает один человек. Если они вам нравятся, вот как можно помочь:'),
      h('div', { class: 'sup-links' }, links.map((l) => h('button', { class: 'sup-card', onclick: () => api.open_link(l.url) },
        h('b', {}, l.title), l.note && h('small', {}, l.note), h('span', { class: 'sup-go' }, 'Перейти', ico('link', 13))))));
  }
  box.append(h('p', { class: 'sup-free' }, links.length ? 'Бесплатно тоже очень помогает: ' : 'Это можно сделать бесплатно: ',
    'поставьте звезду проекту на GitHub, расскажите друзьям, поиграйте и оставьте отзыв или идею в разделе Issues.'));
  return box;
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(bytes > 10485760 ? 0 : 1)} МБ`;
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '');
const versionsOf = (r) => r.versions || [];
const progressOf = (r, v) => authorState.status.progress[`${r.name}@${v.tag}`];

/* Игра автора попадает в библиотеку: время считается само (по процессу), иконка берётся из самой игры */
function addAuthorGameToLibrary(repo, info) {
  const ckey = `author:${repo}`;
  if (state.data.games.some((g) => g.ckey === ckey) || !info.process) return;
  state.data.games.push({ id: uid(), name: repo, genre: 'Проект автора', status: 'Играю', hours: 0, rating: 0, notes: '',
    ckey, source: 'author', process: info.process, icon: info.icon || '', hue: 28 });
  persist();
}

function syncAuthorLibrary() {
  for (const [repo, info] of Object.entries(authorState.status.installed)) {
    if (Object.values(info.versions).some((v) => v.exists)) addAuthorGameToLibrary(repo, info);
  }
}

async function refreshAuthorStatus() {
  try { authorState.status = await api.author_status(); authorState.mods = await api.author_mods_info(); } catch (err) { return; }
  syncAuthorLibrary();
  const running = Object.values(authorState.status.progress).some((p) => p.state === 'running');
  if (state.page === 'author') drawAuthorCards();
  if (running && !authorState.timer) authorState.timer = setInterval(refreshAuthorStatus, 500);
  if (!running && authorState.timer) { clearInterval(authorState.timer); authorState.timer = null; }
}

async function installMod(r, v) {
  let path = authorState.mods.path;
  const hasJars = (v.files || []).some((f) => f.name.toLowerCase().endsWith('.jar'));
  if (hasJars && !path) {
    const folder = await api.pick_folder();
    if (!folder) return;
    path = await api.author_set_mods_dir(folder);
    if (!path) { toast('Выберите существующую папку', 'err'); return; }
  }
  const ok = await confirmBox(hasJars ? 'Установить мод?' : 'Скачать сборку?', hasJars
    ? `Файлы: ${v.asset} (${mb(v.size)}), версия ${v.tag}. Они будут установлены в папку «${path}». Прежние версии этого мода переедут в подпапку «.hub-old» (удаляйте её, когда убедитесь, что новая работает). `
      + (authorState.mods.forge ? 'Forge 1.20.1 найден. ' : 'Forge 1.20.1 в стандартной папке Minecraft не найден: без него мод не запустится. ')
      + 'Закройте Minecraft перед установкой.'
    : `Файл «${v.asset}» (${mb(v.size)}) будет сохранён в папку «Загрузки»: это сборка для лаунчера, её нужно импортировать в Minecraft-лаунчер.`,
    hasJars ? 'Установить' : 'Скачать', 'primary');
  if (!ok) return;
  const res = await api.author_install(r.name, v.tag, hasJars ? path : null);
  if (!res.ok) { toast(res.error, 'err'); return; }
  await refreshAuthorStatus();
}

async function installVersion(r, v) {
  if (v.kind === 'mod') return installMod(r, v);
  const isGame = v.kind === 'game';
  const ok = await confirmBox(isGame ? 'Скачать и играть?' : 'Скачать мод?',
    `Будет скачано: ${v.asset} (${mb(v.size)}), версия ${v.tag}, с GitHub автора. `
    + (isGame ? 'Игра распакуется в папку данных приложения и добавится в библиотеку, время в ней будет считаться само. '
      : 'Файлы сохранятся в отдельную папку внутри «Загрузки». Нужен Minecraft с подходящим загрузчиком (Forge), подробности в описании проекта на GitHub. ')
    + 'Запускайте только проекты, которым доверяете.', isGame ? 'Скачать и играть' : 'Скачать', 'primary');
  if (!ok) return;
  const res = await api.author_install(r.name, v.tag);
  if (!res.ok) { toast(res.error, 'err'); return; }
  await refreshAuthorStatus();
}

async function launchVersion(r, tag) {
  if (await api.author_launch(r.name, tag)) { toast(`Запуск «${r.name}» ${tag}`); refreshAuthorStatus(); }
  else toast('Не удалось запустить игру: возможно, файлы удалены', 'err');
}

async function removeVersion(r, tag) {
  if (!(await confirmBox('Удалить версию?', `Файлы «${r.name}» ${tag} будут удалены с компьютера. Запись в библиотеке и часы останутся.`))) return;
  await api.author_uninstall(r.name, tag); await refreshAuthorStatus();
}

const isNewest = (r, v) => versionsOf(r)[0] === v;
const hasJarsOf = (v) => (v.files || []).some((f) => f.name.toLowerCase().endsWith('.jar'));

function versionRow(r, v) {
  const inst = (authorState.status.installed[r.name] || { versions: {} }).versions[v.tag];
  const installed = inst && inst.exists;
  const progress = progressOf(r, v);
  const actions = h('div', { class: 'ver-actions' });
  if (progress && progress.state === 'running') {
    actions.append(h('div', { class: 'ver-prog' }, h('div', { class: 'track' }, h('i', { style: `width:${progress.percent}%` })), h('small', {}, `${progress.label}… ${progress.percent}%`)));
  } else if (v.kind === 'game') {
    if (installed) actions.append(tbtn('play', 'Играть', () => launchVersion(r, v.tag), 'primary'), tbtn('trash', '', () => removeVersion(r, v.tag), 'del', 'Удалить эту версию'));
    else actions.append(tbtn('download', 'Скачать', () => installVersion(r, v)));
  } else {
    const modInstalled = (authorState.mods.installed[r.name] || {}).tag === v.tag;
    if (modInstalled) actions.append(tbtn('folder', 'Папка mods', () => api.open_path(authorState.mods.installed[r.name].mods_dir)));
    else actions.append(tbtn('download', hasJarsOf(v) ? 'Установить' : 'Скачать', () => installVersion(r, v)));
    if (!hasJarsOf(v) && progress && progress.state === 'done') actions.append(tbtn('folder', 'Показать файлы', () => api.reveal_download(r.name, v.tag)));
  }
  const isInstalledRow = installed || (v.kind === 'mod' && (authorState.mods.installed[r.name] || {}).tag === v.tag);
  return h('div', { class: `ver-row${isInstalledRow ? ' installed' : ''}` },
    h('div', { class: 'ver-info' }, h('b', {}, v.tag), isNewest(r, v) && h('span', { class: 'ver-badge new' }, 'Эксклюзив · новейшая'),
      isInstalledRow && h('span', { class: 'ver-badge' }, 'установлена'),
      h('small', {}, [fmtDate(v.published), mb(v.size), v.title && v.title !== v.tag ? v.title : ''].filter(Boolean).join(' · '))),
    progress && progress.state === 'error' ? h('div', { class: 'error-line' }, `Не получилось: ${progress.error}`) : null,
    actions);
}

function drawAuthorCards() {
  const grid = $('#grid-author');
  if (!grid) return;
  grid.replaceChildren();
  authorState.repos.forEach((r, i) => {
    const versions = versionsOf(r);
    const latest = versions[0];
    const inst = authorState.status.installed[r.name];
    const lastTag = inst && inst.versions[inst.last] && inst.versions[inst.last].exists ? inst.last : null;
    const busy = latest && progressOf(r, latest) && progressOf(r, latest).state === 'running';
    const open = authorState.open.has(r.name);
    const actions = h('div', { class: 'card-actions', style: 'opacity:1;transform:none' });
    if (latest && latest.kind === 'game') {
      const latestInstalled = inst && inst.versions[latest.tag] && inst.versions[latest.tag].exists;
      if (latestInstalled) actions.append(tbtn('play', `Играть ${latest.tag}`, () => launchVersion(r, latest.tag), 'primary'));
      else if (lastTag) {
        actions.append(tbtn('play', `Играть ${lastTag}`, () => launchVersion(r, lastTag), 'primary'));
        if (!busy) actions.append(tbtn('refresh', `Обновить до ${latest.tag}`, () => installVersion(r, latest)));
      } else if (!busy) actions.append(tbtn('play', 'Играть', () => installVersion(r, latest), 'primary'));
    } else if (latest && latest.kind === 'mod' && !busy) {
      const mod = authorState.mods.installed[r.name];
      if (mod && mod.tag === latest.tag) {
        actions.append(h('span', { class: 'ver-badge new', style: 'align-self:center' }, `Установлен ${mod.tag}`),
          tbtn('folder', 'Папка mods', () => api.open_path(mod.mods_dir)),
          tbtn('trash', '', async () => {
            if (!(await confirmBox('Удалить мод?', `Файлы ${mod.files.join(', ')} будут удалены из папки «${mod.mods_dir}».`))) return;
            await api.author_uninstall_mod(r.name); await refreshAuthorStatus();
          }, 'del', 'Удалить установленный мод'));
      } else {
        actions.append(tbtn('download', mod ? `Обновить до ${latest.tag}` : (hasJarsOf(latest) ? 'Установить' : 'Скачать'), () => installVersion(r, latest), 'primary'));
        if (mod) actions.append(h('span', { class: 'g-sub', style: 'align-self:center' }, `стоит ${mod.tag}`));
      }
    }
    if (versions.length) actions.append(tbtn(open ? 'close' : 'layers', open ? 'Скрыть версии' : `Все версии (${versions.length})`,
      () => { if (open) authorState.open.delete(r.name); else authorState.open.add(r.name); drawAuthorCards(); }));
    actions.append(tbtn('link', 'GitHub', () => api.open_link(r.url)), tbtn('', 'Идея или ошибка', () => api.open_link(`${r.url}/issues`)));

    let summary;
    if (!latest) summary = 'Готовой сборки для игры пока нет: смотрите описание на GitHub.';
    else if (latest.kind === 'game') summary = `Сборка для Windows · новейшая версия ${latest.tag} · ${mb(latest.size)}${lastTag ? ` · у вас ${lastTag}` : ''}`;
    else summary = `Мод для Minecraft (Forge) · новейшая версия ${latest.tag} · ${mb(latest.size)}. Устанавливается в папку mods.`;

    grid.append(h('article', { class: `card${open ? ' wide-card' : ''}`, style: `--d:${Math.min(i, 18) * 40}ms` },
      h('div', { class: 'g-body', style: 'padding-top:16px' },
        latest && h('div', { class: 'excl' }, 'Эксклюзив: новейшая версия в лаунчере'),
        h('div', { class: 'g-title' }, r.name),
        r.desc ? h('div', { class: 'g-notes', style: '-webkit-line-clamp:4' }, r.desc) : null,
        r.lang ? h('div', { class: 'techs' }, h('span', { class: 'tech' }, r.lang)) : null,
        h('div', { class: 'g-sub' }, summary),
        h('div', { class: 'g-sub' }, h('span', {}, `★ ${r.stars}`), r.updated && h('span', {}, `обновлён ${agoText(Date.parse(r.updated))}`)),
        actions,
        open && h('div', { class: 'ver-list' }, versions.map((v) => versionRow(r, v))))));
  });
}

async function renderAuthor() {
  const page = $('#page-author');
  if (!authorState.repos) {
    try {
      const res = await api.author_projects();
      authorState.repos = res.repos && res.repos.length ? res.repos : AUTHOR_FALLBACK;
    } catch (err) { authorState.repos = AUTHOR_FALLBACK; }
  }
  let support = [];
  try { support = (await api.author_support()).links || []; } catch (err) { /* без ссылок покажем бесплатные способы */ }
  page.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', {}, h('div', { class: 'eyebrow' }, 'Разработчик'), h('h1', {}, 'Проекты автора'),
        h('p', { class: 'sub', style: 'max-width:560px;line-height:1.55' }, 'Если вы хотите поддержать или поиграть в проекты разработчика, вот специально отведённый для этого раздел.')),
      h('div', { class: 'head-actions' }, h('button', { class: 'btn', onclick: () => api.open_link(AUTHOR_URL) }, ico('link', 14), 'Профиль на GitHub'))),
    supportBlock(support),
    h('div', { class: 'cards', id: 'grid-author' }));
  await refreshAuthorStatus();
  drawAuthorCards();
}

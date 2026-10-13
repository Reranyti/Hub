'use strict';
/* Функции поверх базы: рулетка, разбор библиотеки, итоги, быстрый поиск (Ctrl+K), достижения Steam,
   проекты из папки, резервные копии, авто-синхронизация Steam.
   Загружается ДО app.js: здесь только объявления, обращения к state/h/api происходят позже. */

const DAY_MS = 86400000;

/* ---------- Время ---------- */
function lastPlayedMs(g) {
  const steam = (g.last_played || 0) * 1000;
  const own = state.tracking[g.id]?.last ? Date.parse(state.tracking[g.id].last) : 0;
  return Math.max(steam, own || 0);
}

function agoText(ms) {
  if (!ms) return 'никогда';
  const d = Math.floor((Date.now() - ms) / DAY_MS);
  if (d <= 0) return 'сегодня';
  if (d === 1) return 'вчера';
  if (d < 7) return `${d} дн. назад`;
  if (d < 30) return `${Math.floor(d / 7)} нед. назад`;
  if (d < 365) return `${Math.floor(d / 30)} мес. назад`;
  return `${Math.floor(d / 365)} г. назад`;
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/* ---------- Рулетка «Что поиграть?» ---------- */
const ROULETTE_POOLS = [
  { id: 'want', label: 'Хочу поиграть', pick: (g) => g.status === 'Хочу поиграть' },
  { id: 'backlog', label: 'Неразобранные', pick: (g) => g.status === 'В библиотеке' },
  { id: 'unplayed', label: 'Ни разу не запускал', pick: (g) => gameHours(g) === 0 },
  { id: 'short', label: 'Играл меньше 5 ч', pick: (g) => gameHours(g) < 5 && g.status !== 'Прошёл' && g.status !== 'Бросил' },
  { id: 'coop', label: 'Кооператив', pick: (g) => gameFeatures(g).includes('Кооператив') },
  { id: 'all', label: 'Вся библиотека', pick: () => true },
];

function openRoulette() {
  const games = state.data.games;
  if (!games.length) { toast('Сначала добавьте игры', 'err'); return; }
  let pool = ROULETTE_POOLS.find((p) => (p.id === 'want' || p.id === 'short') && games.some(p.pick)) || ROULETTE_POOLS.find((p) => p.id === 'all');
  let spinning = false;

  const strip = h('div', { class: 'r-strip' });
  const view = h('div', { class: 'r-view' }, strip, h('div', { class: 'r-marker' }));
  const result = h('div', { class: 'r-result' });
  const chips = h('div', { class: 'r-chips' });
  const spinBtn = h('button', { class: 'btn', onclick: () => spin() }, ico('dice', 15), 'Крутить');

  const drawChips = () => {
    chips.replaceChildren(...ROULETTE_POOLS.map((p) => {
      const count = games.filter(p.pick).length;
      return h('button', { class: `stab${p === pool ? ' active' : ''}`, disabled: count ? null : 'disabled',
        onclick: () => { if (spinning) return; pool = p; drawChips(); } }, p.label, h('sup', {}, String(count)));
    }));
  };

  const item = (g, win) => h('div', { class: `r-item${win ? ' is-winner' : ''}` }, artEl(g), h('div', { class: 'r-name' }, g.name));

  function showResult(g) {
    result.replaceChildren(
      h('div', { class: 'eyebrow' }, 'Выпало'),
      h('div', { class: 'r-title' }, g.name),
      h('div', { class: 'g-sub' }, statusDot(g.status), h('span', {}, `${fmtH(gameHours(g))} ч`), h('span', {}, `последний запуск: ${agoText(lastPlayedMs(g))}`)),
      h('div', { class: 'hero-actions', style: 'margin-top:14px' },
        g.appid && h('button', { class: 'btn', onclick: () => { api.launch_steam(g.appid); toast(`Запуск «${g.name}» через Steam`); } }, ico('play', 14), 'Играть'),
        h('button', { class: 'btn ghost', onclick: () => openProfile(g) }, 'Профиль')));
  }

  function spin() {
    if (spinning) return;
    const list = games.filter(pool.pick);
    if (!list.length) { result.replaceChildren(h('div', { class: 'empty' }, 'В этой подборке пусто')); return; }
    spinning = true; spinBtn.classList.add('busy'); result.replaceChildren();
    const N = 54, W = 46;
    const picks = [];
    let prev = null;
    for (let i = 0; i < N; i++) {
      let g;
      do { g = list[Math.floor(Math.random() * list.length)]; } while (list.length > 1 && g === prev);
      prev = g; picks.push(g);
    }
    strip.style.transition = 'none'; strip.style.transform = 'translateX(0)';
    strip.replaceChildren(...picks.map((g, i) => item(g, i === W)));
    void strip.offsetWidth;
    const stepW = 196, jitter = (Math.random() - 0.5) * 110;
    const shift = W * stepW + 94 - view.clientWidth / 2 + jitter;
    strip.style.transition = 'transform 5.2s cubic-bezier(.1,.7,0,1)';
    strip.style.transform = `translateX(${-shift}px)`;
    setTimeout(() => {
      strip.children[W]?.classList.add('win');
      showResult(picks[W]);
      spinning = false; spinBtn.classList.remove('busy');
    }, 5350);
  }

  drawChips();
  const close = openModal([
    h('h2', {}, 'Что поиграть?'),
    h('p', { class: 'lead' }, 'Не можете выбрать из сотни игр — пусть решит рулетка. Выберите подборку и крутите.'),
    chips, view, result,
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', onclick: () => close() }, 'Закрыть'), spinBtn),
  ], 'wide roulette');
}

/* ---------- Разбор библиотеки ---------- */
const TRIAGE_CHOICES = [
  ['1', 'Хочу поиграть', 'Хочу поиграть'], ['2', 'Играю', 'Играю'], ['3', 'Прошёл', 'Прошёл'],
  ['4', 'Бросил', 'Бросил'], ['5', 'Оставить как есть', null],
];

const triageQueue = () => state.data.games.filter((g) => g.status === 'В библиотеке' && !g.triaged)
  .sort((a, b) => gameHours(b) - gameHours(a));

function triageHint(g) {
  const hours = gameHours(g), last = lastPlayedMs(g);
  if (hours === 0) return { text: 'Ни разу не запускали', pick: 'Хочу поиграть' };
  if (hours >= 2 && last && Date.now() - last > 365 * DAY_MS) return { text: 'Больше года не запускали', pick: 'Бросил' };
  if (hours >= 20 && last && Date.now() - last < 90 * DAY_MS) return { text: 'Много наиграно и играли недавно', pick: 'Играю' };
  if (hours >= 20) return { text: 'Много наиграно', pick: 'Прошёл' };
  return null;
}

function openTriage() {
  let list = triageQueue();
  const total = list.length;
  if (!total) { toast('Разбирать нечего: у всех игр уже есть статус'); return; }
  let idx = 0;
  const undo = [];
  const body = h('div', { class: 'tri-body' });
  const fill = h('i', {});
  const counter = h('div', { class: 'tri-count' });
  let closeModal;

  const update = () => {
    fill.style.width = `${(idx / total) * 100}%`;
    counter.textContent = `Разобрано ${idx} из ${total}`;
  };

  function apply(choice) {
    const g = list[idx];
    undo.push({ g, status: g.status, triaged: g.triaged });
    if (choice[2]) g.status = choice[2]; else g.triaged = true;
    persist();
    idx += 1; update();
    const card = $('.tri-card', body);
    if (card) { card.classList.add('out'); setTimeout(draw, 170); } else draw();
  }

  function back() {
    const last = undo.pop();
    if (!last) return;
    last.g.status = last.status; last.g.triaged = last.triaged;
    persist(); idx -= 1; update(); draw();
  }

  function draw() {
    if (idx >= list.length) {
      body.replaceChildren(h('div', { class: 'tri-done' }, h('h2', {}, 'Всё разобрано'),
        h('p', { class: 'lead' }, `Обработано игр: ${list.length}. Теперь фильтры и итоги станут куда полезнее.`),
        h('button', { class: 'btn', onclick: () => closeModal() }, 'Готово')));
      return;
    }
    const g = list[idx], hint = triageHint(g);
    body.replaceChildren(h('div', { class: 'tri-card' },
      artEl(g, 'art tri-art'),
      h('div', { class: 'tri-info' },
        h('div', { class: 'tri-name' }, g.name),
        h('div', { class: 'g-sub' }, h('span', {}, `${fmtH(gameHours(g))} ч`), h('span', {}, `последний запуск: ${agoText(lastPlayedMs(g))}`)),
        hint && h('div', { class: 'tri-hint' }, hint.text))),
    h('div', { class: 'tri-keys' }, TRIAGE_CHOICES.map((c) => h('button', {
      class: `tri-key${hint && hint.pick === c[2] ? ' suggest' : ''}`, onclick: () => apply(c) },
    h('kbd', {}, c[0]), c[1]))),
    h('div', { class: 'hint' }, 'Клавиши 1–5 выбирают статус, Backspace отменяет последний шаг, Esc закрывает окно.'));
  }

  const onKey = (e) => {
    if (idx < list.length) {
      const choice = TRIAGE_CHOICES.find((c) => c[0] === e.key);
      if (choice) { e.preventDefault(); apply(choice); return; }
    }
    if (e.key === 'Backspace' || e.key === 'ArrowLeft') { e.preventDefault(); back(); }
  };
  document.addEventListener('keydown', onKey);

  update();
  closeModal = openModal([
    h('h2', {}, 'Разбор библиотеки'),
    h('p', { class: 'lead' }, 'Быстро разложите игры по статусам: первыми идут самые наигранные.'),
    h('div', { class: 'tri-top' }, counter, h('div', { class: 'track' }, fill)),
    body,
  ], 'wide triage', () => { document.removeEventListener('keydown', onKey); render(false); });
  draw();
}

/* ---------- Страница «Итоги» ---------- */
function renderStats() {
  const page = $('#page-stats');
  const games = state.data.games;
  page.replaceChildren();
  page.append(h('div', { class: 'page-head' },
    h('div', {}, h('div', { class: 'eyebrow' }, 'Аналитика'), h('h1', {}, 'Итоги'), h('p', { class: 'sub' }, 'Что на самом деле лежит в вашей библиотеке')),
    h('div', { class: 'head-actions' },
      h('button', { class: 'btn ghost', onclick: doRestore }, ico('upload', 14), 'Восстановить'),
      h('button', { class: 'btn ghost', onclick: doBackup }, ico('download', 14), 'Резервная копия'))));

  if (!games.length) {
    page.append(h('div', { class: 'empty' }, 'Здесь появится статистика, когда в списке будут игры.'));
    return;
  }

  const hours = games.map(gameHours);
  const total = hours.reduce((a, b) => a + b, 0);
  const played = games.filter((g) => gameHours(g) >= 2).length;
  const bars = [];

  /* крупные цифры */
  const nums = [
    [total / 24, 'суток в играх', true], [games.length, 'игр в списке', false],
    [total / games.length, 'ч на игру в среднем', true], [Math.round((played / games.length) * 100), '% игр играно дольше 2 ч', false],
  ];
  const statsEl = h('div', { class: 'stats four' });
  nums.forEach(([value, label, isFloat]) => {
    const n = h('div', { class: 'num' }, '0');
    statsEl.append(h('div', { class: 'stat' }, n, h('div', { class: 'lbl' }, label)));
    animateCount(n, value, isFloat);
  });
  page.append(statsEl);

  /* распределение по времени */
  const buckets = [
    ['Ни разу', (v) => v === 0], ['до 2 ч', (v) => v > 0 && v < 2], ['2–10 ч', (v) => v >= 2 && v < 10],
    ['10–50 ч', (v) => v >= 10 && v < 50], ['50–100 ч', (v) => v >= 50 && v < 100], ['100+ ч', (v) => v >= 100],
  ].map(([label, test]) => [label, hours.filter(test).length]);
  const maxCount = Math.max(1, ...buckets.map((b) => b[1]));
  const hist = h('div', { class: 'block' }, h('h3', {}, 'Сколько часов в каждой игре'));
  buckets.forEach(([label, count]) => {
    const fillEl = h('i', {}); bars.push([fillEl, (count / maxCount) * 100]);
    hist.append(h('div', { class: 'trow' }, h('span', { class: 'nm', style: 'flex-basis:90px' }, label), h('div', { class: 'bar' }, fillEl),
      h('span', { class: 'val' }, `${count} · ${Math.round((count / games.length) * 100)}%`)));
  });

  /* статусы */
  const statusCounts = [...GAME_STATUSES].map((s) => [s, games.filter((g) => g.status === s).length]).filter((x) => x[1]);
  const seg = h('div', { class: 'seg' }, statusCounts.map(([s, n]) => h('i', { title: `${s}: ${n}`, style: `flex:${n};background:${STATUS_COLORS[s]}` })));
  const legend = h('div', { class: 'seg-legend' }, statusCounts.map(([s, n]) => h('span', { class: 'st' }, h('i', { style: `background:${STATUS_COLORS[s]}` }), `${s} · ${n}`)));
  const statusBlock = h('div', { class: 'block' }, h('h3', {}, 'Статусы'), seg, legend);

  /* топ по часам */
  const top = [...games].sort((a, b) => gameHours(b) - gameHours(a)).slice(0, 10);
  const maxH = Math.max(1, gameHours(top[0]));
  const topBlock = h('div', { class: 'block' }, h('h3', {}, 'Топ-10 по времени'));
  top.forEach((g) => {
    const fillEl = h('i', {}); bars.push([fillEl, (gameHours(g) / maxH) * 100]);
    topBlock.append(h('div', { class: 'trow clickable', onclick: () => openProfile(g) }, artEl(g, 'art thumb'),
      h('span', { class: 'nm', title: g.name }, g.name), h('div', { class: 'bar' }, fillEl), h('span', { class: 'val' }, `${fmtH(gameHours(g))} ч`)));
  });

  /* гора стыда */
  const never = games.filter((g) => gameHours(g) === 0);
  const brief = games.filter((g) => gameHours(g) > 0 && gameHours(g) < 2);
  const shame = h('div', { class: 'block' }, h('h3', {}, 'Гора стыда'),
    h('p', { class: 'fact' }, h('b', {}, String(never.length)), ` ${plural(never.length, 'игра ни разу не запускалась', 'игры ни разу не запускались', 'игр ни разу не запускались')}, `,
      h('b', {}, String(brief.length)), ` ${plural(brief.length, 'игру', 'игры', 'игр')} открывали меньше чем на 2 часа.`),
    h('div', { class: 'techs', style: 'margin-top:10px' }, never.slice(0, 14).map((g) => h('span', { class: 'tech clickable', onclick: () => openProfile(g) }, g.name)),
      never.length > 14 && h('span', { class: 'tech' }, `и ещё ${never.length - 14}`)),
    never.length > 0 && h('div', { style: 'margin-top:14px' }, h('button', { class: 'btn ghost', onclick: openRoulette }, ico('dice', 14), 'Отдать на волю рулетки')));

  /* заброшенные любимцы */
  const abandoned = games.filter((g) => gameHours(g) >= 10 && lastPlayedMs(g) && Date.now() - lastPlayedMs(g) > 180 * DAY_MS)
    .sort((a, b) => gameHours(b) - gameHours(a)).slice(0, 8);
  const fav = h('div', { class: 'block' }, h('h3', {}, 'Давно не заходили'),
    h('p', { class: 'fact' }, 'Много времени вложено, но больше полугода не запускали.'));
  if (!abandoned.length) fav.append(h('div', { class: 'empty' }, 'Таких игр нет'));
  abandoned.forEach((g) => fav.append(h('div', { class: 'trow clickable', onclick: () => openProfile(g) },
    h('span', { class: 'nm', style: 'flex:1' }, g.name), h('span', { class: 'skill' }, agoText(lastPlayedMs(g))), h('span', { class: 'val' }, `${fmtH(gameHours(g))} ч`))));

  /* серия по авто-учёту */
  const perDay = {};
  Object.values(state.tracking).forEach((t) => Object.entries(t.days || {}).forEach(([d, s]) => { perDay[d] = (perDay[d] || 0) + s; }));
  const days = Object.keys(perDay).filter((d) => perDay[d] >= 300).sort();
  const extra = [];
  if (days.length) {
    let best = 1, run = 1;
    for (let i = 1; i < days.length; i++) {
      run = (Date.parse(days[i]) - Date.parse(days[i - 1])) / DAY_MS === 1 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    const bestDay = days.reduce((a, b) => (perDay[b] > perDay[a] ? b : a));
    extra.push(h('div', { class: 'block' }, h('h3', {}, 'Авто-учёт'),
      h('p', { class: 'fact' }, 'Дней с играми: ', h('b', {}, String(days.length)), ', лучшая серия: ', h('b', {}, `${best} ${plural(best, 'день', 'дня', 'дней')}`),
        ', самый долгий день: ', h('b', {}, `${fmtH(perDay[bestDay] / 3600)} ч`), ` (${bestDay}).`)));
  }

  /* цифры в масштабе */
  const scale = h('div', { class: 'block' }, h('h3', {}, 'В масштабе'),
    h('p', { class: 'fact' }, `Это ≈ `, h('b', {}, String(Math.round(total / 40))), ` ${plural(Math.round(total / 40), 'рабочая неделя', 'рабочие недели', 'рабочих недель')} по 40 часов `
      + `или ${Math.round((total / 24) * 10) / 10} суток подряд без сна и еды.`));

  page.append(h('div', { class: 'grid2' }, hist, statusBlock, genreStatsBlock(bars), topBlock, shame, fav, ...extra, scale));
  setTimeout(() => bars.forEach(([el, pct]) => { el.style.width = `${pct}%`; }), 200);
}

/* ---------- Быстрый поиск Ctrl+K ---------- */
function paletteItems() {
  const go = (p) => () => show(p);
  const items = [
    { label: 'Сводка', hint: 'перейти', run: go('home') }, { label: 'Игры', hint: 'перейти', run: go('games') },
    { label: 'Проекты', hint: 'перейти', run: go('projects') }, { label: 'Итоги', hint: 'перейти', run: go('stats') },
    { label: 'Желаемое', hint: 'вишлист Steam и скидки', run: go('wishlist') },
    { label: 'Проекты автора', hint: 'поддержать или поиграть', run: go('author') },
    { label: 'Настройки', hint: 'напоминания, уведомления, Steam', run: openSettings },
    { label: 'Что поиграть?', hint: 'рулетка', run: openRoulette },
    { label: 'Разбор библиотеки', hint: 'разложить игры по статусам', run: openTriage },
    { label: 'Добавить игру', hint: 'действие', run: () => { show('games'); addItem('games'); } },
    { label: 'Добавить проект', hint: 'действие', run: () => { show('projects'); addItem('projects'); } },
    { label: 'Проект из папки', hint: 'определит язык и git', run: () => { show('projects'); projectFromFolder(); } },
    { label: 'Особые игры', hint: 'Minecraft, osu!, Roblox…', run: () => { show('games'); openCatalog(); } },
    { label: 'Steam: импорт и синхронизация', hint: 'действие', run: openSteamModal },
    { label: 'Резервная копия', hint: 'сохранить данные в архив', run: doBackup },
    { label: 'Восстановить из копии', hint: 'загрузить архив', run: doRestore },
  ].map((it) => ({ ...it, kind: 'action' }));
  const games = state.data.games.map((g) => ({
    label: g.name, kind: 'game', hint: `${fmtH(gameHours(g))} ч · ${g.status}`, game: g,
    extra: [...gameGenres(g), ...gameFeatures(g), ...gameTags(g)].join(' ').toLowerCase(),
    run: () => {
      if (g.appid) { api.launch_steam(g.appid); toast(`Запуск «${g.name}» через Steam`); }
      else if (g.source === 'author') { api.author_launch(g.ckey.slice(7)).then((ok) => { if (ok) toast(`Запуск «${g.name}»`); else openProfile(g); }); }
      else openProfile(g);
    },
  }));
  const projects = state.data.projects.map((p) => ({
    label: p.name, kind: 'project', hint: 'проект · открыть папку',
    run: async () => { if (!(await api.open_path(p.path))) toast('Папка проекта не указана', 'err'); },
  }));
  return [...items, ...games, ...projects];
}

function openPalette() {
  if ($('.palette-back')) return;
  const all = paletteItems();
  const input = h('input', { type: 'text', placeholder: 'Игра, проект или действие…', spellcheck: 'false' });
  const list = h('div', { class: 'pal-list' });
  let shownItems = [], sel = 0;

  const score = (it, tokens) => {
    const label = it.label.toLowerCase();
    let s = 0;
    for (const t of tokens) {
      const pos = label.indexOf(t);
      if (pos < 0) {
        if (it.extra && it.extra.includes(t)) { s += 8; continue; }  // совпало с жанром или меткой
        return -1;
      }
      s += pos === 0 ? 0 : label[pos - 1] === ' ' ? 2 : 5;
    }
    return s + (it.kind === 'action' ? 0 : 1);
  };

  const draw = () => {
    const tokens = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      const recent = all.filter((i) => i.kind === 'game').sort((a, b) => lastPlayedMs(b.game) - lastPlayedMs(a.game)).slice(0, 5);
      shownItems = [...all.filter((i) => i.kind === 'action').slice(0, 5), ...recent];
    } else {
      shownItems = all.map((it) => [it, score(it, tokens)]).filter((x) => x[1] >= 0)
        .sort((a, b) => a[1] - b[1] || a[0].label.localeCompare(b[0].label, 'ru')).slice(0, 9).map((x) => x[0]);
    }
    sel = Math.min(sel, Math.max(0, shownItems.length - 1));
    list.replaceChildren(...(shownItems.length ? shownItems.map((it, i) => h('div', {
      class: `pal-item${i === sel ? ' sel' : ''}`,
      onmouseenter: () => { sel = i; list.querySelectorAll('.pal-item').forEach((el, j) => el.classList.toggle('sel', j === i)); },
      onclick: () => choose(it, false),
    }, h('span', { class: 'pal-kind' }, it.kind === 'game' ? 'игра' : it.kind === 'project' ? 'проект' : 'действие'),
    h('span', { class: 'pal-label' }, it.label), h('span', { class: 'pal-hint' }, it.hint))) : [h('div', { class: 'empty' }, 'Ничего не найдено')]));
  };

  const back = h('div', { class: 'backdrop palette-back' }, h('div', { class: 'modal pal' }, input, list,
    h('div', { class: 'pal-foot' }, h('span', {}, '↑↓ выбор'), h('span', {}, 'Enter: запустить или открыть'), h('span', {}, 'Shift+Enter: профиль'), h('span', {}, 'Esc'))));
  const close = () => { document.removeEventListener('keydown', onKey, true); back.classList.remove('open'); setTimeout(() => back.remove(), 200); };
  function choose(it, profile) {
    close();
    setTimeout(() => { if (profile && it.game) openProfile(it.game); else it.run(); }, 120);
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, shownItems.length); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + shownItems.length) % Math.max(1, shownItems.length); draw(); }
    else if (e.key === 'Enter' && shownItems[sel]) { e.preventDefault(); choose(shownItems[sel], e.shiftKey); }
  }
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  input.addEventListener('input', () => { sel = 0; draw(); });
  document.addEventListener('keydown', onKey, true);
  $('#modal-root').append(back);
  draw();
  requestAnimationFrame(() => requestAnimationFrame(() => back.classList.add('open')));
  setTimeout(() => input.focus(), 60);
}

/* ---------- Достижения Steam (вкладка в профиле) ---------- */
function achIcon(url) {
  if (!url) return h('div', { class: 'ach-ph' });
  const img = h('img', { src: url, alt: '', loading: 'lazy', width: 44, height: 44 });
  img.addEventListener('error', () => img.replaceWith(h('div', { class: 'ach-ph' })));
  return img;
}

function achievementsTab(g) {
  const box = h('div', {}, h('div', { class: 'empty' }, 'Загружаю достижения из Steam…'));
  api.steam_achievements(g.appid).then((res) => {
    box.replaceChildren();
    if (!res.ok) { box.append(h('div', { class: 'empty' }, res.error)); return; }
    const items = res.items;
    const pct = Math.round((res.unlocked / res.total) * 100);
    const rare = items.filter((i) => i.achieved && i.percent >= 0).sort((a, b) => a.percent - b.percent)[0];
    const fillEl = h('i', {});
    box.append(h('div', { class: 'ach-head' },
      h('div', { class: 'm-cur' }, `${res.unlocked}`, h('small', { class: 'ach-of' }, ` из ${res.total}`)),
      h('div', { class: 'ach-pct' }, `${pct}%`)),
    h('div', { class: 'track' }, fillEl),
    rare && h('p', { class: 'fact', style: 'margin-top:10px' }, 'Самое редкое у вас: ', h('b', {}, rare.name), ` — есть у ${rare.percent}% игроков.`));
    setTimeout(() => { fillEl.style.width = `${pct}%`; }, 150);

    let filter = 'all', limit = 40;
    const tabs = h('div', { class: 'stabs', style: 'margin:16px 0 8px' });
    const listEl = h('div', { class: 'ach-list' });
    const FILTERS = [['all', 'Все'], ['done', 'Открытые'], ['todo', 'Закрытые'], ['rare', 'Редкие (<10%)']];
    const draw = () => {
      let rows = items.filter((i) => filter === 'all' || (filter === 'done' && i.achieved) || (filter === 'todo' && !i.achieved)
        || (filter === 'rare' && i.percent >= 0 && i.percent < 10));
      rows = rows.sort((a, b) => (a.achieved === b.achieved ? (a.achieved ? b.time - a.time : b.percent - a.percent) : a.achieved ? -1 : 1));
      listEl.replaceChildren(...rows.slice(0, limit).map((i) => h('div', { class: `ach${i.achieved ? '' : ' locked'}` },
        achIcon(i.achieved ? i.icon : i.icon_gray || i.icon),
        h('div', { class: 'ach-txt' }, h('b', {}, i.hidden && !i.achieved ? 'Скрытое достижение' : i.name),
          h('small', {}, i.hidden && !i.achieved ? 'Описание откроется после получения' : i.desc || '—')),
        h('div', { class: 'ach-side' }, i.percent >= 0 && h('span', { class: i.percent < 10 ? 'rare' : '' }, `${i.percent}%`),
          i.achieved && i.time > 0 && h('small', {}, new Date(i.time * 1000).toLocaleDateString('ru-RU'))))));
      if (rows.length > limit) listEl.append(h('button', { class: 'btn ghost', style: 'grid-column:1/-1;justify-self:center',
        onclick: () => { limit += 60; draw(); } }, `Показать ещё ${rows.length - limit}`));
      if (!rows.length) listEl.append(h('div', { class: 'empty' }, 'Здесь пусто'));
    };
    FILTERS.forEach(([id, label]) => tabs.append(h('button', { class: `stab${id === filter ? ' active' : ''}`, onclick: (e) => {
      filter = id; limit = 40; tabs.querySelectorAll('.stab').forEach((t) => t.classList.toggle('active', t === e.currentTarget)); draw();
    } }, label)));
    box.append(tabs, listEl);
    draw();
  });
  return box;
}

/* ---------- Проекты: из папки, git, редактор ---------- */
const scanCache = new Map();
async function scanProject(path) {
  const hit = scanCache.get(path);
  if (hit && Date.now() - hit.at < 120000) return hit.info;
  const info = await api.project_scan(path);
  scanCache.set(path, { at: Date.now(), info });
  return info;
}

async function projectFromFolder() {
  const folder = await api.pick_folder();
  if (!folder) return;
  const info = await api.project_scan(folder);
  if (!info.ok) { toast('Не удалось прочитать папку', 'err'); return; }
  const draft = { status: 'В работе', progress: 0, path: folder, name: info.name, notes: info.description || '',
    tech: (info.tech || []).join(', '), link: info.git?.remote || '' };
  const result = await openForm('Добавить проект', PROJECT_FIELDS, draft);
  if (!result) return;
  result.id = uid();
  state.data.projects.push(result);
  persist();
  if (state.page !== 'projects') show('projects'); else render(true);
  toast('Проект добавлен');
}

/* Строка про git/активность под проектом; заполняется после анализа папки */
function projectInfoLine(p) {
  const line = h('div', { class: 'git-line' });
  if (!p.path) return null;
  scanProject(p.path).then((info) => {
    if (!info || !info.ok) { line.remove(); return; }
    const parts = [];
    if (info.git) {
      parts.push(info.git.branch, info.git.dirty ? `${info.git.dirty} ${plural(info.git.dirty, 'изменение', 'изменения', 'изменений')}` : 'чисто',
        `${info.git.commits} ${plural(info.git.commits, 'коммит', 'коммита', 'коммитов')}`);
      if (info.git.last_time) parts.push(`последний ${agoText(info.git.last_time * 1000)}`);
      line.title = info.git.last_message ? `Последний коммит: ${info.git.last_message}` : '';
      if (info.git.dirty) line.classList.add('dirty');
    } else if (info.modified) {
      parts.push(`изменён ${agoText(Date.parse(info.modified))}`);
    }
    line.textContent = parts.join(' · ');
  });
  return line;
}

/* ---------- Резервные копии ---------- */
async function doBackup() {
  const res = await api.export_backup();
  if (res.ok) toast(`Копия сохранена: ${res.path}`);
  else if (!res.cancelled) toast(res.error || 'Не удалось сохранить копию', 'err');
}

async function doRestore() {
  if (!(await confirmBox('Восстановить из копии?', 'Текущий список игр и проектов будет заменён данными из архива. Прежние данные сохранятся рядом в файлах .bak.', 'Выбрать архив', 'primary'))) return;
  const res = await api.import_backup();
  if (res.ok) { state.data = res.data; render(true); toast('Данные восстановлены'); }
  else if (!res.cancelled) toast(res.error || 'Не удалось восстановить', 'err');
}

/* ---------- Автоматический скилл при запуске ---------- */
async function autoSkillRun() {
  const due = state.data.games.filter((g) => g.auto_skill && autoKind(g) && (!g.auto_skill_at || Date.now() - g.auto_skill_at > 20 * 3600 * 1000)).slice(0, 8);
  let updated = 0;
  for (const g of due) {
    const arg = autoKind(g) === 'osu' ? g.osu_user : g.appid;
    if (!arg) continue;
    try {
      const res = await api.skill_fetch(autoKind(g), arg);
      if (res.ok && applyAutoValues(g, res.values)) updated += 1;
    } catch (err) { /* нет сети: попробуем при следующем запуске */ }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (due.length) { persist(); if (updated) toast(`Скилл обновлён автоматически: ${updated}`); }
}

/* ---------- Авто-синхронизация Steam ---------- */
async function autoSync() {
  if (!state.settings.has_key || !state.prefs.steam_autosync) return;
  try {
    const res = await api.steam_import();
    if (!res.ok) return;
    // не подменяем объекты (открытые окна держат ссылки на них), только обновляем поля по id
    const byId = new Map(state.data.games.map((g) => [g.id, g]));
    for (const fresh of res.data.games) {
      const mine = byId.get(fresh.id);
      if (mine) Object.assign(mine, { hours: fresh.hours, last_played: fresh.last_played, recent: fresh.recent, installed: fresh.installed });
      else state.data.games.push(fresh);
    }
    state.settings.last_sync = res.last_sync;
    if (!document.querySelector('.backdrop')) render(false);
    updateSteamChip();
  } catch (err) { /* нет сети: тихо пропускаем */ }
}

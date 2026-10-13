'use strict';
/* Профиль игры: время (авто-учёт), скилл, особые разделы + каталог особых игр.
   Загружается ДО app.js: здесь только объявления, обращения к state/h/api происходят позже. */

const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  : Math.random().toString(36).slice(2, 14));

const RANK_LADDERS = {
  valorant: ['Железо', 'Бронза', 'Серебро', 'Золото', 'Платина', 'Алмаз', 'Асцендант', 'Бессмертный', 'Радиант'],
  lol: ['Железо', 'Бронза', 'Серебро', 'Золото', 'Платина', 'Изумруд', 'Алмаз', 'Мастер', 'Грандмастер', 'Претендент'],
};

const TEMPLATES = {
  minecraft: {
    metrics: [],
    sections: [
      { id: 'worlds', title: 'Миры', auto: 'minecraft' },
      { id: 'bases', title: 'Базы и координаты', special: 'coords', fields: [
        { key: 'name', label: 'Название базы', primary: true },
        { key: 'dim', label: 'Измерение', type: 'choice', options: ['Верхний мир', 'Незер', 'Энд'] },
        { key: 'x', label: 'X', w: 72, prefix: 'X ' }, { key: 'y', label: 'Y', w: 72, prefix: 'Y ' }, { key: 'z', label: 'Z', w: 72, prefix: 'Z ' },
        { key: 'note', label: 'Заметка' }] },
      { id: 'mods', title: 'Моды и сборки', fields: [
        { key: 'name', label: 'Мод / сборка', primary: true }, { key: 'version', label: 'Версия', w: 110 }, { key: 'note', label: 'Заметка' }] },
      { id: 'goals', title: 'Цели', fields: [
        { key: 'done', type: 'check' }, { key: 'text', label: 'Что построить / добыть', primary: true }] },
    ],
  },
  roblox: {
    metrics: [],
    sections: [
      { id: 'places', title: 'Избранные плейсы', fields: [
        { key: 'name', label: 'Название плейса', primary: true }, { key: 'link', label: 'Ссылка', type: 'link' }, { key: 'note', label: 'Заметка' }] },
      { id: 'wishlist', title: 'Хотелки (Robux)', total: { key: 'price', suffix: ' R$' }, fields: [
        { key: 'name', label: 'Что хочу купить', primary: true }, { key: 'price', label: 'Цена', w: 90, suffix: ' R$' }] },
    ],
  },
  osu: {
    metrics: [
      { label: 'PP', kind: 'number' },
      { label: 'Глобальный ранг', kind: 'number', lowerBetter: true },
      { label: 'Точность, %', kind: 'number' },
    ],
    sections: [
      { id: 'maps', title: 'Карты-цели', fields: [
        { key: 'name', label: 'Карта', primary: true }, { key: 'stars', label: 'Звёзды', w: 80, suffix: ' ★' },
        { key: 'status', label: 'Статус', type: 'choice', options: ['Хочу пройти', 'Пройдена', 'FC', 'SS'] }] },
    ],
  },
  valorant: {
    metrics: [{ label: 'Ранг', kind: 'rank', ladder: 'valorant' }],
    sections: [
      { id: 'agents', title: 'Агенты', fields: [
        { key: 'name', label: 'Агент', primary: true },
        { key: 'role', label: 'Роль', type: 'choice', options: ['Дуэлянт', 'Страж', 'Разведчик', 'Инициатор'] }, { key: 'note', label: 'Заметка' }] },
    ],
  },
  lol: {
    metrics: [{ label: 'Ранг', kind: 'rank', ladder: 'lol' }],
    sections: [
      { id: 'champs', title: 'Чемпионы', fields: [
        { key: 'name', label: 'Чемпион', primary: true },
        { key: 'role', label: 'Роль', type: 'choice', options: ['Топ', 'Лес', 'Мид', 'АДК', 'Саппорт'] }, { key: 'note', label: 'Заметка' }] },
    ],
  },
};

/* ---------- Иконки игр вне Steam ---------- */
/* Приоритет: настоящая иконка с ПК (g.icon) -> наш значок по каталогу -> первая буква. */
const GLYPH_BODIES = {
  cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9"/>',
  ring: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>',
  tilt: '<path d="M7 4l13 3.5L16.5 20 4 16.5z"/><path d="M10.6 10.4l3 .8-.8 3-3-.8z"/>',
  vee: '<path d="M3.5 5.5L11 18.5h3.2L20.5 8"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.3-3 7.6-7.5 9.5-4.5-1.9-7.5-5.2-7.5-9.5V6z"/>',
  chute: '<path d="M3 11a9 9 0 0 1 18 0c-1.5-1.4-3.2-1.4-4.5 0-1.3-1.4-3.2-1.4-4.5 0-1.3-1.4-3.2-1.4-4.5 0C6.2 9.6 4.5 9.6 3 11z"/><path d="M7.5 12.5L12 20l4.5-7.5"/>',
  star: '<path d="M12 3c.8 5 4 8.2 9 9-5 .8-8.2 4-9 9-.8-5-4-8.2-9-9 5-.8 8.2-4 9-9z"/>',
};
const GLYPH_FOR = {
  minecraft_java: 'cube', minecraft_bedrock: 'cube', tlauncher: 'cube', osu: 'ring', roblox: 'tilt',
  valorant: 'vee', lol: 'shield', fortnite: 'chute', genshin: 'star',
};

function monoTile(name, hue, ckey, iconSize, cls = 'mono', icon = '') {
  const tile = h('div', { class: cls, style: `--h:${hue}` });
  if (icon) {
    tile.append(h('img', { class: 'game-icon', alt: '', width: iconSize, height: iconSize, src: icon }));
  } else if (GLYPH_FOR[ckey]) {
    const glyph = h('span', { class: 'glyph' });
    // в разметку попадают только статичные пути из GLYPH_BODIES
    glyph.innerHTML = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${GLYPH_BODIES[GLYPH_FOR[ckey]]}</svg>`;
    tile.append(glyph);
  } else {
    tile.append(h('span', { class: 'ml' }, (name || '?')[0].toUpperCase()));
  }
  return tile;
}

/* ---------- Время ---------- */
const trackedSec = (g) => (state.tracking[g.id]?.seconds || 0);
const gameHours = (g) => num(g.hours) + trackedSec(g) / 3600;
const isLive = (g) => state.running.includes(g.id);

/* ---------- Метрики скилла ---------- */
function ensureMetrics(g) {
  if (Array.isArray(g.skills)) return;
  const preset = TEMPLATES[g.template]?.metrics || [];
  g.skills = preset.map((m) => ({ id: uid(), ...m, entries: [] }));
}

function metricText(m, v) {
  if (m.kind === 'rank') {
    const ladder = RANK_LADDERS[m.ladder] || [];
    const i = Math.max(0, Math.min(ladder.length - 1, Math.floor(v / 3)));
    return ladder[i] + (i < ladder.length - 1 ? ` ${(v % 3) + 1}` : '');
  }
  return String(Math.round(v * 100) / 100);
}

function metricDelta(m) {
  if (m.entries.length < 2) return null;
  const d = m.entries[m.entries.length - 1].v - m.entries[m.entries.length - 2].v;
  if (d === 0) return { txt: '— без изменений', good: null };
  const good = m.lowerBetter ? d < 0 : d > 0;
  const unit = m.kind === 'rank' ? ' дивиз.' : '';
  return { txt: `${d > 0 ? '▲ +' : '▼ −'}${Math.abs(Math.round(d * 100) / 100)}${unit}`, good };
}

/* Краткая строка скилла для карточки */
function skillBadge(g) {
  const m = (g.skills || []).find((x) => x.entries.length);
  if (!m) return null;
  const d = metricDelta(m);
  return { text: `${m.label}: ${metricText(m, m.entries[m.entries.length - 1].v)}`, good: d ? d.good : null };
}

function sparkline(m) {
  const e = m.entries.slice(-30);
  if (!e.length) return h('div', { class: 'empty' }, 'Пока нет записей — добавь первый результат ниже');
  const W = 320, H = 84, P = 9;
  const vals = e.map((x) => x.v);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pts = e.map((x, i) => {
    let t = (x.v - lo) / (hi - lo);
    if (m.lowerBetter) t = 1 - t;
    return [e.length === 1 ? W / 2 : P + (i * (W - 2 * P)) / (e.length - 1), H - P - t * (H - 2 * P)];
  });
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1], first = pts[0];
  const gid = `g${uid()}`;
  const wrap = h('div', { class: 'spark' });
  // в разметку попадают только вычисленные числа, пользовательских строк нет
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">`
    + '<stop offset="0" stop-color="#8b5cff" stop-opacity=".45"/><stop offset="1" stop-color="#8b5cff" stop-opacity="0"/></linearGradient></defs>'
    + `<path d="${path} L${last[0].toFixed(1)} ${H} L${first[0].toFixed(1)} ${H} Z" fill="url(#${gid})"/>`
    + `<path class="line" d="${path}" pathLength="1"/>`
    + pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.4"/>`).join('') + '</svg>';
  return wrap;
}

function metricBlock(g, m, redraw) {
  const cur = m.entries.length ? m.entries[m.entries.length - 1] : null;
  const delta = metricDelta(m);

  let ctrl, readValue;
  if (m.kind === 'rank') {
    const ladder = RANK_LADDERS[m.ladder] || [];
    const rank = h('select', {}, ladder.map((n, i) => h('option', { value: i }, n)));
    const div = h('select', {}, [1, 2, 3].map((d) => h('option', { value: d }, `Дивизион ${d}`)));
    if (cur) { rank.value = String(Math.floor(cur.v / 3)); div.value = String((cur.v % 3) + 1); }
    ctrl = h('div', { class: 'inline' }, rank, div);
    readValue = () => Number(rank.value) * 3 + Number(div.value) - 1;
  } else {
    const input = h('input', { class: 'input', type: 'text', inputmode: 'decimal', placeholder: 'Новое значение' });
    ctrl = input;
    readValue = () => {
      const raw = input.value.trim().replace(',', '.');
      return raw === '' || Number.isNaN(parseFloat(raw)) ? null : parseFloat(raw);
    };
  }
  const note = h('input', { class: 'input', type: 'text', placeholder: 'Заметка (необязательно)' });
  const add = h('button', { class: 'btn', onclick: () => {
    const v = readValue();
    if (v === null) { toast('Введи число', 'err'); return; }
    m.entries.push({ t: new Date().toISOString(), v, note: note.value.trim() });
    persist(); redraw(); toast('Результат записан', 'ok');
  } }, 'Записать');

  return h('div', { class: 'box metric' },
    h('div', { class: 'm-head' },
      h('div', {}, h('div', { class: 'm-label' }, m.label + (m.lowerBetter ? ' (меньше — лучше)' : '')),
        h('div', { class: 'm-cur' }, cur ? metricText(m, cur.v) : '—')),
      delta && h('span', { class: `delta ${delta.good === true ? 'up' : delta.good === false ? 'down' : ''}` }, delta.txt),
      h('button', { class: 'tbtn del', title: 'Удалить метрику', onclick: () => {
        g.skills.splice(g.skills.indexOf(m), 1); persist(); redraw();
      } }, ico('trash', 14))),
    sparkline(m),
    h('div', { class: 'm-input' }, ctrl, note, add),
    m.entries.length > 0 && h('div', { class: 'entries' }, m.entries.slice(-5).reverse().map((e) =>
      h('div', { class: 'entry' }, h('span', {}, new Date(e.t).toLocaleDateString('ru-RU')), h('b', {}, metricText(m, e.v)), h('em', {}, e.note || '')))));
}

/* Автоматические значения (osu!, достижения Steam): одна точка в день, без дублей */
function applyAutoValues(g, values) {
  ensureMetrics(g);
  const today = new Date().toISOString().slice(0, 10);
  let changed = false;
  for (const [label, v] of Object.entries(values)) {
    let metric = g.skills.find((x) => x.label === label);
    if (!metric) {
      metric = { id: uid(), label, kind: 'number', lowerBetter: label === 'Глобальный ранг', entries: [] };
      g.skills.push(metric);
    }
    const last = metric.entries[metric.entries.length - 1];
    if (last && last.auto && last.t.slice(0, 10) === today) { if (last.v !== v) { last.v = v; changed = true; } continue; }
    if (last && last.v === v) continue;
    metric.entries.push({ t: new Date().toISOString(), v, note: 'авто', auto: true });
    changed = true;
  }
  g.auto_skill_at = Date.now();
  return changed;
}

const autoKind = (g) => (g.template === 'osu' ? 'osu' : g.appid ? 'steam_ach' : null);

function autoSkillPanel(g, redraw) {
  const kind = autoKind(g);
  if (!kind) return null;
  const nick = kind === 'osu' ? h('input', { class: 'input', type: 'text', value: g.osu_user || '', placeholder: 'Ваш ник в osu!',
    oninput: (e) => { g.osu_user = e.target.value.trim(); } }) : null;
  const run = async (button) => {
    button.classList.add('busy');
    try {
      const res = await api.skill_fetch(kind, kind === 'osu' ? g.osu_user : g.appid);
      if (!res.ok) { toast(res.error, 'err'); return; }
      const changed = applyAutoValues(g, res.values);
      persist(); redraw(); toast(changed ? 'Данные обновлены' : 'Изменений нет');
    } finally { button.classList.remove('busy'); }
  };
  const button = h('button', { class: 'btn ghost', onclick: () => run(button) }, ico('refresh', 14), 'Обновить сейчас');
  return h('div', { class: 'box auto-skill' },
    h('div', { class: 'sub-h', style: 'margin-top:0' }, kind === 'osu' ? 'Автоматически из профиля osu!' : 'Автоматически из достижений Steam'),
    h('p', { class: 'hint', style: 'margin:0 0 10px' }, kind === 'osu'
      ? 'PP, глобальный ранг и точность берутся с публичной страницы игрока. Ключи не нужны.'
      : 'Процент открытых достижений и число редких. Нужен открытый профиль Steam, ключ не нужен.'),
    h('div', { class: 'inline' }, nick, button),
    switchRow('Обновлять сам при запуске', 'Раз в сутки, пока приложение открыто.', !!g.auto_skill, (v) => {
      g.auto_skill = v; persist();
      if (v && kind === 'osu' && !g.osu_user) toast('Укажите ник в osu!, чтобы обновление работало', 'err');
    }));
}

function skillTab(g) {
  ensureMetrics(g);
  const box = h('div', {});
  const draw = () => {
    box.replaceChildren();
    const panel = autoSkillPanel(g, draw);
    if (panel) box.append(panel);
    g.skills.forEach((m) => box.append(metricBlock(g, m, draw)));
    if (!g.skills.length) box.append(h('p', { class: 'lead' }, 'Отслеживай свой рост: ранг, K/D, винрейт, PP, личный рекорд — что угодно. Создай метрику и записывай результаты.'));

    const label = h('input', { class: 'input', type: 'text', placeholder: 'Новая метрика: K/D, Винрейт %, Рекорд…' });
    const dir = h('select', { class: 'input', style: 'max-width:190px' },
      h('option', { value: 'up' }, 'Больше — лучше'), h('option', { value: 'down' }, 'Меньше — лучше'));
    const ladders = Object.keys(RANK_LADDERS).filter((k) => k === g.template);
    box.append(h('div', { class: 'add-row', style: 'margin-top:14px' }, label, dir,
      h('button', { class: 'btn ghost', onclick: () => {
        const name = label.value.trim();
        if (!name) { toast('Введи название метрики', 'err'); return; }
        g.skills.push({ id: uid(), label: name, kind: 'number', lowerBetter: dir.value === 'down', entries: [] });
        persist(); draw();
      } }, 'Добавить метрику'),
      ladders.length > 0 && !g.skills.some((m) => m.kind === 'rank') && h('button', { class: 'btn ghost', onclick: () => {
        g.skills.push({ id: uid(), label: 'Ранг', kind: 'rank', ladder: g.template, entries: [] }); persist(); draw();
      } }, 'Добавить ранг')));
  };
  draw();
  return box;
}

/* ---------- Вкладка «Время» ---------- */
function lastDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return days;
}

function daysChart(secondsByDay, n = 14) {
  const days = lastDays(n);
  const vals = days.map((d) => (secondsByDay[d] || 0) / 3600);
  const max = Math.max(0.25, ...vals);
  const chart = h('div', { class: 'daychart' });
  const fills = [];
  days.forEach((d, i) => {
    const fill = h('i', {});
    fills.push([fill, (vals[i] / max) * 100]);
    chart.append(h('div', { class: 'day', title: `${d}: ${fmtH(vals[i])} ч` }, h('div', { class: 'col' }, fill), h('span', {}, d.slice(8))));
  });
  setTimeout(() => fills.forEach(([el, pct]) => { el.style.height = `${Math.max(pct, vals.length && pct > 0 ? 4 : 0)}%`; }), 150);
  return chart;
}

function timeTab(g) {
  const t = state.tracking[g.id] || { seconds: 0, days: {}, last: '' };
  const box = h('div', {});
  box.append(h('div', { class: 'mini-stats' },
    h('div', { class: 'box mstat' }, h('b', {}, `${fmtH(gameHours(g))} ч`), h('span', {}, 'Всего')),
    h('div', { class: 'box mstat' }, h('b', {}, `${fmtH(t.seconds / 3600)} ч`), h('span', {}, 'Авто-учёт')),
    h('div', { class: 'box mstat' }, h('b', {}, t.last ? new Date(t.last).toLocaleDateString('ru-RU') : '—'), h('span', {}, 'Последний запуск'))));
  if (isLive(g)) box.append(h('div', { class: 'live-line' }, '● Сейчас в игре — время идёт'));
  box.append(h('h3', { class: 'sub-h' }, 'Последние 14 дней'), daysChart(t.days || {}));

  const proc = h('input', { class: 'input', type: 'text', value: g.process || '', placeholder: 'например osu!.exe' });
  const cmd = h('input', { class: 'input', type: 'text', value: g.process_cmd || '', placeholder: 'необязательно: слово из командной строки' });
  box.append(h('h3', { class: 'sub-h' }, 'Авто-учёт времени'),
    h('p', { class: 'hint' }, 'Приложение раз в 15 секунд проверяет, запущен ли процесс игры, и копит время само. Имя .exe можно посмотреть в диспетчере задач (Ctrl+Shift+Esc). Для Java-игр добавь фильтр, например «minecraft», чтобы не считать другие Java-программы.'),
    h('div', { class: 'field' }, h('label', {}, 'Процесс игры (.exe)'), proc),
    h('div', { class: 'field' }, h('label', {}, 'Фильтр командной строки'), cmd),
    h('button', { class: 'btn', onclick: () => {
      g.process = proc.value.trim(); g.process_cmd = cmd.value.trim(); persist();
      toast(g.process ? 'Сохранено — время считается, пока игра запущена' : 'Авто-учёт выключен', 'ok');
    } }, 'Сохранить'));
  return box;
}

/* ---------- Списки особых разделов ---------- */
function listSection(g, sec) {
  g.extra = g.extra || {};
  const list = (g.extra[sec.id] = g.extra[sec.id] || []);
  const body = h('div', { class: 'li-list' });
  const foot = h('div', { class: 'li-total' });

  const draw = () => {
    body.replaceChildren();
    if (!list.length) body.append(h('div', { class: 'empty' }, 'Пока пусто — добавь первую запись ниже'));
    list.forEach((it, i) => {
      const main = h('div', { class: 'li-main' });
      sec.fields.forEach((f) => {
        if (f.type === 'check') {
          main.append(h('input', { type: 'checkbox', checked: it[f.key] ? 'checked' : null,
            onchange: (e) => { it[f.key] = e.target.checked; persist(); draw(); } }));
          return;
        }
        const val = it[f.key];
        if (val === undefined || val === '') return;
        if (f.type === 'link') main.append(h('span', { class: 'link', onclick: () => api.open_link(val) }, val));
        else main.append(h('span', { class: f.primary ? 'li-name' : 'li-dim' }, `${f.prefix || ''}${val}${f.suffix || ''}`));
      });
      if (sec.special === 'coords') {
        const x = parseFloat(it.x), z = parseFloat(it.z);
        if (!Number.isNaN(x) && !Number.isNaN(z)) {
          if (it.dim === 'Верхний мир') main.append(h('span', { class: 'li-tip' }, `→ Незер: ${Math.round(x / 8)}, ${Math.round(z / 8)}`));
          else if (it.dim === 'Незер') main.append(h('span', { class: 'li-tip' }, `→ Верхний мир: ${Math.round(x * 8)}, ${Math.round(z * 8)}`));
        }
      }
      body.append(h('div', { class: `li${it.done ? ' done' : ''}` }, main,
        h('button', { class: 'tbtn del', onclick: () => { list.splice(i, 1); persist(); draw(); } }, ico('close', 12))));
    });
    if (sec.total) {
      const sum = list.reduce((s, it) => s + num(it[sec.total.key]), 0);
      foot.textContent = `Итого: ${Math.round(sum * 100) / 100}${sec.total.suffix}`;
    }
  };

  const ctrls = {};
  const addRow = h('div', { class: 'add-row' });
  sec.fields.filter((f) => f.type !== 'check').forEach((f) => {
    const c = f.type === 'choice'
      ? h('select', { class: 'input' }, f.options.map((o) => h('option', { value: o }, o)))
      : h('input', { class: 'input', type: 'text', placeholder: f.label, style: f.w ? `width:${f.w}px;flex:none` : null });
    ctrls[f.key] = c; addRow.append(c);
  });
  const addItem = () => {
    const first = sec.fields.find((f) => f.type !== 'check');
    if (!ctrls[first.key].value.trim()) { toast('Заполни первое поле', 'err'); return; }
    const item = {};
    sec.fields.forEach((f) => {
      if (f.type === 'check') item[f.key] = false;
      else { item[f.key] = ctrls[f.key].value.trim(); if (f.type !== 'choice') ctrls[f.key].value = ''; }
    });
    list.push(item); persist(); draw();
    ctrls[first.key].focus();
  };
  addRow.append(h('button', { class: 'btn', onclick: addItem }, 'Добавить'));
  addRow.addEventListener('keydown', (e) => { if (e.key === 'Enter') addItem(); });
  draw();
  return h('div', {}, body, sec.total && foot, addRow);
}

/* ---------- Миры Minecraft ---------- */
function worldsSection(g) {
  const box = h('div', {}, h('div', { class: 'empty' }, 'Ищу миры…'));
  api.minecraft_info(g.edition || 'java').then((info) => {
    box.replaceChildren();
    if (!info.found) {
      box.append(h('div', { class: 'empty' }, g.edition === 'bedrock'
        ? 'Папка миров Bedrock не найдена. Убедись, что Minecraft Bedrock запускался на этом ПК.'
        : 'Папка .minecraft/saves не найдена. Если играешь через другой лаунчер, миры могут лежать в его папке.'));
      return;
    }
    if (!info.worlds.length) { box.append(h('div', { class: 'empty' }, 'Миров пока нет')); return; }
    const summary = h('div', { class: 'world-sum' }, `Миров: ${info.worlds.length}`);
    if (g.edition !== 'bedrock') {
      summary.append(` · по статистике миров ≈ ${fmtH(info.total_hours)} ч`);
      if (info.total_hours > 0) {
        summary.append(h('button', { class: 'tbtn', style: 'margin-left:12px', onclick: () => {
          g.hours = Math.max(0, Math.round((info.total_hours - trackedSec(g) / 3600) * 10) / 10);
          persist(); toast(`Часы взяты из статистики: ≈ ${fmtH(info.total_hours)} ч`, 'ok');
        } }, 'Взять часы из статистики'));
      }
    }
    box.append(summary);
    info.worlds.forEach((w) => box.append(h('div', { class: 'li' },
      h('div', { class: 'li-main' }, h('span', { class: 'li-name' }, w.name),
        h('span', { class: 'li-dim' }, `играл: ${w.last}`), w.hours !== null && h('span', { class: 'li-tip' }, `≈ ${fmtH(w.hours)} ч`)))));
  });
  return box;
}

/* ---------- Окно профиля игры ---------- */
function openProfile(g, startTab = 'overview') {
  ensureMetrics(g);
  const tpl = TEMPLATES[g.template];
  const tabs = [
    { id: 'overview', title: 'Обзор', build: () => overviewTab(g) },
    { id: 'time', title: 'Время', build: () => timeTab(g) },
    { id: 'skill', title: 'Скилл', build: () => skillTab(g) },
    ...(g.appid ? [{ id: 'ach', title: 'Достижения', build: () => achievementsTab(g) }] : []),
    ...(tpl ? tpl.sections.map((sec) => ({ id: sec.id, title: sec.title,
      build: () => (sec.auto === 'minecraft' ? worldsSection(g) : listSection(g, sec)) })) : []),
  ];
  const content = h('div', { class: 'tab-body' });
  const bar = h('div', { class: 'tabs' });
  const select = (id) => {
    bar.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
    content.replaceChildren(tabs.find((t) => t.id === id).build());
    content.classList.remove('swap'); void content.offsetWidth; content.classList.add('swap');
  };
  tabs.forEach((t) => bar.append(h('button', { class: 'tab', 'data-tab': t.id, onclick: () => select(t.id) }, t.title)));
  const head = h('div', { class: 'prof-head' },
    monoTile(g.name, g.hue ?? hueOf(g.name), g.ckey, 34, 'mono', g.icon),
    h('div', {}, h('h2', {}, g.name), h('div', { class: 'card-sub' }, `${gameGenre(g) || 'Игра'} · ${fmtH(gameHours(g))} ч`)));
  const close = openModal([head, bar, content,
    h('div', { class: 'modal-actions' }, h('button', { class: 'btn ghost', onclick: () => close() }, 'Закрыть'))],
  'wide', () => render(false));
  select(startTab);
}

/* ---------- Каталог особых игр ---------- */
async function openCatalog() {
  const entries = await api.get_catalog();
  const grid = h('div', { class: 'catalog' });
  const draw = () => {
    grid.replaceChildren();
    entries.forEach((c) => {
      const added = state.data.games.some((g) => g.ckey === c.key);
      grid.append(h('div', { class: 'box cat-item' },
        monoTile(c.name, c.hue, c.key, 28, 'mono', c.icon),
        h('div', { class: 'cat-info' }, h('b', {}, c.name), h('small', {}, c.genre),
          c.installed && h('span', { class: 'found' }, 'Найдена на ПК')),
        h('button', { class: `tbtn${added ? '' : ' primary'}`, disabled: added ? 'disabled' : null, onclick: () => {
          state.data.games.push({ id: uid(), name: c.name, genre: c.genre, status: c.installed ? 'Играю' : 'Хочу поиграть',
            hours: 0, rating: 0, notes: '', ckey: c.key, template: c.template, edition: c.edition, process: c.process,
            process_cmd: c.process_cmd, hue: c.hue, icon: c.icon || '', source: 'catalog' });
          persist(); draw(); render(false); toast(`«${c.name}» добавлена — время считается автоматически`, 'ok');
        } }, added ? 'Добавлено' : 'Добавить')));
    });
  };
  draw();
  const epicBtn = h('button', { class: 'btn ghost', onclick: async () => {
    epicBtn.classList.add('busy');
    const res = await api.epic_import();
    epicBtn.classList.remove('busy');
    if (!res.ok) { toast(res.error, 'err'); return; }
    state.data = res.data; draw(); render(false); toast(`Epic Games: добавлено ${res.added}`, 'ok');
  } }, 'Найти игры Epic Games');
  const close = openModal([
    h('h2', {}, 'Особые игры'),
    h('p', { class: 'lead' }, 'Игры вне Steam: у них есть авто-учёт времени, трекер скилла, а у Minecraft, Roblox и osu! — ещё и свои разделы.'),
    grid,
    h('div', { class: 'modal-actions' }, epicBtn, h('button', { class: 'btn', onclick: () => close() }, 'Готово')),
  ], 'wide');
}

/* ---------- Опрос трекера ---------- */
async function pollTracking() {
  try {
    const res = await api.get_tracking();
    const sig = JSON.stringify([res.running, Object.values(res.tracking).map((x) => Math.round(x.seconds / 60))]);
    const changed = sig !== state.trackSig;
    state.tracking = res.tracking; state.running = res.running; state.trackSig = sig;
    if (changed && state.page === 'games' && !document.querySelector('.backdrop')) render(false);
  } catch (err) { /* окно могло закрываться */ }
}

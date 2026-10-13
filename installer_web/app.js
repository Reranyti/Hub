'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
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
const api = new Proxy({}, { get: (_, name) => (...args) => window.pywebview.api[name](...args) });

/* Заглушка для проверки интерфейса в обычном браузере */
function installMock(mode) {
  let t = 0;
  window.pywebview = { api: {
    info: async () => ({ mode, version: '1.0.0', name: 'Game & Project Hub', default_dir: 'C:\\Users\\User\\AppData\\Local\\Programs\\Game Project Hub', update: false, webview2: true, size_mb: 140, has_data: true, full: mode !== 'plain', exclusive_installed: true, components: mode === 'plain' ? [] : [
      { id: 'Lotos-Outer/v2.3000', name: 'Lotos-Outer 2.3000 (эксклюзив)', desc: 'Мод и обязательные зависимости', size_mb: 35 },
      { id: 'Lotos-Outer/v2.3000-full', name: 'Сборка разработчика (Эксклюзивно)', desc: 'Полная тестовая сборка: моды, конфиги, шейдеры, install.bat', size_mb: 53 },
      { id: 'DeltaKind/excl', name: 'DeltaKind (эксклюзив)', desc: 'Новейшая сборка из рабочей копии', size_mb: 62 }] }),
    pick_folder: async () => 'D:\\Games\\Hub', start: async () => { t = 0; return true; },
    progress: async () => { t = Math.min(100, t + 7); return { percent: t, label: t < 100 ? 'Копирую файлы' : 'Готово', file: 'python313.dll', done: t >= 100, error: '', exe: 'x' }; },
    launch: async () => true, open_link: async () => true, minimize: async () => {}, close: async () => {},
  } };
}

const state = { info: null, step: 0, opts: { dir: '', desktop: true, startmenu: true, autostart: false, remove_data: false, remove_exclusive: false, components: [] } };
const isFull = () => !!(state.info && state.info.full);
const S = (n) => (isFull() && n >= 1 ? n + 1 : n);  // в полной версии добавлен шаг «Компоненты»
const STEPS = {
  install: ['Приветствие', 'Параметры', 'Установка', 'Готово'],
  installFull: ['Приветствие', 'Компоненты', 'Параметры', 'Установка', 'Готово'],
  uninstall: ['Подтверждение', 'Удаление', 'Готово'],
};

function renderSteps() {
  const list = STEPS[state.info.mode === 'install' && isFull() ? 'installFull' : state.info.mode];
  $('#steps').replaceChildren(...list.map((name, i) => h('li', { class: i === state.step ? 'active' : i < state.step ? 'done' : '' },
    h('i', {}, i < state.step ? '✓' : String(i + 1)), name)));
}

function go(build, step) {
  const stage = $('#stage');
  const old = $('.page', stage);
  const show = () => {
    state.step = step; renderSteps();
    stage.replaceChildren(build());
  };
  if (old) { old.classList.add('leaving'); setTimeout(show, 200); } else show();
}

const btn = (label, onclick, cls = '') => h('button', { class: `btn ${cls}`, onclick }, label);
const cancel = () => btn('Отмена', () => api.close(), 'ghost');

/* ----- установка ----- */
function pageWelcome() {
  const i = state.info;
  return h('div', { class: 'page' },
    h('div', { class: 'eyebrow' }, i.update ? 'Обновление' : 'Установка'),
    h('h1', {}, i.name),
    h('p', { class: 'lead' }, 'Трекер игр и проектов для Windows. Подтягивает библиотеку Steam и сам считает время, пока игра запущена.'),
    h('ul', { class: 'feats' },
      h('li', {}, 'Библиотека Steam и каталог игр вне Steam'),
      h('li', {}, 'Авто-учёт часов по запущенным процессам'),
      h('li', {}, 'Трекер скилла и особые разделы: Minecraft, osu!, Roblox')),
    isFull() && h('p', { class: 'hint', style: 'margin-top:18px;max-width:470px' }, 'Полная версия: внутри эксклюзивные версии проектов, которых нет в открытом доступе. Не передавайте этот файл третьим лицам.'),
    !i.webview2 && h('div', { class: 'alert' }, 'Не найден Microsoft Edge WebView2 Runtime: без него окно приложения не откроется. Установите его с ',
      h('span', { class: 'link', onclick: () => api.open_link('https://developer.microsoft.com/microsoft-edge/webview2/') }, 'сайта Microsoft'), ' и запустите установку снова.'),
    h('div', { class: 'actions' }, cancel(), btn(i.update ? 'Обновить' : 'Далее', () => go(isFull() ? pageComponents : pageOptions, 1))));
}

function toggle(key, title, hint) {
  const row = h('div', { class: `toggle${state.opts[key] ? ' on' : ''}`, role: 'switch', tabindex: '0', 'aria-checked': String(state.opts[key]) },
    h('div', { class: 'txt' }, h('b', {}, title), hint && h('small', {}, hint)), h('div', { class: 'switch' }));
  const flip = () => { state.opts[key] = !state.opts[key]; row.classList.toggle('on', state.opts[key]); row.setAttribute('aria-checked', String(state.opts[key])); };
  row.addEventListener('click', flip);
  row.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
  return row;
}

/* ----- компоненты (только полная версия) ----- */
function pageComponents() {
  const list = h('div', { class: 'toggles' });
  const summary = h('div', { class: 'hint', style: 'margin-top:12px' });
  const update = () => {
    const chosen = state.info.components.filter((c) => state.opts.components.includes(c.id));
    const mb = chosen.reduce((s, c) => s + c.size_mb, 0);
    summary.textContent = chosen.length ? `Выбрано: ${chosen.length} · ≈ ${mb} МБ эксклюзива, ещё ≈ ${state.info.size_mb} МБ — сама программа` : `Эксклюзив не выбран · только программа ≈ ${state.info.size_mb} МБ`;
  };
  const row = (title, hint, size, checked, locked, onChange) => {
    const el = h('div', { class: `toggle${checked ? ' on' : ''}${locked ? ' locked' : ''}`, role: 'switch', tabindex: locked ? '-1' : '0', 'aria-checked': String(checked) },
      h('div', { class: 'txt' }, h('b', {}, title), h('small', {}, hint)), h('span', { class: 'size' }, size), h('div', { class: 'switch' }));
    if (!locked) {
      const flip = () => { const now = !el.classList.contains('on'); el.classList.toggle('on', now); el.setAttribute('aria-checked', String(now)); onChange(now); update(); };
      el.addEventListener('click', flip);
      el.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
    }
    return el;
  };
  list.append(row(state.info.name, 'Приложение: обязательный компонент', `${state.info.size_mb} МБ`, true, true, () => {}));
  state.info.components.forEach((c) => list.append(row(c.name, c.desc, `${c.size_mb} МБ`, state.opts.components.includes(c.id), false, (on) => {
    state.opts.components = on ? [...new Set([...state.opts.components, c.id])] : state.opts.components.filter((x) => x !== c.id);
  })));
  update();
  const all = h('span', { class: 'link', onclick: () => {
    const none = state.opts.components.length === state.info.components.length;
    state.opts.components = none ? [] : state.info.components.map((c) => c.id);
    go(pageComponents, 1);
  } }, state.opts.components.length === state.info.components.length ? 'Снять все' : 'Выбрать все');
  return h('div', { class: 'page' },
    h('div', { class: 'eyebrow' }, 'Компоненты'), h('h1', {}, 'Что установить'),
    h('p', { class: 'lead' }, 'Эксклюзивные версии лежат внутри этого установщика и не требуют интернета. Каждая проверяется контрольной суммой перед установкой.'),
    list, summary, h('div', { class: 'hint' }, all),
    h('div', { class: 'actions' }, btn('Назад', () => go(pageWelcome, 0), 'ghost'), btn('Далее', () => go(pageOptions, 2))));
}

function pageOptions() {
  const input = h('input', { class: 'input', type: 'text', value: state.opts.dir, spellcheck: 'false' });
  input.addEventListener('input', () => { state.opts.dir = input.value.trim(); });
  const browse = h('button', { class: 'btn ghost', style: 'height:40px;padding:0 18px', onclick: async () => {
    const folder = await api.pick_folder();
    if (folder) { input.value = folder; state.opts.dir = folder; }
  } }, 'Обзор');
  return h('div', { class: 'page' },
    h('div', { class: 'eyebrow' }, 'Параметры'),
    h('h1', {}, 'Куда и как'),
    h('div', { class: 'field', style: 'margin-top:6px' }, h('label', {}, 'Папка установки'), h('div', { class: 'pathrow' }, input, browse),
      h('div', { class: 'hint' }, `Потребуется около ${state.info.size_mb} МБ`)),
    h('div', { class: 'toggles' },
      toggle('desktop', 'Ярлык на рабочем столе'),
      toggle('startmenu', 'Ярлык в меню «Пуск»'),
      toggle('autostart', 'Запускать вместе с Windows', 'Окно стартует свёрнутым. Нужно, чтобы время считалось и пока вы не открывали программу.')),
    h('div', { class: 'actions' }, btn('Назад', () => (isFull() ? go(pageComponents, 1) : go(pageWelcome, 0)), 'ghost'), btn('Установить', startInstall)));
}

/* ----- прогресс (общий для установки и удаления) ----- */
function pageProgress(title, eyebrow) {
  const num = h('span', {}, '0'), bar = h('i', {});
  const track = h('div', { class: 'track busy' }, bar);
  const label = h('span', {}, 'Начинаю'), file = h('span', { class: 'file' }, '');
  const page = h('div', { class: 'page' },
    h('div', { class: 'eyebrow' }, eyebrow), h('h1', {}, title),
    h('div', { class: 'pct' }, num, h('small', {}, '%')), track, h('div', { class: 'status' }, label, file));
  page.refs = { num, bar, label, file, track };
  return page;
}

let shown = 0;
function poll(refs, onDone) {
  const tick = async () => {
    const p = await api.progress();
    if (p.error) {
      refs.track.classList.remove('busy');
      refs.label.parentElement.after(h('div', { class: 'error' }, `Не получилось: ${p.error}`));
      const actions = h('div', { class: 'actions' }, btn('Закрыть', () => api.close(), 'ghost'));
      refs.track.closest('.page').append(actions);
      return;
    }
    refs.bar.style.width = `${p.percent}%`;
    refs.label.textContent = p.label; refs.file.textContent = p.file;
    // число догоняет реальный процент плавно
    const step = () => { if (shown < p.percent) { shown += 1; refs.num.textContent = String(shown); requestAnimationFrame(step); } };
    step();
    if (p.done) { setTimeout(() => { refs.track.classList.remove('busy'); }, 0); setTimeout(onDone, 900); return; }
    setTimeout(tick, 140);
  };
  tick();
}

async function startInstall() {
  const page = pageProgress('Установка', 'Подождите минуту');
  go(() => page, S(2));
  shown = 0;
  await api.start({ ...state.opts });
  poll(page.refs, () => go(pageDone, S(3)));
}

const checkSvg = () => {
  const wrap = h('div', { class: 'check' });
  wrap.innerHTML = '<svg viewBox="0 0 84 84" width="84" height="84"><circle cx="42" cy="42" r="40"/><path d="M26 43l11 11 21-24"/></svg>';
  return wrap;
};

function pageDone() {
  return h('div', { class: 'page' }, h('div', { class: 'eyebrow' }, 'Готово'), checkSvg(),
    h('h1', {}, state.info.update ? 'Обновлено' : 'Установлено'),
    h('p', { class: 'lead' }, 'Программа готова. Найти её можно на рабочем столе или в меню «Пуск».'),
    h('div', { class: 'actions' }, btn('Закрыть', () => api.close(), 'ghost'),
      btn('Запустить', async () => { await api.launch(); setTimeout(() => api.close(), 250); })));
}

/* ----- удаление ----- */
function pageConfirmUninstall() {
  return h('div', { class: 'page' }, h('div', { class: 'eyebrow' }, 'Удаление'), h('h1', {}, 'Удалить программу?'),
    h('p', { class: 'lead' }, 'Будут удалены программа, ярлыки и автозапуск. Ваши игры, проекты и настройки по умолчанию останутся: при повторной установке всё вернётся.'),
    h('div', { class: 'toggles' }, state.info.exclusive_installed && toggle('remove_exclusive', 'Удалить эксклюзивные версии', 'Файлы в папке exclusive. Список игр, проекты и настройки останутся.'),
      toggle('remove_data', 'Удалить и мои данные', state.info.has_data
      ? 'Список игр, проекты, история времени и сохранённый ключ Steam. Это нельзя отменить.' : 'Сохранённых данных не найдено.')),
    h('div', { class: 'actions' }, cancel(), btn('Удалить', startUninstall, 'danger')));
}

async function startUninstall() {
  const page = pageProgress('Удаление', 'Подождите');
  go(() => page, 1);
  shown = 0;
  await api.start({ ...state.opts });
  poll(page.refs, () => go(pageUninstalled, 2));
}

function pageUninstalled() {
  return h('div', { class: 'page' }, h('div', { class: 'eyebrow' }, 'Готово'), checkSvg(), h('h1', {}, 'Программа удалена'),
    h('p', { class: 'lead' }, 'Остатки файлов в папке программы исчезнут через несколько секунд.'),
    h('div', { class: 'actions' }, btn('Закрыть', () => api.close())));
}

/* ----- запуск ----- */
async function boot() {
  state.info = await api.info();
  state.opts.dir = state.info.default_dir;
  state.opts.components = (state.info.components || []).map((c) => c.id);
  $('#ver').textContent = `ВЕРСИЯ ${state.info.version}`;
  $('#btn-min').addEventListener('click', () => api.minimize());
  $('#btn-close').addEventListener('click', () => api.close());
  if (state.info.mode === 'uninstall') go(pageConfirmUninstall, 0);
  else go(pageWelcome, 0);
}

let started = false;
const start = () => { if (!started) { started = true; boot(); } };
if (window.pywebview && window.pywebview.api) start();
else {
  window.addEventListener('pywebviewready', start);
  setTimeout(() => {
    if (!window.pywebview) { installMock(new URLSearchParams(location.search).get('mode') || 'install'); start(); }
  }, 700);
}

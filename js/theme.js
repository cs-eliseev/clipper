/* Темы. Оформление задаётся только токенами на :root — см. themes/dark.css.
   Тему можно выбрать из списка (config.js → themes) или загрузить файлом.

   Отдельно живут токены холста: их читает не CSS, а отрисовка на канвасе,
   поэтому значения приходится доставать из вычисленных стилей. */

const CANVAS_TOKENS = {
  canvasBg: ['--canvas-bg', '#0f0f12'],
  hatchA: ['--hatch-a', '#16161a'],
  hatchB: ['--hatch-b', '#1b1b1f'],
  guide: ['--guide', 'rgba(217,154,78,.95)'],
  waveBg: ['--wave-bg', '#151518'],
  wavePeak: ['--wave-peak', '#43434e'],
  wavePeakOn: ['--wave-peak-on', '#e8e5e0'],
  waveSel: ['--wave-sel', 'rgba(217,154,78,.16)'],
  waveMarker: ['--wave-marker', '#d99a4e'],
  waveExt: ['--wave-ext', 'rgba(217,154,78,.07)'],
  playhead: ['--playhead', '#ffffff']
};

let themeId = '';
let baseId = '';                     // последняя выбранная тема-файл из списка
let tokenCache = null;

function tokens() {
  if (tokenCache) return tokenCache;
  const cs = getComputedStyle(document.documentElement);
  tokenCache = {};
  Object.keys(CANVAS_TOKENS).forEach(k => {
    const [name, fallback] = CANVAS_TOKENS[k];
    tokenCache[k] = (cs.getPropertyValue(name) || '').trim() || fallback;
  });
  return tokenCache;
}

function currentTheme() { return themeId; }

/* Тема из списка заменяет базовую целиком, а тема-файл ложится поверх неё.
   Поэтому свой файл может задавать хоть один токен: всё остальное останется
   от базовой темы и интерфейс не рассыплется. */
function applyTheme(id) {
  const def = App.themes.find(x => x.id === id) || App.themes[0];
  if (!def) return;
  const link = document.getElementById('themeLink');
  const style = document.getElementById('themeStyle');

  if (def.css) {
    style.textContent = def.css;
  } else {
    baseId = def.id;
    style.textContent = '';
    if (link.getAttribute('href') !== def.href) link.setAttribute('href', def.href);
    App.store.set('theme-base', baseId);
  }

  themeId = def.id;
  App.store.set('theme', def.id);
  tokenCache = null;
  // файл темы грузится асинхронно: токены станут верными на следующем кадре
  requestAnimationFrame(() => { tokenCache = null; App.emit('theme', def.id); });
  App.emit('theme', def.id);
}

function restoreCustomTheme() {
  const css = App.store.get('custom-theme');
  if (css) App.theme({ id: 'custom', name: t('themeCustom'), css });
}

function applyThemeText(css) {
  if (!App.store.set('custom-theme', css)) alert(t('errStore'));
  App.theme({ id: 'custom', name: t('themeCustom'), css });
  applyTheme('custom');
  return 'custom';
}

function loadThemeFile(done) {
  App.readFile('.css,text/css', text => {
    applyThemeText(text);
    if (done) done('custom');
  });
}

function initTheme() {
  restoreCustomTheme();
  const known = id => App.themes.some(x => x.id === id);
  const first = (App.themes[0] || {}).id;
  const base = [App.store.get('theme-base'), App.settings.theme, first].find(known);
  applyTheme(base);
  const saved = App.store.get('theme');
  if (saved && saved !== base && known(saved)) applyTheme(saved);
}

/* Возврат к тому, что написано в config.js: убираются и словари с темами,
   принесённые файлами, и запомненное состояние интерфейса. */
function resetCustom() {
  ['custom-langs', 'custom-theme', 'lang', 'theme', 'ui'].forEach(k => App.store.drop(k));
  location.reload();
}

/* Языки. Сами словари живут в lang/*.js — здесь только движок:
   выбор языка, подстановка строк в разметку и приём чужих словарей.

   Строка ищется по цепочке: выбранный язык → запасной из config.js →
   любой зарегистрированный. Поэтому неполный перевод не ломает интерфейс:
   непереведённое просто останется на запасном языке. */

let lang = '';

const strings = code => ((App.langs[code] || {}).strings || {});

function t(key, vars) {
  const chain = [lang, App.settings.fallbackLang || 'en', ...Object.keys(App.langs)];
  let s;
  for (const code of chain) {
    const d = strings(code);
    if (d && d[key] !== undefined) { s = d[key]; break; }
  }
  if (s === undefined) s = key;
  if (vars) Object.keys(vars).forEach(k => { s = s.split('{' + k + '}').join(vars[k]); });
  return s;
}

/* Статические строки размечены прямо в HTML: data-i18n — текст,
   data-i18n-title — подсказка, data-i18n-ph — placeholder. */
function applyStatic(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  scope.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  scope.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.documentElement.lang = lang;
  document.documentElement.dir = (App.langs[lang] || {}).dir || 'ltr';
  document.title = t('docTitle');
}

function currentLang() { return lang; }

function setLang(code) {
  if (!App.langs[code]) return;
  lang = code;
  App.store.set('lang', code);
  applyStatic();
  App.emit('lang', code);
}

function pickInitialLang() {
  const saved = App.store.get('lang');
  if (saved && App.langs[saved]) return saved;
  const wanted = App.settings.lang || 'auto';
  if (wanted !== 'auto' && App.langs[wanted]) return wanted;
  const browser = (navigator.language || '').slice(0, 2);
  if (App.langs[browser]) return browser;
  const fallback = App.settings.fallbackLang || 'en';
  return App.langs[fallback] ? fallback : Object.keys(App.langs)[0];
}

/* Свои словари, загруженные файлом, переживают перезагрузку. */
function restoreCustomLangs() {
  const saved = App.store.get('custom-langs', {});
  Object.keys(saved).forEach(code => {
    try { App.lang(saved[code]); } catch (err) { /* испорченная запись */ }
  });
}

function rememberCustomLang(def) {
  const saved = App.store.get('custom-langs', {});
  saved[def.code] = def;
  if (!App.store.set('custom-langs', saved)) {
    alert(t('errStore'));
  }
}

/* Принимает и .json, и .js. JSON — это ровно тот объект, который .js
   передаёт в App.lang(), так что один и тот же словарь годится и как файл
   для загрузки, и как файл рядом с index.html.

   Файл .js выполняется — это осознанно: он лежит на машине пользователя
   и ничем не отличается от словаря, подключённого тегом script. */
function applyLangText(text, name) {
  let def = null;
  try {
    if (/\.js$/i.test(name || '')) {
      const original = App.lang.bind(App);
      App.lang = d => { def = d; return original(d); };
      try { new Function('App', text)(App); } finally { App.lang = original; }
    } else {
      def = JSON.parse(text);
      App.lang(def);
    }
  } catch (err) {
    alert(t('errLangFile', { msg: err.message }));
    return null;
  }
  if (!def || !App.langs[def.code]) {
    alert(t('errLangFile', { msg: 'code' }));
    return null;
  }
  rememberCustomLang(App.langs[def.code]);
  setLang(def.code);
  return def.code;
}

function loadLangFile(done) {
  App.readFile('.json,.js,application/json,text/javascript', (text, file) => {
    const code = applyLangText(text, file.name);
    if (code && done) done(code);
  });
}

/* Шаблон для перевода: текущий словарь целиком, готовый к правке. */
function exportLangTemplate() {
  const src = App.langs[lang];
  if (!src) return;
  App.saveFile(src.code + '.json', JSON.stringify({
    code: src.code, name: src.name, dir: src.dir, strings: src.strings
  }, null, 2), 'application/json');
}

function initLang() {
  restoreCustomLangs();
  lang = pickInitialLang();
  applyStatic();
}

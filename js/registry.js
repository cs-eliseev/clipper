/* Реестр расширений — единственная точка, через которую инструмент
   принимает чужое: языки, темы и настройки.

   Порядок подключения в index.html:
     registry.js → lang/*.js → config.js → остальные модули.
   Значит, config.js видит всё, что зарегистрировано до него, и может
   что угодно переопределить.

   Всё, что регистрируется файлом с диска (⚙ → Файл…), складывается в
   localStorage и подхватывается при следующем запуске. */

const App = (() => {
  const id = document.documentElement.dataset.app || 'app';

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(id + '.' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (err) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(id + '.' + key, JSON.stringify(value));
        return true;
      } catch (err) {
        return false;                       // приватный режим или переполнение
      }
    },
    drop(key) {
      try { localStorage.removeItem(id + '.' + key); } catch (err) { /* нечего убирать */ }
    }
  };

  const listeners = {};

  return {
    id,
    store,

    /* Настройки. config.js вызывает App.config({...}); дальше читается
       как App.settings. Слияние поверхностное: объект целиком заменяется. */
    settings: {},
    config(patch) {
      Object.assign(this.settings, patch || {});
      return this;
    },

    /* Языки. Файл словаря — это один вызов:
         App.lang({ code: 'es', name: 'Español', strings: { … } })
       Тот же объект без обёртки — валидный JSON для загрузки с диска. */
    langs: {},
    lang(def) {
      if (!def || !def.code || !def.strings) throw new Error('language file needs code and strings');
      this.langs[def.code] = {
        code: def.code,
        name: def.name || def.code,
        dir: def.dir === 'rtl' ? 'rtl' : 'ltr',
        strings: def.strings
      };
      this.emit('langs');
      return this;
    },

    /* Темы. Либо ссылка на файл, либо готовый css-текст:
         App.theme({ id: 'sand', name: 'Песок', href: 'themes/sand.css' })
         App.theme({ id: 'sand', name: 'Песок', css: ':root{ --bg:#fff; … }' }) */
    themes: [],
    theme(def) {
      if (!def || !def.id) throw new Error('theme needs an id');
      const i = this.themes.findIndex(x => x.id === def.id);
      const item = { id: def.id, name: def.name || def.id, href: def.href, css: def.css };
      if (i >= 0) this.themes[i] = item; else this.themes.push(item);
      this.emit('themes');
      return this;
    },

    on(event, fn) {
      (listeners[event] = listeners[event] || []).push(fn);
      return this;
    },
    emit(event, payload) {
      (listeners[event] || []).forEach(fn => fn(payload));
    },

    /* Выбор файла с диска. Работает и когда страница открыта как file://,
       поэтому сеть и локальный сервер не нужны. */
    readFile(accept, cb) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => cb(String(reader.result), file);
        reader.readAsText(file);
      };
      input.click();
    },

    /* Отдать файл пользователю — шаблон словаря или текущую тему. */
    saveFile(name, text, mime) {
      const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
  };
})();

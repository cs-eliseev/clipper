/* Настройки инструмента — единственный файл, который стоит править,
   чтобы подогнать Clipper под себя. Код трогать не нужно.

   Здесь: язык и запасной язык, тема, набор и порядок блоков панели,
   форматы кадра, длины отрезка, список шрифтов и пути для скрипта.
   Названия — либо ключ из словаря (lang/*.js), либо готовый текст:
   если ключа нет, покажется сам текст. */

App.config({
  /* Язык: 'auto' — по языку браузера, иначе код словаря ('ru', 'en', свой).
     Выбор пользователя в ⚙ сильнее этой настройки. */
  lang: 'auto',
  fallbackLang: 'en',

  /* Тема из списка внизу файла. Пользовательский выбор тоже сильнее. */
  theme: 'dark',

  /* Раскладка при первом запуске: 'a' — волна, 'b' — кадр, 'c' — шаги.
     Список variants можно урезать, если лишние раскладки не нужны. */
  variant: 'a',
  variants: [
    { id: 'a', name: 'variantWave' },
    { id: 'b', name: 'variantFrame' },
    { id: 'c', name: 'variantSteps' }
  ],

  /* Блоки панели: порядок, что спрятать, что раскрыть при первом запуске.
     Блок 'track' показывается только в раскладке «Шаги» — в остальных
     дорожка и так на виду. */
  blocks: {
    order: ['track', 'image', 'frames', 'wave', 'text', 'anim', 'export'],
    hidden: [],
    open: ['image']
  },

  /* Форматы кадра. Свой — ещё один объект в списке. */
  formats: [
    { label: '9:16', w: 1080, h: 1920 },
    { label: '1:1',  w: 1080, h: 1080 },
    { label: '4:5',  w: 1080, h: 1350 },
    { label: '16:9', w: 1920, h: 1080 }
  ],
  frame: { w: 1080, h: 1920 },

  /* Быстрые длины отрезка, секунды. */
  lengths: [10, 15, 30],
  duration: 15,
  minDuration: 3,
  maxDuration: 60,

  /* Что подставляется в скрипт. baseDir можно задать сразу своим путём. */
  renderer: './render-clip.py',
  baseDir: '',
  outName: 'clip01.mp4',

  /* Шрифты надписей: имя в списке и путь к ttf, который увидит ffmpeg.
     На macOS это /System/Library/Fonts/…, на Windows C:/Windows/Fonts/…  */
  fonts: [
    { n: 'DejaVu Sans — Regular',      f: '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf' },
    { n: 'DejaVu Sans — Bold',         f: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' },
    { n: 'DejaVu Sans — Italic',       f: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf' },
    { n: 'DejaVu Sans — Bold Italic',  f: '/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf' },
    { n: 'DejaVu Serif — Regular',     f: '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf' },
    { n: 'DejaVu Serif — Bold',        f: '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf' },
    { n: 'DejaVu Serif — Italic',      f: '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf' },
    { n: 'DejaVu Serif — Bold Italic', f: '/usr/share/fonts/truetype/dejavu/DejaVuSerif-BoldItalic.ttf' },
    { n: 'DejaVu Mono — Regular',      f: '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf' },
    { n: 'DejaVu Mono — Bold',         f: '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf' },
    { n: 'Liberation Sans — Regular',  f: '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf' },
    { n: 'Liberation Sans — Bold',     f: '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf' },
    { n: 'Liberation Sans — Italic',   f: '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf' },
    { n: 'Liberation Serif — Regular', f: '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf' },
    { n: 'Liberation Serif — Bold',    f: '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf' },
    { n: 'FreeSans — Regular',         f: '/usr/share/fonts/truetype/freefont/FreeSans.ttf' },
    { n: 'FreeSans — Bold',            f: '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf' },
    { n: 'FreeSerif — Regular',        f: '/usr/share/fonts/truetype/freefont/FreeSerif.ttf' },
    { n: 'FreeSerif — Bold',           f: '/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf' }
  ],
  defaultFont: 1,            // номер в списке выше

  previewLong: 720           // длинная сторона превью-канваса, px
});

/* Темы. href — файл рядом с index.html; можно добавить свой:
     App.theme({ id: 'sand', name: 'Песок', href: 'themes/sand.css' });
   Разовую тему проще загрузить прямо в интерфейсе: ⚙ → Тема → Файл… */
App.theme({ id: 'dark',  name: 'themeDark',  href: 'themes/dark.css' });
App.theme({ id: 'light', name: 'themeLight', href: 'themes/light.css' });

/* Константы и состояние. Всё, что описывает клип, лежит в cfg —
   именно оно уезжает в JSON для render-clip.py. Всё, что описывает
   интерфейс (раскладка, открытые блоки, язык), лежит в ui.

   Наборы форматов, длин, шрифтов и блоков берутся из config.js —
   их можно менять, не трогая код. */

const SET = App.settings;
const FRAME_PRESETS = SET.formats;

const WAVE_TYPES = [
  { id: 'wave-cline', key: 'waveCline' },
  { id: 'wave-line',  key: 'waveLine' },
  { id: 'wave-point', key: 'wavePoint' },
  { id: 'wave-p2p',   key: 'waveP2p' },
  { id: 'freq-bar',   key: 'freqBar' },
  { id: 'freq-line',  key: 'freqLine' },
  { id: 'freq-dot',   key: 'freqDot' },
  { id: 'cqt',        key: 'cqt' },
  { id: 'vector',     key: 'vector' },
  { id: 'histogram',  key: 'histogram' }
];

const ANIM_TYPES = ['zoomin', 'zoomout', 'panright', 'panleft', 'pandown', 'panup', 'none', 'dim'];

/* ось движения: два движения по одной оси на пересекающихся интервалах спорят */
const ANIM_AXIS = {
  zoomin: 'axisZoom', zoomout: 'axisZoom',
  panright: 'axisX', panleft: 'axisX',
  pandown: 'axisY', panup: 'axisY'
};

/* заставки: переходы и направления, как в render-clip.py */
const FRAME_ANIMS = ['cut', 'fade', 'slide', 'slidefade', 'zoom'];
const FRAME_DIRS = ['left', 'right', 'up', 'down'];
const FRAME_ZOOM = 0.25;            // насколько вырастает заставка в переходе zoom
const THUMB_MODES = ['none', 'frame', 'image'];

const FONTS = SET.fonts;

/* чем рисовать надпись в превью — приблизительная пара к ttf-файлу */
const CSS_FAMILY = {
  'DejaVu Sans': '"DejaVu Sans",sans-serif',
  'DejaVu Serif': '"DejaVu Serif",serif',
  'DejaVu Mono': '"DejaVu Sans Mono",monospace',
  'Liberation Sans': '"Liberation Sans",Arial,sans-serif',
  'Liberation Serif': '"Liberation Serif","Times New Roman",serif',
  FreeSans: 'FreeSans,sans-serif',
  FreeSerif: 'FreeSerif,serif'
};

/* Порядок блоков панели и то, какие из них вообще показывать, — из config.js.
   Блок «Трек и отрезок» имеет смысл только в раскладке «Шаги»: в остальных
   дорожка и так на виду. */
const BLOCKS_ALL = SET.blocks.order.filter(k => SET.blocks.hidden.indexOf(k) < 0);
const BLOCKS_C = BLOCKS_ALL;
const BLOCKS_AB = BLOCKS_ALL.filter(k => k !== 'track');
const GROUPS = ['image', 'wave', 'text', 'anim', 'intro', 'outro', 'thumb'];
/* группа ползунков → блок панели, если их имена не совпадают */
const GROUP_BLOCK = { intro: 'frames', outro: 'frames', thumb: 'frames' };

const MIN_DUR = SET.minDuration || 3;
const MAX_DUR = SET.maxDuration || 60;
const PAN_SPAN = 0.45;              // доля хода панорамы за клип при скорости 1
const SRC_SCALE = 1.6;              // запас исходника под наезд, как в render-clip.py
const PREVIEW_LONG = SET.previewLong || 720;   // длинная сторона превью-канваса

/* --------------------------------------------------------------- описание */
const cfg = {
  frame: { w: SET.frame.w, h: SET.frame.h },
  img: { scale: 1.0, x: 0.5, y: 0.5, fit: 'cover' },
  smooth: 3,
  anims: [],
  wave: {
    on: false, type: 'wave-cline', freq: 0.5, x: 0.5,
    y: Math.round(SET.frame.h * 0.84), w: SET.frame.w, h: 240,
    color: '#ffffff', alpha: 0.85,
    outline: { on: false, color: '#000000', size: 2 }
  },
  texts: [],
  intro: null,                 // { image, duration, fit, anim, dir, animDur, audioFade }
  outro: null,
  thumbnail: { mode: 'none', time: 0, image: '', save: false }
};

/* ------------------------------------------------------------- интерфейс */
const ui = {
  variant: SET.variant || 'a',
  panelOpen: true,
  accordion: 'multi',
  open: {},
  more: {},
  lanes: true,
  laneOpen: { anim: false, text: false },   // дорожка раскрыта: каждый элемент своей строкой
  focus: 'image',              // с чем сейчас работает мышь на кадре
  textIdx: -1,
  animIdx: -1,
  playing: false,              // звук
  animating: true,             // превью крутится
  animT: 0
};

BLOCKS_ALL.forEach(k => { ui.open[k] = SET.blocks.open.indexOf(k) >= 0; });

const sel = { start: 0, dur: SET.duration || 15 };

const media = {
  audioBuf: null, peaks: null, img: null,
  trackName: '', imageName: '',
  trackPath: '', imagePath: '',
  frames: { intro: null, outro: null, thumb: null }   // картинки заставок и миниатюры
};

/* общая шкала: вступление, отрезок, концовка */
const introLen = () => (cfg.intro ? +cfg.intro.duration : 0);
const outroLen = () => (cfg.outro ? +cfg.outro.duration : 0);
const totalLen = () => introLen() + sel.dur + outroLen();

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const $ = id => document.getElementById(id);
const blockKeys = () => (ui.variant === 'c' ? BLOCKS_C : BLOCKS_AB);
const K = () => cfg.frame.w / $('pv').width;     // кадр → пиксели превью

function saveUi() {
  App.store.set('ui', {
    variant: ui.variant, panelOpen: ui.panelOpen, accordion: ui.accordion,
    open: ui.open, lanes: ui.lanes, laneOpen: ui.laneOpen, frame: cfg.frame,
    baseDir: $('baseDir').value, renderer: $('renderer').value
  });
}

function loadUi() {
  {
    const s = App.store.get('ui');
    if (!s) return;
    if (s.variant) ui.variant = s.variant;
    if (typeof s.panelOpen === 'boolean') ui.panelOpen = s.panelOpen;
    if (s.accordion) ui.accordion = s.accordion;
    if (s.open) Object.assign(ui.open, s.open);
    if (typeof s.lanes === 'boolean') ui.lanes = s.lanes;
    if (s.laneOpen) Object.assign(ui.laneOpen, s.laneOpen);
    if (s.frame && s.frame.w > 0 && s.frame.h > 0) {
      cfg.frame.w = s.frame.w;
      cfg.frame.h = s.frame.h;
      cfg.wave.w = Math.min(cfg.wave.w, cfg.frame.w);
      cfg.wave.y = Math.round(cfg.frame.h * 0.84);
    }
    if (s.baseDir) $('baseDir').value = s.baseDir;
    if (s.renderer) $('renderer').value = s.renderer;
  }
}

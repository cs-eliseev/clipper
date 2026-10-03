/* Дорожка: волна трека, отрезок, дорожки слоёв.
   Один живой блок — в разных раскладках он просто переезжает в другой слот. */

const waveCv = $('wave');
const wctx = waveCv.getContext('2d');

/* положение головки по общей шкале — всегда, не только пока звучит трек */
function headPos() { return clamp(ui.animT + introLen(), 0, totalLen()); }

function drawWave() {
  const r = waveCv.getBoundingClientRect();
  const W = Math.max(200, Math.round(r.width));
  const H = Math.max(30, Math.round(r.height));
  if (waveCv.width !== W || waveCv.height !== H) { waveCv.width = W; waveCv.height = H; }

  const tok = tokens();
  wctx.fillStyle = tok.waveBg;
  wctx.fillRect(0, 0, W, H);
  if (!media.peaks || !media.audioBuf) return;

  const mid = H / 2;
  const dur = media.audioBuf.duration;
  const x1 = W * sel.start / dur;
  const x2 = W * (sel.start + sel.dur) / dur;

  for (let x = 0; x < W; x++) {
    const p = media.peaks[Math.floor(x / W * media.peaks.length)] || 0;
    const h = Math.max(1, p * mid * 0.94);
    wctx.fillStyle = (x >= x1 && x <= x2) ? tok.wavePeakOn : tok.wavePeak;
    wctx.fillRect(x, mid - h, 1, h * 2);
  }

  // звук под заставками — до и после отрезка, бледнее
  const ext = (a, b) => {
    a = Math.max(0, a);
    b = Math.min(W, b);
    if (b > a) wctx.fillRect(a, 0, b - a, H);
  };
  wctx.fillStyle = tok.waveExt;
  if (introLen() > 0) ext(W * (sel.start - introLen()) / dur, x1);
  if (outroLen() > 0) ext(x2, W * (sel.start + sel.dur + outroLen()) / dur);

  wctx.fillStyle = tok.waveSel;
  wctx.fillRect(x1, 0, x2 - x1, H);
  wctx.fillStyle = tok.waveMarker;
  [x1, x2].forEach(x => {
    wctx.fillRect(x - 1, 0, 2, H);
    wctx.fillRect(x - 3, mid - 14, 6, 28);
  });

  const px = W * (sel.start - introLen() + headPos()) / dur;
  wctx.fillStyle = tok.playhead;
  if (px >= 0 && px <= W) wctx.fillRect(px, 0, 1, H);
}

/* -------------------------------------------------------------- выделение */
let wdrag = null;

function posToTime(e) {
  const r = waveCv.getBoundingClientRect();
  return clamp((e.clientX - r.left) / r.width * media.audioBuf.duration, 0, media.audioBuf.duration);
}
function zoneAt(time) {
  const r = waveCv.getBoundingClientRect();
  const d = 9 / Math.max(1, r.width) * media.audioBuf.duration;
  const end = sel.start + sel.dur;
  if (Math.abs(time - sel.start) <= d) return 'resizeL';
  if (Math.abs(time - end) <= d) return 'resizeR';
  if (time > sel.start && time < end) return 'move';
  return 'new';
}
const cursorFor = z => (z === 'move' ? 'grab' : (z === 'new' ? 'crosshair' : 'ew-resize'));

function attachTrack() {
  waveCv.addEventListener('pointerdown', e => {
    if (!media.audioBuf) return;
    const time = posToTime(e), m = zoneAt(time);
    wdrag = { m, anchor: time, grab: time - sel.start };
    waveCv.style.cursor = m === 'move' ? 'grabbing' : cursorFor(m);
    waveCv.setPointerCapture(e.pointerId);
  });

  waveCv.addEventListener('pointermove', e => {
    if (!media.audioBuf) return;
    const time = posToTime(e);
    if (!wdrag) { waveCv.style.cursor = cursorFor(zoneAt(time)); return; }
    if (wdrag.m === 'move') {
      sel.start = clamp(time - wdrag.grab, 0, media.audioBuf.duration - sel.dur);
    } else if (wdrag.m === 'resizeL') {
      const end = sel.start + sel.dur;
      sel.start = clamp(time, 0, end - MIN_DUR);
      sel.dur = end - sel.start;
    } else if (wdrag.m === 'resizeR') {
      sel.dur = Math.max(MIN_DUR, Math.min(time, media.audioBuf.duration) - sel.start);
    } else {
      sel.start = Math.max(0, Math.min(wdrag.anchor, time));
      sel.dur = Math.max(MIN_DUR, Math.abs(time - wdrag.anchor));
    }
    onSegmentChange();
  });

  ['pointerup', 'pointercancel'].forEach(ev => waveCv.addEventListener(ev, e => {
    if (!wdrag) return;
    // короткий клик мимо выделения — переносим отрезок сюда
    if (wdrag.m === 'new' && Math.abs(posToTime(e) - wdrag.anchor) < 0.15) {
      sel.start = clamp(wdrag.anchor, 0, media.audioBuf.duration - sel.dur);
      onSegmentChange();
    }
    wdrag = null;
    waveCv.style.cursor = cursorFor(zoneAt(posToTime(e)));
  }));

  const box = $('waveBox');
  ['dragenter', 'dragover'].forEach(ev => box.addEventListener(ev, e => {
    e.preventDefault();
    e.stopPropagation();
    box.classList.add('track__box--over');
  }));
  ['dragleave', 'drop'].forEach(ev => box.addEventListener(ev, e => {
    e.preventDefault();
    e.stopPropagation();
    box.classList.remove('track__box--over');
  }));
  box.addEventListener('drop', e => {
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('audio/')) loadAudio(f);
  });

  $('trackDrop').onclick = e => { e.stopPropagation(); pickFile('audio/*', loadAudio); };
  $('pickTrack2').onclick = () => pickFile('audio/*', loadAudio);
  $('play').onclick = togglePlay;

  const num = (el, apply) => {
    el.oninput = () => {
      const v = parseFloat(el.value);
      if (isNaN(v)) return;
      apply(v);
      clampSel();
      onSegmentChange(false);
    };
  };
  num($('segStart'), v => { sel.start = v; });
  num($('segEnd'), v => { sel.dur = Math.max(MIN_DUR, v - sel.start); });
  num($('segLen'), v => { sel.dur = v; });

  $('lanesToggle').onclick = () => {
    ui.lanes = !ui.lanes;
    saveUi();
    renderTrack();
  };

  (SET.lengths || [10, 15, 30]).forEach(v => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--pill';
    b.dataset.len = v;
    b.textContent = v + ' ' + t('sec');
    b.onclick = () => { sel.dur = v; clampSel(); onSegmentChange(); };
    $('lenPresets').appendChild(b);
  });
}

/* ---------------------------------------------------------------- дорожки */
/* Шаг отметок шкалы: подписи не чаще, чем раз в ~40px, деления в 5 раз чаще. */
function rulerStep(total, widthPx) {
  const perSec = Math.max(1, widthPx) / Math.max(0.1, total);
  const major = [0.5, 1, 2, 5, 10, 15, 30, 60].find(v => v * perSec >= 40) || 60;
  return { major, minor: major / 5 };
}

function renderLanes() {
  const host = $('lanes');
  host.hidden = !ui.lanes;
  host.innerHTML = '';
  if (!ui.lanes) return;

  // дорожки идут по общей шкале; from/to — время клипа, вступление левее нуля
  const T = totalLen(), I = introLen();
  const share = v => (clamp(v / T, 0, 1) * 100).toFixed(2) + '%';

  const headAt = box => {
    const head = document.createElement('div');
    head.className = 'track__head';
    head.style.left = share(headPos());
    box.appendChild(head);
  };

  const laneRow = (label, items, opts) => {
    const row = document.createElement('div');
    row.className = 'track__lane';
    const name = document.createElement(opts ? 'button' : 'span');
    name.className = 'track__lane-name';
    name.textContent = label;
    if (opts) {
      name.type = 'button';
      name.classList.add('track__lane-name--btn');
      name.title = t(opts.open ? 'laneCollapse' : 'laneExpand');
      name.textContent = (opts.open ? '▾ ' : '▸ ') + label;
      name.onclick = opts.toggle;
    }
    const box = document.createElement('div');
    box.className = 'track__lane-box';
    items.forEach(it => box.appendChild(it));
    headAt(box);
    attachSeek(box, true);
    row.append(name, box);
    host.appendChild(row);
  };

  /* дорожка слоя: одной строкой или, раскрытая, по строке на каждый элемент */
  const lane = (nameKey, items, key) => {
    const many = key && items.length > 1;
    const toggle = many ? () => { ui.laneOpen[key] = !ui.laneOpen[key]; saveUi(); renderLanes(); } : null;
    if (!(many && ui.laneOpen[key])) { laneRow(t(nameKey), items, toggle && { toggle, open: false }); return; }
    items.forEach((it, i) => laneRow(i ? '' : t(nameKey), [it], i ? null : { toggle, open: true }));
  };

  const clip = (mod, label, from, to, onClick, on) => {
    const d = document.createElement('div');
    d.className = 'track__clip track__clip--' + mod + (on ? ' track__clip--on' : '');
    d.style.left = share(I + from);
    d.style.width = share(to - from);
    d.textContent = label;
    d.onclick = onClick;
    return d;
  };

  // шкала: секунды отрезка, 0 — его начало, вступление уходит в минус
  {
    const row = document.createElement('div');
    row.className = 'track__lane';
    const name = document.createElement('span');
    name.className = 'track__lane-name';
    const box = document.createElement('div');
    box.className = 'track__ruler';
    box.title = t('rulerTitle');
    const width = Math.max(0, host.getBoundingClientRect().width - 76) || 600;   // 0, пока дорожка скрыта
    const { major, minor } = rulerStep(T, width);
    const first = Math.ceil(-I / minor - 1e-6) * minor;
    for (let sec = first; sec <= T - I + 1e-6; sec += minor) {
      const isMajor = Math.abs(sec / major - Math.round(sec / major)) < 1e-6;
      const tick = document.createElement('div');
      tick.className = 'track__tick' + (isMajor ? ' track__tick--major' : '');
      tick.style.left = share(I + sec);
      if (isMajor) {
        const label = document.createElement('span');
        label.className = 'track__tick-label' + ((I + sec) / T > 0.93 ? ' track__tick-label--end' : '');
        label.textContent = Math.abs(sec - Math.round(sec)) < 1e-6 ? String(Math.round(sec)) : sec.toFixed(1);
        tick.appendChild(label);
      }
      box.appendChild(tick);
    }
    [0, sel.dur].forEach(sec => {
      const edge = document.createElement('div');
      edge.className = 'track__tick track__tick--edge';
      edge.style.left = share(I + sec);
      box.appendChild(edge);
    });
    headAt(box);
    attachSeek(box, false);
    row.append(name, box);
    host.appendChild(row);
  }

  if (cfg.intro || cfg.outro) {
    const trans = f => (f.anim === 'cut' ? 0 : Math.min(+f.animDur, sel.dur));
    const items = [];
    if (cfg.intro) items.push(clip('frame', t('introTitle'), -I, trans(cfg.intro), () => {
      focusOn('intro');
      seekPreview(-I);
    }));
    if (cfg.outro) items.push(clip('frame', t('outroTitle'), sel.dur - trans(cfg.outro), T - I, () => {
      focusOn('outro');
      seekPreview(sel.dur - trans(cfg.outro));
    }));
    lane('laneFrames', items);
  }

  lane('laneAnim', cfg.anims.map((a, i) =>
    clip('anim', t('anim' + a.type.charAt(0).toUpperCase() + a.type.slice(1)), a.from, a.to, () => {
      ui.animIdx = i;
      focusOn('anim');
      openBlock('anim');
      renderAnimControls();
      renderRows('anim');
      renderLanes();
    }, i === ui.animIdx && ui.focus === 'anim')), 'anim');

  lane('laneText', cfg.texts.map((tx, i) =>
    clip('text', tx.text || t('noText'), tx.from, tx.to, () => {
      ui.textIdx = i;
      focusOn('text');
      openBlock('text');
      renderTextControls();
      renderRows('text');
      renderLanes();
      drawPreview();
    }, i === ui.textIdx && ui.focus === 'text')), 'text');

  lane('laneWave', cfg.wave.on
    ? [clip('wave', t(WAVE_TYPES.find(w => w.id === cfg.wave.type).key), 0, sel.dur, () => {
        focusOn('wave');
        openBlock('wave');
      })]
    : []);
}

/* Перемотка по коробке дорожки: нажать и тянуть — головка идёт за мышью.
   На дорожках слоёв нажатие по самому элементу оставлено ему (клик выбирает),
   перемотка начинается с фона или с головки. */
function attachSeek(box, bgOnly) {
  const seekTo = e => {
    const r = box.getBoundingClientRect();
    seekPreview(clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1) * totalLen() - introLen());
  };
  let down = false;
  box.addEventListener('pointerdown', e => {
    if (bgOnly && e.target !== box && !e.target.classList.contains('track__head')) return;
    down = true;
    try { box.setPointerCapture(e.pointerId); } catch (err) { /* и без захвата работает */ }
    seekTo(e);
  });
  box.addEventListener('pointermove', e => { if (down) seekTo(e); });
  ['pointerup', 'pointercancel'].forEach(ev => box.addEventListener(ev, () => { down = false; }));
}

/* головка ездит по дорожкам и шкале каждый кадр — без пересборки разметки */
function moveLaneHeads() {
  const left = ((headPos() / totalLen()) * 100).toFixed(2) + '%';
  document.querySelectorAll('.track__head').forEach(head => { head.style.left = left; });
}

/* показания дорожки: поля отрезка, длительность трека, пресеты длины */
function renderTrack() {
  $('segStart').value = sel.start.toFixed(1);
  $('segEnd').value = (sel.start + sel.dur).toFixed(1);
  $('segLen').value = sel.dur.toFixed(1);
  $('trackTotal').textContent = media.audioBuf ? '/ ' + fmtTime(media.audioBuf.duration) : '—';
  $('trackDrop').hidden = !!media.audioBuf;
  $('lanesToggle').textContent = t(ui.lanes ? 'lanesHide' : 'lanesShow');
  onPlayState();
  [...$('lenPresets').children].forEach(b => {
    b.classList.toggle('btn--on', Math.abs(sel.dur - (+b.dataset.len)) < 0.05);
  });
  drawWave();
  renderLanes();
}

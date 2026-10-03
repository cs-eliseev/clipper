/* Кадр: превью на канвасе и мышь по нему.
   Расчёт движения повторяет render-clip.py — что видно здесь,
   то и окажется в готовом файле. */

const pv = $('pv');
const pctx = pv.getContext('2d');

let holdStart = false;               // пока тянем картинку, кадр стоит на нуле
let t0 = 0, rafId = null;

function resizePreview() {
  const long = Math.max(cfg.frame.w, cfg.frame.h);
  const k = PREVIEW_LONG / long;
  pv.width = Math.max(80, Math.round(cfg.frame.w * k));
  pv.height = Math.max(80, Math.round(cfg.frame.h * k));
  fitFrameToViewport();
}

/* Канвас вписывается в свободную область целиком, без прокрутки.
   За размером области следит ResizeObserver: раскладка меняется не только
   от окна, но и от переезда дорожки или сворачивания панели. */
function fitFrameToViewport() {
  const area = pv.closest('.stage__area');
  if (!area) return;
  const cs = getComputedStyle(area);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const w = Math.max(80, area.clientWidth - padX - 2) + 'px';
  const h = Math.max(80, area.clientHeight - padY - 2 - 14) + 'px';   // место стрелке бегунка под кадром
  if (pv.style.maxWidth !== w) pv.style.maxWidth = w;
  if (pv.style.maxHeight !== h) pv.style.maxHeight = h;
}

if (window.ResizeObserver) {
  new ResizeObserver(() => fitFrameToViewport()).observe(pv.closest('.stage__area'));
}

/* ---------------------------------------------------------------- движение */
function animState() {
  const S = cfg.img.scale;
  const D = Math.max(0.1, sel.dur);
  const z0 = S;
  const cl = (v, a, b) => Math.max(a, Math.min(b, v));

  // Зум, горизонталь и вертикаль — независимые дорожки, как в render-clip.py.
  // Поэтому наезд и панорама идут одновременно, не мешая друг другу.
  const axis = { zoomin: 'z', zoomout: 'z', panright: 'x', panleft: 'x', pandown: 'y', panup: 'y' };
  const tracks = { z: [], x: [], y: [] };
  cfg.anims.forEach(a => {
    const ax = axis[a.type];
    if (!ax) return;
    const a0 = cl(a.from, 0, D), a1 = cl(a.to, 0, D);
    if (a1 - a0 < 0.05) return;
    tracks[ax].push({ type: a.type, speed: a.speed, t0: a0, t1: a1 });
  });
  Object.values(tracks).forEach(v => v.sort((p, q) => p.t0 - q.t0));

  const startVal = { z: z0, x: cfg.img.x, y: cfg.img.y };
  const valueAt = ax => {
    let v = startVal[ax];
    const time = Math.min(ui.animT, D);
    for (const s of tracks[ax]) {
      if (time <= s.t0) return v;                      // ещё не дошли
      const share = (s.t1 - s.t0) / D;
      const f = Math.min(1, (time - s.t0) / (s.t1 - s.t0));
      let target;
      if (s.type === 'zoomin') target = cl(v * (1 + 0.1375 * s.speed * share), z0 / 2.5, z0 * 1.8);
      else if (s.type === 'zoomout') target = cl(v / (1 + 0.1375 * s.speed * share), z0 / 2.5, z0 * 1.8);
      else if (s.type === 'panright' || s.type === 'pandown') target = cl(v + PAN_SPAN * share * s.speed, 0, 1);
      else target = cl(v - PAN_SPAN * share * s.speed, 0, 1);
      if (time < s.t1) return v + (target - v) * f;    // внутри интервала
      v = target;                                       // прошли целиком
    }
    return v;
  };

  const zz = valueAt('z'), pxx = valueAt('x'), pyy = valueAt('y');
  const sw = pv.width * SRC_SCALE * S, sh = pv.height * SRC_SCALE * S;
  const winW = sw / zz, winH = sh / zz;
  return { sw, sh, winW, winH, px: pxx, py: pyy, k: pv.width / winW };
}

function dimAlpha() {
  // несколько затемнений накладываются друг на друга, как слои в ffmpeg
  let rest = 1;
  cfg.anims.filter(a => a.type === 'dim').forEach(d => {
    if (d.value <= 0 || ui.animT < d.from || ui.animT > d.to) return;
    const fin = Math.max(0.01, d.fadeIn), fout = Math.max(0.01, d.fadeOut);
    let a = d.value;
    if (ui.animT < d.from + fin) a = d.value * (ui.animT - d.from) / fin;
    else if (ui.animT > d.to - fout) a = d.value * (d.to - ui.animT) / fout;
    rest *= (1 - clamp(a, 0, 1));
  });
  return 1 - rest;
}

/* ---------------------------------------------------------------- отрисовка */
function drawPreview() {
  const W = pv.width, H = pv.height;
  pctx.fillStyle = tokens().canvasBg;
  pctx.fillRect(0, 0, W, H);

  if (media.img) {
    const s = animState();
    const L = imageLayout(s);
    pctx.imageSmoothingQuality = 'high';
    pctx.drawImage(media.img, -L.wx * s.k, -L.wy * s.k, L.iw * s.k, L.ih * s.k);
  } else {
    drawHatch(W, H);
  }

  const da = dimAlpha();
  if (da > 0.001) {
    pctx.fillStyle = 'rgba(0,0,0,' + da.toFixed(3) + ')';
    pctx.fillRect(0, 0, W, H);
  }
  // полоса живёт только под клипом: под заставками звук есть, а слоя нет
  if (cfg.wave.on && ui.animT >= 0 && ui.animT <= sel.dur) drawStrip();
  cfg.texts.forEach((tx, i) => drawText(tx, i === ui.textIdx && ui.focus === 'text'));
  drawFrameLayer('intro');
  drawFrameLayer('outro');
}

/* Картинка после cover/contain и окно на ней. Одна сторона картинки совпадает
   с исходником sw x sh, другая даёт запас — обрезку или поля. Окно ходит по
   всему запасу: разница пропорций плюс то, что даёт масштаб; x/y = 0.5 — центр,
   больше — содержимое уезжает влево/вверх. Рендер считает так же (image_box). */
function imageLayout(s) {
  const s0 = cfg.img.fit === 'contain'
    ? Math.min(s.sw / media.img.width, s.sh / media.img.height)
    : Math.max(s.sw / media.img.width, s.sh / media.img.height);
  const iw = media.img.width * s0, ih = media.img.height * s0;
  // запас по модулю: и при обрезке, и при полях рост x/y уводит содержимое влево/вверх
  const win = (side, w, v) => (side - w) / 2 + Math.abs(side - w) * (v - 0.5);
  return { iw, ih, wx: win(iw, s.winW, s.px), wy: win(ih, s.winH, s.py) };
}

/* запас хода по осям в пикселях превью при текущем масштабе; null — нет картинки */
function imageRoom() {
  if (!media.img) return null;
  const sw = pv.width * SRC_SCALE * cfg.img.scale, sh = pv.height * SRC_SCALE * cfg.img.scale;
  const L = imageLayout({ sw, sh, winW: pv.width * SRC_SCALE, winH: pv.height * SRC_SCALE, px: 0.5, py: 0.5 });
  return { x: Math.abs(L.iw - pv.width * SRC_SCALE), y: Math.abs(L.ih - pv.height * SRC_SCALE) };
}

/* Заставка поверх клипа. Слой размером с кадр сдвигается целиком, картинка
   внутри него растёт от центра — так же делает overlay + zoompan в рендере. */
function drawFrameLayer(kind) {
  const o = frameOverlay(kind);
  if (!o) return;
  const W = pv.width, H = pv.height;
  const im = media.frames[kind];
  pctx.save();
  pctx.globalAlpha = o.alpha;
  pctx.translate(o.dx * W, o.dy * H);
  pctx.beginPath();
  pctx.rect(0, 0, W, H);
  pctx.clip();
  pctx.translate(W / 2, H / 2);
  pctx.scale(o.zoom, o.zoom);
  if (im) {
    const f = cfg[kind];
    const s0 = f.fit === 'contain'
      ? Math.min(W / im.width, H / im.height)
      : Math.max(W / im.width, H / im.height);
    const iw = im.width * s0, ih = im.height * s0;
    pctx.fillStyle = '#000000';                     // поля при contain
    pctx.fillRect(-W / 2, -H / 2, W, H);
    pctx.imageSmoothingQuality = 'high';
    pctx.drawImage(im, -iw / 2, -ih / 2, iw, ih);
  } else {
    const tok = tokens();
    pctx.fillStyle = tok.hatchA;
    pctx.fillRect(-W / 2, -H / 2, W, H);
    pctx.fillStyle = tok.guide;
    pctx.font = '500 ' + Math.round(W / 18) + 'px sans-serif';
    pctx.textAlign = 'center';
    pctx.textBaseline = 'middle';
    pctx.fillText(t(kind + 'Title'), 0, 0);
  }
  pctx.restore();
  pctx.globalAlpha = 1;
}

function drawHatch(W, H) {
  const tok = tokens();
  pctx.fillStyle = tok.hatchA;
  pctx.fillRect(0, 0, W, H);
  pctx.strokeStyle = tok.hatchB;
  pctx.lineWidth = 9;
  pctx.beginPath();
  for (let i = -H; i < W + H; i += 18) { pctx.moveTo(i, 0); pctx.lineTo(i + H, H); }
  pctx.stroke();
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

function stripRect() {
  const k = K();
  const w = cfg.wave.w / k, h = cfg.wave.h / k;
  return { x: (pv.width - w) * cfg.wave.x, y: cfg.wave.y / k, w, h };
}

function drawStrip() {
  const r = stripRect();
  const type = cfg.wave.type;
  const N = Math.max(8, Math.floor(r.w / 3));
  const vals = stripValues(type, N);

  const paint = (col, dx, dy) => {
    pctx.fillStyle = col;
    pctx.strokeStyle = col;
    pctx.lineWidth = 2;
    const cx = r.x + r.w / 2 + dx, cy = r.y + r.h / 2 + dy;
    const step = r.w / N;

    if (type === 'vector') {                          // вектороскоп — фигура, а не полоса
      const rad = Math.min(r.w, r.h) / 2 - 2;
      pctx.beginPath();
      for (let i = 0; i <= 72; i++) {
        const a = i / 72 * Math.PI * 2;
        const amp = vals[Math.floor(i / 73 * N)] || 0;
        const rr = rad * (0.25 + 0.75 * amp) * (0.85 + 0.15 * Math.sin(a * 3 + ui.animT * 2));
        const px = cx + Math.cos(a) * rr;
        const py = cy + Math.sin(a) * rr * (r.h / Math.min(r.w, r.h)) * 0.6;
        i ? pctx.lineTo(px, py) : pctx.moveTo(px, py);
      }
      pctx.closePath();
      pctx.stroke();
      return;
    }

    if (type === 'wave-p2p' || type === 'freq-line') { // ломаная по вершинам
      const base = type === 'freq-line' ? r.y + r.h : cy;
      const span = type === 'freq-line' ? r.h : r.h / 2;
      pctx.beginPath();
      vals.forEach((v, i) => {
        const px = r.x + dx + i * step, py = base + dy - v * span;
        i ? pctx.lineTo(px, py) : pctx.moveTo(px, py);
      });
      pctx.stroke();
      if (type === 'wave-p2p') {                      // вторая половина, зеркально
        pctx.beginPath();
        vals.forEach((v, i) => {
          const px = r.x + dx + i * step, py = cy + dy + v * r.h / 2;
          i ? pctx.lineTo(px, py) : pctx.moveTo(px, py);
        });
        pctx.stroke();
      }
      return;
    }

    vals.forEach((v, i) => {
      const px = r.x + dx + i * step;
      const bh = Math.max(1.5, v * (type.startsWith('wave-') ? r.h / 2 : r.h));
      switch (type) {
        case 'wave-cline': pctx.fillRect(px, cy - bh, 2, bh * 2); break;
        case 'wave-line': pctx.fillRect(px, cy - bh, 1.5, bh); break;
        case 'wave-point':
          pctx.fillRect(px, cy - bh - 1, 2, 2);
          pctx.fillRect(px, cy + bh - 1, 2, 2);
          break;
        case 'freq-dot': pctx.fillRect(px, r.y + dy + r.h - bh - 1, 2, 2); break;
        case 'histogram': pctx.fillRect(px, r.y + dy + r.h - bh, 1, bh); break;
        default: pctx.fillRect(px, r.y + dy + r.h - bh, Math.max(2, step - 1), bh);
      }
    });
  };

  if (cfg.wave.outline.on && (type.startsWith('wave-') || type.startsWith('freq-'))) {
    const d = cfg.wave.outline.size / K();
    [[-d, 0], [d, 0], [0, -d], [0, d]].forEach(p => paint(cfg.wave.outline.color, p[0], p[1]));
  }
  paint(hexA(cfg.wave.color, cfg.wave.alpha), 0, 0);

  if (ui.focus === 'wave') {
    pctx.strokeStyle = tokens().guide;
    pctx.lineWidth = 1.5;
    pctx.setLineDash([4, 4]);
    pctx.strokeRect(r.x, r.y, r.w, r.h);
    pctx.setLineDash([]);
  }
}

/* Осциллограммы читают реальные пики трека. Спектральные виды браузер
   не считает — им строится правдоподобный профиль, который живёт
   вместе с громкостью. */
function stripValues(type, N) {
  const cur = sel.start + ui.animT, win = 1.2;
  const at = tt => {
    if (!media.peaks || !media.audioBuf) return 0.35 + 0.25 * Math.abs(Math.sin(tt * 7 + ui.animT * 3));
    const i = Math.floor(tt / media.audioBuf.duration * media.peaks.length);
    return (i >= 0 && i < media.peaks.length) ? media.peaks[i] : 0;
  };
  const out = new Array(N);
  if (type.startsWith('wave-')) {
    for (let i = 0; i < N; i++) out[i] = at(cur - win / 2 + (i / N) * win);
    return out;
  }
  const amp = at(cur);
  const dens = 0.4 + cfg.wave.freq * 0.6;
  for (let i = 0; i < N; i++) {
    const f = i / N;
    const roll = type === 'cqt' ? Math.exp(-f * 1.4) : Math.exp(-f * 2.6);
    const ripple = 0.55 + 0.45 * Math.abs(Math.sin(f * 28 * dens + ui.animT * 4 + i * 0.7));
    out[i] = clamp(amp * roll * ripple * 1.6, 0, 1);
  }
  return out;
}

/* ------------------------------------------------------------------ текст */
function fontName(tx) {
  const f = FONTS.find(x => x.f === tx.font);
  return f ? f.n : '';
}
function fontCss(tx) {
  const n = fontName(tx), fam = n.split(' — ')[0];
  const style = /Italic/.test(n) ? 'italic ' : '';
  const weight = /Bold/.test(n) ? '700 ' : '400 ';
  return style + weight + (tx.size / K()) + 'px ' + (CSS_FAMILY[fam] || 'sans-serif');
}
function textLines(tx) {
  return (tx.text || t('noText')).split('|').map(s => s.trim());
}
function textAlpha(tx) {
  const a0 = tx.from ?? 0, a1 = tx.to ?? sel.dur;
  const fin = Math.max(0.01, tx.fadeIn ?? 0.6), fout = Math.max(0.01, tx.fadeOut ?? 0.6);
  if (ui.animT < a0 || ui.animT > a1) return 0;
  if (ui.animT < a0 + fin) return (ui.animT - a0) / fin;
  if (ui.animT > a1 - fout) return (a1 - ui.animT) / fout;
  return 1;
}
function drawText(tx, active) {
  const lines = textLines(tx), lh = (tx.size / K()) * 1.25;
  // выбранную надпись показываем всегда — иначе её не поймать вне интервала
  const own = clamp(tx.alpha ?? 1, 0, 1);
  const a = (active ? Math.max(0.3, textAlpha(tx)) : textAlpha(tx)) * own;
  if (a <= 0.001) return;
  const k = K();
  pctx.save();
  pctx.globalAlpha = a;
  pctx.translate(tx.x / k, tx.y / k);
  pctx.rotate(tx.angle * Math.PI / 180);
  pctx.font = fontCss(tx);
  pctx.textAlign = 'center';
  pctx.textBaseline = 'middle';
  pctx.fillStyle = tx.color;
  lines.forEach((l, i) => pctx.fillText(l, 0, (i - (lines.length - 1) / 2) * lh));
  if (active) {
    let wm = 0;
    lines.forEach(l => { wm = Math.max(wm, pctx.measureText(l).width); });
    pctx.strokeStyle = tokens().guide;
    pctx.lineWidth = 1.5;
    pctx.setLineDash([4, 4]);
    pctx.strokeRect(-wm / 2 - 6, -lines.length * lh / 2 - 4, wm + 12, lines.length * lh + 8);
    pctx.setLineDash([]);
  }
  pctx.restore();
  pctx.globalAlpha = 1;
}
function textBox(tx) {
  const lines = textLines(tx), lh = (tx.size / K()) * 1.25;
  pctx.save();
  pctx.font = fontCss(tx);
  let w = 0;
  lines.forEach(l => { w = Math.max(w, pctx.measureText(l).width); });
  pctx.restore();
  return { w: w + 12, h: lines.length * lh + 8 };
}

/* ------------------------------------------------------------------ мышь */
function pvPos(e) {
  const r = pv.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * pv.width, y: (e.clientY - r.top) / r.height * pv.height };
}

/* что лежит под курсором: заставка → надпись → полоса → картинка */
function hitTest(p) {
  const cover = coveringFrame();
  if (cover) return { kind: cover };
  for (let i = cfg.texts.length - 1; i >= 0; i--) {
    const b = textBox(cfg.texts[i]);
    const k = K();
    if (Math.abs(p.x - cfg.texts[i].x / k) < b.w / 2 && Math.abs(p.y - cfg.texts[i].y / k) < b.h / 2) {
      return { kind: 'text', idx: i };
    }
  }
  if (cfg.wave.on) {
    const r = stripRect();
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return { kind: 'wave' };
  }
  return { kind: 'image' };
}

let pdrag = null;

function setImgPos(x, y) {
  cfg.img.x = clamp(x, 0, 1);
  cfg.img.y = clamp(y, 0, 1);
  refreshRows();
  refreshHint('anim');
  drawPreview();
}
function setImgScale(v) {
  cfg.img.scale = clamp(Math.round(v * 100) / 100, 1, 3);
  refreshRows();
  refreshSummaries();
  refreshHint('anim');
  drawPreview();
}
function setWavePos(px, py) {
  const k = K();
  const w = cfg.wave.w / k;
  cfg.wave.x = clamp((px - w / 2) / Math.max(1, pv.width - w), 0, 1);
  cfg.wave.y = Math.round(clamp(py * k - cfg.wave.h / 2, 0, cfg.frame.h));
  refreshRows();
  drawPreview();
}
function setWaveW(v) {
  cfg.wave.w = Math.round(clamp(v, 120, cfg.frame.w));
  refreshRows();
  drawPreview();
}

function attachFrame() {
  const frame = $('frame');

  pv.addEventListener('pointerdown', e => {
    const p = pvPos(e);
    const hit = hitTest(p);
    focusOn(hit.kind, hit.idx);

    if (hit.kind === 'intro' || hit.kind === 'outro') {
      // заставку по кадру не таскают: у неё нет положения, только картинка
      if (!media.frames[hit.kind]) pickFile('image/*', f => loadFrameImage(hit.kind, f));
      return;
    }
    if (hit.kind === 'image') {
      holdStart = true;
      ui.animT = 0;
      drawPreview();
      const st = animState();
      // ход в пикселях превью: запас от обрезки или полей плюс запас масштаба
      const L = media.img ? imageLayout(st) : { iw: st.sw, ih: st.sh };
      pdrag = {
        kind: 'image', px: p.x, py: p.y, ox: cfg.img.x, oy: cfg.img.y,
        rx: Math.abs(L.iw - st.winW) * st.k, ry: Math.abs(L.ih - st.winH) * st.k
      };
    } else if (hit.kind === 'wave') {
      pdrag = { kind: 'wave' };
      setWavePos(p.x, p.y);
    } else {
      const tx = cfg.texts[hit.idx];
      const k = K();
      pdrag = { kind: 'text', dx: p.x - tx.x / k, dy: p.y - tx.y / k };
    }
    frame.classList.add('frame--drag');
    try { pv.setPointerCapture(e.pointerId); } catch (err) { /* без захвата тоже работает */ }
  });

  pv.addEventListener('pointermove', e => {
    if (!pdrag) return;
    const p = pvPos(e);
    if (pdrag.kind === 'image') {
      // тянем картинку: окно едет в противоположную сторону; ось без запаса стоит
      setImgPos(pdrag.rx < 1 ? pdrag.ox : pdrag.ox - (p.x - pdrag.px) / pdrag.rx,
                pdrag.ry < 1 ? pdrag.oy : pdrag.oy - (p.y - pdrag.py) / pdrag.ry);
    } else if (pdrag.kind === 'wave') {
      setWavePos(p.x, p.y);
    } else {
      const tx = cfg.texts[ui.textIdx];
      if (!tx) return;
      const k = K();
      tx.x = Math.round(clamp((p.x - pdrag.dx) * k, 0, cfg.frame.w));
      tx.y = Math.round(clamp((p.y - pdrag.dy) * k, 0, cfg.frame.h));
      refreshRows();
      drawPreview();
    }
  });

  ['pointerup', 'pointercancel'].forEach(ev => pv.addEventListener(ev, () => {
    pdrag = null;
    holdStart = false;
    t0 = 0;
    frame.classList.remove('frame--drag');
  }));

  pv.addEventListener('wheel', e => {
    const hit = hitTest(pvPos(e));
    e.preventDefault();
    focusOn(hit.kind, hit.idx);
    if (hit.kind === 'intro' || hit.kind === 'outro') return;
    if (hit.kind === 'image') {
      ui.animT = 0;
      t0 = 0;
      setImgScale(cfg.img.scale + (e.deltaY < 0 ? 0.05 : -0.05));
    } else if (hit.kind === 'wave') {
      setWaveW(cfg.wave.w + (e.deltaY < 0 ? 20 : -20));
    } else {
      const tx = cfg.texts[hit.idx];
      tx.angle = ((tx.angle + (e.deltaY < 0 ? 3 : -3) + 180 + 360) % 360) - 180;
      refreshRows();
      drawPreview();
    }
  }, { passive: false });

  pv.addEventListener('click', () => {
    if (!media.img && !coveringFrame()) pickFile('image/*', loadImage);
  });

  ['dragenter', 'dragover'].forEach(ev => frame.addEventListener(ev, e => {
    e.preventDefault();
    e.stopPropagation();
    frame.classList.add('frame--over');
  }));
  ['dragleave', 'drop'].forEach(ev => frame.addEventListener(ev, e => {
    e.preventDefault();
    e.stopPropagation();
    frame.classList.remove('frame--over');
  }));
  frame.addEventListener('drop', e => {
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) loadImage(f);
  });

  attachScrub();
}

/* ---------------------------------------------------------------- перемотка */
/* Бегунок под кадром. Пока тянут, транспорт стоит; отпустили — продолжает
   с нового места в том же режиме: со звуком, без звука или на паузе. */
function attachScrub() {
  const box = $('scrub');
  let resume = null;
  const seekTo = e => {
    const r = box.getBoundingClientRect();
    const share = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
    seekPreview(share * totalLen() - introLen());
  };
  let dragging = false;
  box.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    resume = ui.playing ? 'sound' : ui.animating ? 'silent' : null;
    if (ui.playing) stopPlay(); else if (ui.animating) setAnimating(false);
    dragging = true;
    $('frameBox').classList.add('frame-box--scrub');
    try { box.setPointerCapture(e.pointerId); } catch (err) { /* без захвата тоже работает */ }
    seekTo(e);
  });
  box.addEventListener('pointermove', e => { if (dragging) seekTo(e); });
  ['pointerup', 'pointercancel'].forEach(ev => box.addEventListener(ev, () => {
    if (!dragging) return;
    dragging = false;
    $('frameBox').classList.remove('frame-box--scrub');
    if (resume === 'sound') togglePlay(); else if (resume === 'silent') setAnimating(true);
    resume = null;
  }));
}

/* ------------------------------------------------------------------ цикл */
/* Превью идёт по общей шкале: вступление, отрезок, концовка. ui.animT —
   время клипа: под вступлением оно отрицательное, под концовкой больше dur. */
function tick(ts) {
  if (!t0) t0 = ts;
  if (ui.playing) playTick();       // при звуке часы задаёт AudioContext
  else if (!holdStart) ui.animT = ((ts - t0) / 1000) % Math.max(MIN_DUR, totalLen()) - introLen();
  drawPreview();
  onFrameTick();
  rafId = requestAnimationFrame(tick);
}

/* перевести превью на момент tMain (время клипа); анимация — и звук, если
   играет, — продолжится оттуда */
function seekPreview(tMain) {
  ui.animT = tMain;
  t0 = performance.now() - (tMain + introLen()) * 1000;
  if (ui.playing) startSource(tMain + introLen());
  drawPreview();
  onFrameTick();
}

function setAnimating(on) {
  ui.animating = on;
  const b = $('anim');
  b.textContent = on ? '⏸' : '▶';
  b.title = t(on ? 'animStop' : 'animPlay');
  if (on) {
    // холостой цикл продолжается с текущего кадра, а не с нуля
    if (!rafId) { t0 = performance.now() - (ui.animT + introLen()) * 1000; rafId = requestAnimationFrame(tick); }
  } else if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
    drawPreview();
    onFrameTick();
  }
  onPlayState();
}

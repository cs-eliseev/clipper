/* Инспектор: ползунки блоков описаны данными, а не разметкой.
   Один и тот же рисовальщик строит «Кадр», «Волну», «Надписи» и «Движение». */

const rowRefs = {};                  // группа → [{def, input, value}]

const fix = n => v => (+v).toFixed(n);
const int = v => Math.round(v);

function activeText() { return cfg.texts[ui.textIdx] || null; }
function activeAnim() { return cfg.anims[ui.animIdx] || null; }

/* Описание ползунка: откуда берём значение, куда кладём и как показываем. */
function row(label, min, max, step, get, set, fmt) {
  return { label, min, max, step, get, set, fmt: fmt || int };
}

function groupRows(key) {
  if (key === 'image') return {
    rows: [
      row('rowScale', 1, 3, 0.05, () => cfg.img.scale, v => { cfg.img.scale = v; }, fix(2))
    ],
    more: [
      row('rowPosX', 0, 1, 0.01, () => cfg.img.x, v => { cfg.img.x = v; }, fix(2)),
      row('rowPosY', 0, 1, 0.01, () => cfg.img.y, v => { cfg.img.y = v; }, fix(2))
    ]
  };

  if (key === 'wave') return {
    rows: [
      row('rowHeight', 40, Math.round(cfg.frame.h / 2), 10, () => cfg.wave.h, v => { cfg.wave.h = v; }),
      row('rowPosY', 0, cfg.frame.h, 10, () => cfg.wave.y, v => { cfg.wave.y = v; })
    ],
    more: [
      row('rowWidth', 120, cfg.frame.w, 10, () => cfg.wave.w, v => { cfg.wave.w = v; }),
      row('rowPosX', 0, 1, 0.01, () => cfg.wave.x, v => { cfg.wave.x = v; }, fix(2)),
      row('rowFreq', 0, 1, 0.05, () => cfg.wave.freq, v => { cfg.wave.freq = v; }, fix(2)),
      row('rowAlpha', 0.1, 1, 0.05, () => cfg.wave.alpha, v => { cfg.wave.alpha = v; }, fix(2)),
      row('rowOutlineSize', 1, 8, 1, () => cfg.wave.outline.size, v => { cfg.wave.outline.size = v; })
    ]
  };

  if (key === 'text') {
    const tx = activeText();
    if (!tx) return { rows: [], more: [] };
    return {
      rows: [
        row('rowSize', 20, 180, 2, () => tx.size, v => { tx.size = v; }),
        row('rowTextAlpha', 0.05, 1, 0.05, () => tx.alpha ?? 1, v => { tx.alpha = v; }, fix(2)),
        row('rowAppears', 0, sel.dur, 0.1, () => tx.from, v => { tx.from = v; }, fix(1)),
        row('rowFades', 0, sel.dur, 0.1, () => tx.to, v => { tx.to = v; }, fix(1)),
        // скорость появления и ухода — длительность проявления и затухания
        row('rowFadeIn', 0, 4, 0.1, () => tx.fadeIn, v => { tx.fadeIn = v; }, fix(1)),
        row('rowFadeOut', 0, 4, 0.1, () => tx.fadeOut, v => { tx.fadeOut = v; }, fix(1))
      ],
      more: [
        row('rowAngle', -180, 180, 1, () => tx.angle, v => { tx.angle = v; }, v => int(v) + '°'),
        row('rowPosX', 0, cfg.frame.w, 5, () => tx.x, v => { tx.x = v; }),
        row('rowPosY', 0, cfg.frame.h, 5, () => tx.y, v => { tx.y = v; })
      ]
    };
  }

  if (key === 'anim') {
    const a = activeAnim();
    if (!a) return { rows: [], more: [] };
    const from = row('rowFromSec', 0, sel.dur, 0.1, () => a.from, v => { a.from = v; }, fix(1));
    const to = row('rowToSec', 0, sel.dur, 0.1, () => a.to, v => { a.to = v; }, fix(1));
    if (a.type === 'dim') return {
      rows: [row('rowStrength', 0.05, 0.9, 0.05, () => a.value, v => { a.value = v; }, fix(2)), from, to],
      more: [
        row('rowFadeIn', 0, 4, 0.1, () => a.fadeIn, v => { a.fadeIn = v; }, fix(1)),
        row('rowFadeOut', 0, 4, 0.1, () => a.fadeOut, v => { a.fadeOut = v; }, fix(1))
      ]
    };
    return {
      rows: [from, to],
      more: [row('rowSpeed', 0.3, 2.5, 0.1, () => a.speed, v => { a.speed = v; }, fix(1))]
    };
  }

  if (key === 'intro' || key === 'outro') {
    const f = cfg[key];
    if (!f) return { rows: [], more: [] };
    const rows = [row('rowHold', 0.5, 10, 0.1, () => f.duration, v => { f.duration = v; }, fix(1))];
    if (f.anim !== 'cut') {
      rows.push(row('rowTransDur', 0.1, Math.min(3, sel.dur), 0.1, () => f.animDur, v => { f.animDur = v; }, fix(1)));
    }
    return {
      rows,
      more: [row('rowAudioFade', 0, 3, 0.1, () => f.audioFade, v => { f.audioFade = v; }, fix(1))]
    };
  }

  if (key === 'thumb') {
    const th = cfg.thumbnail;
    if (th.mode !== 'frame') return { rows: [], more: [] };
    // ползунок паркует превью на выбранном кадре — виден именно он
    return {
      rows: [row('rowThumbTime', 0, totalLen(), 0.1, () => th.time, v => {
        th.time = v;
        if (!ui.playing) setAnimating(false);
        seekPreview(v - introLen());
      }, fix(1))],
      more: []
    };
  }

  return { rows: [], more: [] };
}

/* Число справа от ползунка — поле ввода: щелчок, набрать, Enter.
   Стрелки ↑↓ шагают на step, Esc возвращает прежнее значение. */
function buildRow(def, group) {
  const wrap = document.createElement('div');
  wrap.className = 'insp__row';
  wrap.innerHTML =
    '<div class="field__head">' +
      '<span class="field__label"></span>' +
      '<input type="text" class="field__value" inputmode="decimal" spellcheck="false">' +
    '</div>' +
    '<input type="range" class="field__range">';
  wrap.querySelector('.field__label').textContent = t(def.label);
  const value = wrap.querySelector('.field__value');
  const input = wrap.querySelector('.field__range');
  input.min = def.min;
  input.max = def.max;
  input.step = def.step;
  input.value = def.get();
  value.value = def.fmt(def.get());
  const show = () => { value.value = def.fmt(def.get()); };
  const apply = v => {
    def.set(clamp(v, def.min, def.max));
    input.value = def.get();
    show();
    onRowInput(group);
  };
  input.oninput = () => {
    def.set(parseFloat(input.value));
    show();
    onRowInput(group);
  };
  value.onfocus = () => value.select();
  value.onchange = () => {
    const v = parseTyped(value.value);
    if (v === null) show(); else apply(v);
  };
  value.onkeydown = e => {
    if (e.key === 'Enter') { value.blur(); }
    else if (e.key === 'Escape') { show(); value.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = parseTyped(value.value);
      const step = +def.step * (e.shiftKey ? 10 : 1);
      apply((cur === null ? def.get() : cur) + (e.key === 'ArrowUp' ? step : -step));
      value.select();
    }
  };
  rowRefs[group].push({ def, input, value });
  return wrap;
}

/* «1,5», «12°», « 0.8 » — число; всё остальное — null */
function parseTyped(text) {
  const m = String(text).replace(',', '.').match(/-?\d*\.?\d+/);
  if (!m) return null;
  const v = parseFloat(m[0]);
  return isNaN(v) ? null : v;
}

function renderRows(group) {
  const rowsHost = document.querySelector('[data-rows="' + group + '"]');
  const moreHost = document.querySelector('[data-more="' + group + '"]');
  if (!rowsHost) return;
  rowRefs[group] = [];
  rowsHost.innerHTML = '';
  moreHost.innerHTML = '';

  const { rows, more } = groupRows(group);
  rows.forEach(def => rowsHost.appendChild(buildRow(def, group)));

  const hint = document.querySelector('[data-hint="' + group + '"]');
  if (hint) hint.textContent = groupHint(group);

  if (!more.length) { moreHost.hidden = true; return; }
  moreHost.hidden = false;
  const open = !!ui.more[group];
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'insp__more-btn';
  btn.textContent = t('more', { sign: open ? '−' : '+', n: more.length });
  btn.onclick = () => { ui.more[group] = !open; renderRows(group); };
  moreHost.appendChild(btn);

  if (open) {
    const box = document.createElement('div');
    box.className = 'insp__more-rows';
    more.forEach(def => box.appendChild(buildRow(def, group)));
    moreHost.appendChild(box);
  }
}

/* только подсказка группы — когда её смысл зависит от чужих значений */
function refreshHint(group) {
  const hint = document.querySelector('[data-hint="' + group + '"]');
  if (hint) hint.textContent = groupHint(group);
}

/* обновляет значения, не пересобирая ползунки — чтобы не рвать перетаскивание */
function refreshRows() {
  GROUPS.forEach(g => {
    (rowRefs[g] || []).forEach(r => {
      const v = r.def.get();
      if (document.activeElement !== r.input) r.input.value = v;
      if (document.activeElement !== r.value) r.value.value = r.def.fmt(v);
    });
  });
}

function renderAllRows() {
  GROUPS.forEach(renderRows);
}

/* ------------------------------------------------------------------ хинты */
function axisConflict(i) {
  const a = cfg.anims[i];
  if (!a || !ANIM_AXIS[a.type]) return null;
  const other = cfg.anims.find((b, j) => j !== i && ANIM_AXIS[b.type] === ANIM_AXIS[a.type]
    && b.from < a.to - 0.05 && a.from < b.to - 0.05);
  return other ? t(ANIM_AXIS[a.type]) : null;
}

/* Почему панораме некуда идти: 'noRoomScale' — запаса нет вовсе (пропорции
   картинки как у кадра, масштаб 1×), 'noRoom' — картинка упёрта в край по оси;
   null — ход есть или это не панорама */
const PAN_AXIS_KEY = { panright: 'x', panleft: 'x', pandown: 'y', panup: 'y' };
function panProblem(a) {
  const key = PAN_AXIS_KEY[a.type];
  const room = key ? imageRoom() : null;
  if (!room) return null;
  if (room[key] < 1) return 'noRoomScale';
  const v = cfg.img[key];
  return (a.type === 'panright' || a.type === 'pandown' ? 1 - v : v) < 0.05 ? 'noRoom' : null;
}

function groupHint(group) {
  if (group === 'anim') {
    const a = activeAnim();
    const base = a ? t('desc' + a.type.charAt(0).toUpperCase() + a.type.slice(1)) : t('hintAnim');
    const conflict = axisConflict(ui.animIdx);
    const problem = a ? panProblem(a) : null;
    return base + (conflict ? '  ' + t('conflict', { axis: conflict }) : '')
      + (problem ? '  ' + t(problem) : '');
  }
  return t('hint' + group.charAt(0).toUpperCase() + group.slice(1));
}

/* -------------------------------------------------------------- элементы */
function renderSmooth() {
  const host = $('smooth');
  host.innerHTML = '';
  [['smoothFast', 1], ['smoothNormal', 2], ['smoothSlow', 3]].forEach(([key, v]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--chip' + (cfg.smooth === v ? ' btn--on' : '');
    b.textContent = t(key);
    b.onclick = () => { cfg.smooth = v; renderSmooth(); };
    host.appendChild(b);
  });
}

function renderWaveControls() {
  const on = $('waveOn');
  on.textContent = t(cfg.wave.on ? 'waveOn' : 'waveOff');
  on.classList.toggle('btn--on', cfg.wave.on);

  const sel2 = $('waveType');
  if (!sel2.children.length) {
    WAVE_TYPES.forEach(w => {
      const o = document.createElement('option');
      o.value = w.id;
      sel2.appendChild(o);
    });
  }
  [...sel2.children].forEach((o, i) => { o.textContent = t(WAVE_TYPES[i].key); });
  sel2.value = cfg.wave.type;

  $('outlineOn').checked = cfg.wave.outline.on;
  $('outlineRow').hidden = !cfg.wave.outline.on;
  renderSwatch('wave', cfg.wave.color);
  renderSwatch('outline', cfg.wave.outline.color);
}

function renderSwatch(name, hex) {
  const box = document.querySelector('.swatch[data-color="' + name + '"]');
  if (!box) return;
  box.querySelector('.swatch__dot').style.background = hex;
  box.querySelector('.swatch__hex').textContent = hex;
}

function renderTextControls() {
  const host = $('textList');
  host.innerHTML = '';
  cfg.texts.forEach((tx, i) => {
    const li = document.createElement('div');
    li.className = 'layer' + (i === ui.textIdx ? ' layer--on' : '');
    li.innerHTML = '<span class="layer__name"></span><span class="layer__range"></span>' +
                   '<button type="button" class="layer__del">×</button>';
    li.querySelector('.layer__name').textContent = tx.text ? tx.text.replace(/\|/g, ' / ') : t('noText');
    li.querySelector('.layer__range').textContent =
      (+tx.from).toFixed(1) + '–' + (+tx.to).toFixed(1) + ' ' + t('sec');
    li.onclick = () => { ui.textIdx = i; focusOn('text'); renderTextControls(); renderRows('text'); drawPreview(); };
    li.querySelector('.layer__del').onclick = e => {
      e.stopPropagation();
      cfg.texts.splice(i, 1);
      ui.textIdx = Math.min(ui.textIdx, cfg.texts.length - 1);
      renderTextControls();
      renderRows('text');
      refreshSummaries();
      renderLanes();
      drawPreview();
    };
    host.appendChild(li);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'layer__add';
  add.textContent = t('addText');
  add.onclick = addText;
  host.appendChild(add);

  const tx = activeText();
  const value = $('textValue');
  const font = $('textFont');
  value.hidden = !tx;
  font.hidden = !tx;
  document.querySelector('.swatch[data-color="text"]').parentElement.hidden = !tx;
  if (!tx) return;

  value.value = tx.text;
  if (!font.children.length) {
    FONTS.forEach(f => {
      const o = document.createElement('option');
      o.value = f.f;
      o.textContent = f.n;
      font.appendChild(o);
    });
  }
  font.value = tx.font;
  renderSwatch('text', tx.color);
}

function addText() {
  cfg.texts.push({
    text: '', x: Math.round(cfg.frame.w / 2),
    y: Math.min(Math.round(cfg.frame.h * 0.88), Math.round(cfg.frame.h * 0.42) + cfg.texts.length * 160),
    angle: 0, size: Math.round(cfg.frame.w / 17), color: '#ffffff', alpha: 1, font: (FONTS[SET.defaultFont] || FONTS[0]).f,
    from: 0, to: sel.dur, fadeIn: 0.6, fadeOut: 0.6
  });
  ui.textIdx = cfg.texts.length - 1;
  focusOn('text');
  renderTextControls();
  renderRows('text');
  refreshSummaries();
  renderLanes();
  drawPreview();
}

function renderAnimControls() {
  const host = $('animList');
  host.innerHTML = '';
  cfg.anims.forEach((a, i) => {
    const li = document.createElement('div');
    li.className = 'layer' + (i === ui.animIdx ? ' layer--on' : '');
    li.innerHTML = '<span class="layer__name"></span><span class="layer__range"></span>' +
                   '<button type="button" class="layer__del">×</button>';
    li.querySelector('.layer__name').textContent =
      t('anim' + a.type.charAt(0).toUpperCase() + a.type.slice(1)) + (axisConflict(i) ? ' ⚠' : '');
    li.querySelector('.layer__range').textContent =
      (+a.from).toFixed(1) + '–' + (+a.to).toFixed(1) + ' ' + t('sec');
    li.onclick = () => { ui.animIdx = i; focusOn('anim'); renderAnimControls(); renderRows('anim'); drawPreview(); };
    li.querySelector('.layer__del').onclick = e => {
      e.stopPropagation();
      cfg.anims.splice(i, 1);
      ui.animIdx = Math.min(ui.animIdx, cfg.anims.length - 1);
      renderAnimControls();
      renderRows('anim');
      refreshSummaries();
      renderLanes();
      drawPreview();
    };
    host.appendChild(li);
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'layer__add';
  add.textContent = t('addMove');
  add.onclick = addAnim;
  host.appendChild(add);

  const sel2 = $('animType');
  const a = activeAnim();
  sel2.hidden = !a;
  if (!sel2.children.length) {
    ANIM_TYPES.forEach(id => {
      const o = document.createElement('option');
      o.value = id;
      sel2.appendChild(o);
    });
  }
  [...sel2.children].forEach((o, i) => {
    const id = ANIM_TYPES[i];
    o.textContent = t('anim' + id.charAt(0).toUpperCase() + id.slice(1));
  });
  if (a) sel2.value = a.type;
}

function addAnim() {
  // Новое движение занимает весь клип. Два подряд идут одновременно, если они
  // по разным осям; чтобы выстроить их друг за другом — разведите интервалы.
  cfg.anims.push({ type: 'zoomin', speed: 1.0, from: 0, to: sel.dur });
  ui.animIdx = cfg.anims.length - 1;
  focusOn('anim');
  renderAnimControls();
  renderRows('anim');
  refreshSummaries();
  renderLanes();
  drawPreview();
}

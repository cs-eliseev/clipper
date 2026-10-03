/* Сборка: раскладки, панель, шапка и всё, что связывает модули.
   Набор раскладок, блоков и форматов приходит из config.js. */

const VARIANTS = SET.variants.map(v => [v.id, v.name]);

/* --------------------------------------------------------------- раскладка */
function applyVariant() {
  const app = $('app');
  const track = $('track');
  app.classList.toggle('app--c', ui.variant === 'c');

  const slot = ui.variant === 'a' ? $('slotTop')
    : ui.variant === 'b' ? $('slotBottom')
    : document.querySelector('[data-slot="track"]');
  if (track.parentElement !== slot) slot.appendChild(track);

  $('slotTop').hidden = ui.variant !== 'a';
  $('slotBottom').hidden = ui.variant !== 'b';
  document.querySelector('.transport').hidden = ui.variant !== 'c';

  track.classList.toggle('track--short', ui.variant === 'b');
  track.classList.toggle('track--tall', ui.variant === 'c');

  $('panelTitle').textContent = t(ui.variant === 'c' ? 'panelSteps' : 'panelSettings');
  [...$('variants').children].forEach(b => b.classList.toggle('seg__btn--on', b.dataset.variant === ui.variant));

  renderPanel();
  requestAnimationFrame(() => { resizePreview(); drawPreview(); drawWave(); });
}

/* ------------------------------------------------------------------ панель */
function renderPanel() {
  const keys = blockKeys();
  $('panel').classList.toggle('panel--closed', !ui.panelOpen);
  $('panelBody').hidden = !ui.panelOpen;
  $('panelTitle').hidden = !ui.panelOpen;
  $('multi').hidden = !ui.panelOpen;
  $('all').hidden = !ui.panelOpen;
  $('panelToggle').textContent = ui.panelOpen ? '›' : '‹';
  $('panelToggle').title = t(ui.panelOpen ? 'panelCollapse' : 'panelExpand');

  $('multi').classList.toggle('btn--on', ui.accordion === 'multi');
  $('multi').title = t(ui.accordion === 'multi' ? 'multiOn' : 'multiOff');

  const anyOpen = keys.some(k => ui.open[k]);
  $('all').textContent = anyOpen ? '⌃' : '⌄';
  $('all').title = t(anyOpen ? 'collapseAll' : 'expandAll');

  requestAnimationFrame(() => drawWave());

  document.querySelectorAll('[data-block]').forEach(box => {
    const k = box.dataset.block;
    const used = keys.indexOf(k) >= 0;
    box.hidden = !used;
    const open = used && !!ui.open[k];
    box.classList.toggle('block--open', open);
    box.querySelector('.block__mark').textContent = open ? '−' : '+';
    box.querySelector('.block__body').hidden = !open;
  });
}

/* Порядок блоков задаёт config.js: переставляем разметку под него. */
function applyBlockOrder() {
  const body = $('panelBody');
  SET.blocks.order.forEach(k => {
    const box = body.querySelector('[data-block="' + k + '"]');
    if (box) body.appendChild(box);
  });
}

function openBlock(key) {
  if (blockKeys().indexOf(key) < 0) return;
  if (ui.accordion === 'single') {
    blockKeys().forEach(k => { ui.open[k] = false; });
  }
  ui.open[key] = true;
  renderPanel();
  saveUi();
}

function toggleBlock(key) {
  if (ui.accordion === 'single') {
    const was = ui.open[key];
    blockKeys().forEach(k => { ui.open[k] = false; });
    ui.open[key] = !was;
  } else {
    ui.open[key] = !ui.open[key];
  }
  renderPanel();
  saveUi();
}

/* Фокус — с чем работает мышь на кадре. Заодно открывает нужный блок. */
function focusOn(kind, idx) {
  const changed = ui.focus !== kind || (kind === 'text' && idx !== undefined && idx !== ui.textIdx);
  const was = ui.focus;
  ui.focus = kind;
  if (kind === 'text' && idx !== undefined) ui.textIdx = idx;
  if (GROUPS.indexOf(kind) >= 0) openBlock(GROUP_BLOCK[kind] || kind);
  if (changed) {
    if (kind === 'text') { renderTextControls(); renderRows('text'); }
    if (kind === 'anim') { renderAnimControls(); renderRows('anim'); }
    if (kind === 'intro' || kind === 'outro' || was === 'intro' || was === 'outro') renderFrameControls();
    updateStageHint();
  }
}

function updateStageHint() {
  const key = ui.focus === 'wave' ? 'stageHintWave'
    : ui.focus === 'text' ? 'stageHintText'
    : (ui.focus === 'intro' || ui.focus === 'outro') ? 'stageHintFrame'
    : 'stageHintImage';
  $('stageHint').textContent = t(key);
  $('frameHint').textContent = media.img ? (cfg.frame.w + '×' + cfg.frame.h) : t('dropImage');
}

/* --------------------------------------------------------------- показания */
function refreshSummaries() {
  const sum = k => document.querySelector('[data-summary="' + k + '"]');
  sum('track').textContent = sel.start.toFixed(1) + ' / ' + sel.dur.toFixed(1) + ' ' + t('sec');
  sum('image').textContent = cfg.frame.w + '×' + cfg.frame.h;
  sum('wave').textContent = cfg.wave.on ? t(WAVE_TYPES.find(w => w.id === cfg.wave.type).key) : t('off');
  sum('text').textContent = cfg.texts.length ? t('pcs', { n: cfg.texts.length }) : t('none');
  sum('anim').textContent = cfg.anims.length ? t('pcs', { n: cfg.anims.length }) : t('none');
  const th = cfg.thumbnail;
  const frames = [cfg.intro && t('sumIntro'), cfg.outro && t('sumOutro'),
    th.mode !== 'none' && t('sumThumb')].filter(Boolean);
  sum('frames').textContent = frames.length ? frames.join(' + ') : t('none');
  sum('export').textContent = queue.length ? t('pcs', { n: queue.length }) : $('outName').value;

  $('trackName').textContent = media.trackPath || t('noTrackFile');
  $('imageName').textContent = media.imagePath || t('noImageFile');
  $('trackDot').classList.toggle('head__dot--empty', !media.audioBuf);
  $('trackDot').classList.toggle('head__dot--track', !!media.audioBuf);
  $('imageDot').classList.toggle('head__dot--empty', !media.img);

  $('imgContain').classList.toggle('btn--on', cfg.img.fit === 'contain');
  $('fw').value = cfg.frame.w;
  $('fh').value = cfg.frame.h;
  [...$('formats').children].forEach(b => {
    const p = FRAME_PRESETS[+b.dataset.idx];
    b.classList.toggle('seg__btn--on', p.w === cfg.frame.w && p.h === cfg.frame.h);
  });
  updateStageHint();
}

/* -------------------------------------------------------------- обратные */
function onRowInput(group) {
  if (group === 'text' || group === 'anim') { renderLanes(); }
  if (group === 'text') renderTextControls();
  if (group === 'anim') renderAnimControls();
  if (group === 'wave' || group === 'image') refreshSummaries();
  if (group === 'image') refreshHint('anim');           // ход панорамы зависит от положения картинки
  if (group === 'intro' || group === 'outro') {
    // длительность заставки двигает общую шкалу
    cfg.thumbnail.time = Math.min(cfg.thumbnail.time, totalLen());
    renderFrameControls();
    renderRows('thumb');
    refreshSummaries();
    renderLanes();
    drawWave();
  }
  if (group === 'thumb') refreshSummaries();
  drawPreview();
}

function onSegmentChange(fromInputs) {
  clampSel();
  // отрезок задаёт горизонт для надписей и движений
  cfg.anims.forEach(a => { a.to = Math.min(a.to, sel.dur); a.from = Math.min(a.from, a.to); });
  cfg.texts.forEach(tx => { tx.to = Math.min(tx.to, sel.dur); tx.from = Math.min(tx.from, tx.to); });
  ['intro', 'outro'].forEach(k => { if (cfg[k]) cfg[k].animDur = Math.min(cfg[k].animDur, sel.dur); });
  cfg.thumbnail.time = Math.min(cfg.thumbnail.time, totalLen());
  if (ui.playing) startSource(clamp(actx.currentTime - playFrom, 0, totalLen()));   // звук — за новым отрезком
  if (fromInputs !== false) renderTrack(); else { drawWave(); renderLanes(); updateSegInputs(); }
  renderRows('text');
  renderRows('anim');
  renderRows('intro');
  renderRows('outro');
  renderRows('thumb');
  refreshSummaries();
  drawPreview();
}

function updateSegInputs() {
  const active = document.activeElement;
  if (active !== $('segStart')) $('segStart').value = sel.start.toFixed(1);
  if (active !== $('segEnd')) $('segEnd').value = (sel.start + sel.dur).toFixed(1);
  if (active !== $('segLen')) $('segLen').value = sel.dur.toFixed(1);
}

function onTrackLoaded() {
  renderTrack();
  refreshSummaries();
}

function onImageLoaded() {
  drawPreview();
  refreshSummaries();
}

/* кнопка ▶ отражает превью в целом: со звуком или без */
function onPlayState() {
  const on = ui.playing || ui.animating;
  $('play').textContent = on ? '▮▮' : '▶';
  $('play').title = t(on ? 'stopSegment' : 'playSegment');
  drawWave();
}

function onFrameTick() {
  const at = ui.animT + introLen(), total = totalLen();
  const share = clamp(at / Math.max(0.1, total), 0, 1);
  $('progress').style.width = (share * 100).toFixed(2) + '%';
  $('knob').style.left = (share * 100).toFixed(2) + '%';
  $('time').textContent = at.toFixed(1) + ' / ' + total.toFixed(1) + ' ' + t('sec');
  drawWave();
  moveLaneHeads();
}

/* ------------------------------------------------------------------ кадр */
function setFrame(w, h) {
  cfg.frame.w = Math.max(64, Math.round(w));
  cfg.frame.h = Math.max(64, Math.round(h));
  cfg.wave.w = Math.min(cfg.wave.w, cfg.frame.w);
  cfg.wave.y = Math.min(cfg.wave.y, cfg.frame.h);
  cfg.texts.forEach(tx => {
    tx.x = Math.min(tx.x, cfg.frame.w);
    tx.y = Math.min(tx.y, cfg.frame.h);
  });
  saveUi();
  resizePreview();
  renderAllRows();
  refreshSummaries();
  drawPreview();
}

/* ------------------------------------------------------------------ шапка */
function buildHeader() {
  const vhost = $('variants');
  vhost.innerHTML = '';
  VARIANTS.forEach(([id, key]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg__btn';
    b.dataset.variant = id;
    b.textContent = t(key);
    b.onclick = () => { ui.variant = id; saveUi(); applyVariant(); refreshSummaries(); };
    vhost.appendChild(b);
  });

  const fhost = $('formats');
  fhost.innerHTML = '';
  FRAME_PRESETS.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg__btn';
    b.dataset.idx = i;
    b.textContent = p.label;
    b.onclick = () => {
      cfg.wave.y = Math.round(p.h * 0.84);
      setFrame(p.w, p.h);
    };
    fhost.appendChild(b);
  });
}

function bind() {
  $('panelToggle').onclick = () => { ui.panelOpen = !ui.panelOpen; saveUi(); renderPanel(); };
  $('multi').onclick = () => {
    if (ui.accordion === 'multi') {
      let kept = false;
      blockKeys().forEach(k => {
        if (ui.open[k] && !kept) kept = true;
        else ui.open[k] = false;
      });
      ui.accordion = 'single';
    } else {
      ui.accordion = 'multi';
    }
    saveUi();
    renderPanel();
  };
  $('all').onclick = () => {
    const anyOpen = blockKeys().some(k => ui.open[k]);
    blockKeys().forEach(k => { ui.open[k] = !anyOpen; });
    if (!anyOpen) ui.accordion = 'multi';
    saveUi();
    renderPanel();
  };
  document.querySelectorAll('.block__head').forEach(head => {
    head.onclick = () => toggleBlock(head.parentElement.dataset.block);
  });

  $('pickTrack').onclick = () => pickFile('audio/*', loadAudio);
  $('pickImage').onclick = () => pickFile('image/*', loadImage);
  $('pickImage2').onclick = () => pickFile('image/*', loadImage);

  $('imgFit').onclick = () => {
    // вписать — значит заполнить кадр: режим «целиком, с полями» снимается
    cfg.img.fit = 'cover';
    cfg.img.scale = 1;
    cfg.img.x = 0.5;
    cfg.img.y = 0.5;
    $('imgContain').classList.remove('btn--on');
    refreshRows();
    drawPreview();
  };
  $('imgContain').onclick = () => {
    cfg.img.fit = cfg.img.fit === 'contain' ? 'cover' : 'contain';
    $('imgContain').classList.toggle('btn--on', cfg.img.fit === 'contain');
    drawPreview();
  };

  $('waveOn').onclick = () => {
    cfg.wave.on = !cfg.wave.on;
    if (cfg.wave.on) focusOn('wave');
    renderWaveControls();
    refreshSummaries();
    renderLanes();
    drawPreview();
  };
  $('waveType').onchange = () => {
    cfg.wave.type = $('waveType').value;
    refreshSummaries();
    renderLanes();
    drawPreview();
  };
  $('outlineOn').onchange = () => {
    cfg.wave.outline.on = $('outlineOn').checked;
    renderWaveControls();
    drawPreview();
  };

  $('textValue').oninput = () => {
    const tx = activeText();
    if (!tx) return;
    tx.text = $('textValue').value;
    renderTextControls();
    renderLanes();
    drawPreview();
  };
  $('textFont').onchange = () => {
    const tx = activeText();
    if (!tx) return;
    tx.font = $('textFont').value;
    drawPreview();
  };

  $('animType').onchange = () => {
    const a = activeAnim();
    if (!a) return;
    a.type = $('animType').value;
    // кадр не трогаем: если панораме некуда идти, об этом скажет подсказка
    if (a.type === 'dim') {
      if (a.value === undefined) a.value = 0.45;
      if (a.fadeIn === undefined) a.fadeIn = 0.5;
      if (a.fadeOut === undefined) a.fadeOut = 0.5;
    } else if (a.speed === undefined) {
      a.speed = 1.0;
    }
    renderAnimControls();
    renderRows('anim');
    renderLanes();
    drawPreview();
  };

  const setFrameFromInputs = () => {
    const w = parseInt($('fw').value, 10), h = parseInt($('fh').value, 10);
    setFrame(isNaN(w) ? cfg.frame.w : w, isNaN(h) ? cfg.frame.h : h);
  };
  [$('fw'), $('fh')].forEach(inp => {
    inp.oninput = () => { inp.value = inp.value.replace(/[^0-9]/g, ''); };
    inp.onblur = setFrameFromInputs;
    inp.onkeydown = e => { if (e.key === 'Enter') inp.blur(); };
  });

  $('anim').onclick = () => { if (ui.playing) stopPlay(); else setAnimating(!ui.animating); };

  document.addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    if (e.key === 'Escape') openScript(false);
  });

  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => e.preventDefault());

  window.addEventListener('resize', () => {
    resizePreview();
    drawPreview();
    drawWave();
  });
}

/* ---------------------------------------------------------------- настройки */
function fillSelect(select, items, current) {
  select.innerHTML = '';
  items.forEach(item => {
    const o = document.createElement('option');
    o.value = item.value;
    o.textContent = item.label;
    select.appendChild(o);
  });
  select.value = current;
}

function renderPrefs() {
  fillSelect($('langSelect'),
    Object.keys(App.langs).map(code => ({ value: code, label: App.langs[code].name })),
    currentLang());
  fillSelect($('themeSelect'),
    App.themes.map(x => ({ value: x.id, label: t(x.name) })),
    currentTheme());
}

function togglePrefs(open) {
  const box = $('prefs');
  box.hidden = !open;
  if (!open) return;
  const r = $('prefsBtn').getBoundingClientRect();
  box.style.top = (r.bottom + 8) + 'px';
  box.style.left = Math.max(8, Math.min(window.innerWidth - box.offsetWidth - 8, r.right - box.offsetWidth)) + 'px';
}

function bindPrefs() {
  renderPrefs();
  $('prefsBtn').onclick = () => togglePrefs($('prefs').hidden);
  $('langSelect').onchange = () => setLang($('langSelect').value);
  $('langFile').onclick = () => loadLangFile(renderPrefs);
  $('langTemplate').onclick = exportLangTemplate;
  $('themeSelect').onchange = () => applyTheme($('themeSelect').value);
  $('themeFile').onclick = () => loadThemeFile(renderPrefs);
  $('prefsReset').onclick = resetCustom;

  document.addEventListener('click', e => {
    if ($('prefs').hidden) return;
    if (e.target.closest('.prefs') || e.target.closest('#prefsBtn')) return;
    $('prefs').hidden = true;
  });
  App.on('langs', renderPrefs);
  App.on('themes', renderPrefs);
  App.on('theme', renderPrefs);
}

/* Смена языка перерисовывает всё, что собрано в JS. */
function relabel() {
  applyStatic();
  buildHeader();
  renderSmooth();
  renderWaveControls();
  renderTextControls();
  renderAnimControls();
  renderFrameControls();
  renderThumbControls();
  renderAllRows();
  renderTrack();
  renderQueue();
  renderPrefs();
  applyVariant();
  refreshSummaries();
  setAnimating(ui.animating);
  [...$('lenPresets').children].forEach(x => { x.textContent = x.dataset.len + ' ' + t('sec'); });
}

/* ------------------------------------------------------------------ старт */
function init() {
  initLang();
  initTheme();

  $('renderer').value = SET.renderer || './render-clip.py';
  $('baseDir').value = SET.baseDir || '';
  $('outName').value = SET.outName || 'clip01.mp4';

  loadUi();
  applyBlockOrder();

  buildHeader();
  bind();
  bindPrefs();
  attachFrame();
  attachTrack();
  attachQueue();
  attachColorPicker();
  attachFrames();

  renderSmooth();
  renderWaveControls();
  renderTextControls();
  renderAnimControls();
  renderFrameControls();
  renderThumbControls();
  renderAllRows();
  applyVariant();
  resizePreview();
  renderTrack();
  renderQueue();
  refreshSummaries();
  setAnimating(false);             // пустой странице крутиться незачем — запуск кнопкой ▶

  App.on('lang', relabel);
  App.on('theme', () => { drawPreview(); drawWave(); });
}

init();

/* Заставки и миниатюра: начальный и конечный кадры вокруг клипа и обложка
   для проводника. Геометрия перехода повторяет build_frame из render-clip.py:
   что видно в превью, то и получится в файле. */

function newFrame(kind, name) {
  return {
    image: name, duration: kind === 'intro' ? 2 : 3, fit: 'cover',
    anim: 'fade', dir: 'left', animDur: 0.6, audioFade: kind === 'intro' ? 0.5 : 1
  };
}

/* Где заставка в момент ui.animT (время клипа), или null, если её нет на экране.
   alpha — прозрачность, dx/dy — сдвиг в долях кадра, zoom — масштаб от центра. */
function frameOverlay(kind) {
  const f = cfg[kind];
  if (!f) return null;
  const t = ui.animT, D = sel.dur;
  const trans = f.anim === 'cut' ? 0 : Math.min(+f.animDur, D);
  let leave;                                  // 0 — заставка на месте, 1 — её нет
  if (kind === 'intro') {
    if (t < 0) leave = 0;
    else if (trans > 0 && t < trans) leave = t / trans;
    else return null;
  } else {
    const t0 = D - trans;
    if (t < t0) return null;
    leave = trans > 0 ? 1 - Math.min(1, (t - t0) / trans) : 0;
  }
  const e = leave * leave * (3 - 2 * leave);   // smoothstep, как в рендере
  const o = { alpha: 1, dx: 0, dy: 0, zoom: 1 };
  if (f.anim === 'fade' || f.anim === 'slidefade' || f.anim === 'zoom') o.alpha = 1 - leave;
  if (f.anim === 'slide' || f.anim === 'slidefade') {
    // вступление уходит в сторону dir, концовка приходит с противоположной, двигаясь в dir
    const sign = ({ left: -1, right: 1, up: -1, down: 1 })[f.dir] * (kind === 'intro' ? 1 : -1);
    if (f.dir === 'left' || f.dir === 'right') o.dx = sign * e; else o.dy = sign * e;
  }
  if (f.anim === 'zoom') o.zoom = 1 + FRAME_ZOOM * leave;
  return o;
}

/* какая заставка сейчас закрывает кадр целиком */
function coveringFrame() {
  const full = kind => {
    const o = frameOverlay(kind);
    return !!o && o.alpha > 0.999 && !o.dx && !o.dy && o.zoom === 1;
  };
  return full('outro') ? 'outro' : full('intro') ? 'intro' : null;
}

/* ------------------------------------------------------------------ файлы */
function readImage(file, done) {
  const url = URL.createObjectURL(file);
  const im = new Image();
  im.onload = () => { URL.revokeObjectURL(url); done(im); };
  im.onerror = () => { URL.revokeObjectURL(url); alert(t('errImage')); };
  im.src = url;
}

function loadFrameImage(kind, file) {
  readImage(file, im => {
    media.frames[kind] = im;
    if (cfg[kind]) cfg[kind].image = file.name;
    else cfg[kind] = newFrame(kind, file.name);
    onFramesChange();
    focusOn(kind);
    // показать заставку сразу: вступление с начала, концовку с её прихода
    seekPreview(kind === 'intro' ? -introLen() : sel.dur - (cfg.outro.anim === 'cut' ? 0 : +cfg.outro.animDur));
  });
}

function removeFrame(kind) {
  cfg[kind] = null;
  media.frames[kind] = null;
  if (ui.focus === kind) focusOn('image');
  onFramesChange();
}

/* общая шкала изменилась — подтянуть всё, что от неё зависит */
function onFramesChange() {
  const th = cfg.thumbnail;
  th.time = Math.min(th.time, totalLen());
  renderFrameControls();
  renderRows('intro');
  renderRows('outro');
  renderRows('thumb');
  refreshSummaries();
  renderLanes();
  drawWave();
  drawPreview();
}

/* ------------------------------------------------------------------ панель */
function fillOptions(select, ids, label) {
  if (select.children.length !== ids.length) {
    select.innerHTML = '';
    ids.forEach(id => {
      const o = document.createElement('option');
      o.value = id;
      select.appendChild(o);
    });
  }
  [...select.children].forEach((o, i) => { o.textContent = label(ids[i]); });
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function renderFrameControls() {
  ['intro', 'outro'].forEach(kind => {
    const f = cfg[kind];
    const list = $(kind + 'List');
    list.innerHTML = '';
    if (f) {
      const li = document.createElement('div');
      li.className = 'layer' + (ui.focus === kind ? ' layer--on' : '');
      li.innerHTML = '<span class="layer__name"></span><span class="layer__range"></span>' +
                     '<button type="button" class="layer__del">×</button>';
      li.querySelector('.layer__name').textContent = f.image;
      li.querySelector('.layer__range').textContent = (+f.duration).toFixed(1) + ' ' + t('sec');
      li.onclick = () => {
        focusOn(kind);
        renderFrameControls();
        seekPreview(kind === 'intro' ? -introLen() : sel.dur);
      };
      li.querySelector('.layer__del').onclick = e => { e.stopPropagation(); removeFrame(kind); };
      list.appendChild(li);
    } else {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'layer__add';
      add.textContent = t(kind === 'intro' ? 'addIntro' : 'addOutro');
      add.onclick = () => pickFile('image/*', file => loadFrameImage(kind, file));
      list.appendChild(add);
    }

    $(kind + 'Opts').hidden = !f;
    if (!f) return;
    fillOptions($(kind + 'Anim'), FRAME_ANIMS, id => t(kind + cap(id)));
    fillOptions($(kind + 'Dir'), FRAME_DIRS, id => t('dir' + cap(id)));
    $(kind + 'Anim').value = f.anim;
    $(kind + 'Dir').value = f.dir;
    $(kind + 'Dir').hidden = !(f.anim === 'slide' || f.anim === 'slidefade');
    $(kind + 'Contain').classList.toggle('btn--on', f.fit === 'contain');
  });
}

function renderThumbControls() {
  const th = cfg.thumbnail;
  fillOptions($('thumbMode'), THUMB_MODES, id => t('thumb' + cap(id)));
  $('thumbMode').value = th.mode;
  $('thumbSaveRow').hidden = th.mode === 'none';
  $('thumbSave').checked = th.save;

  const list = $('thumbList');
  list.hidden = th.mode !== 'image';
  list.innerHTML = '';
  if (th.mode !== 'image') return;
  if (th.image) {
    const li = document.createElement('div');
    li.className = 'layer';
    li.innerHTML = '<span class="layer__name"></span><button type="button" class="layer__del">×</button>';
    li.querySelector('.layer__name').textContent = th.image;
    li.onclick = () => pickFile('image/*', loadThumbImage);
    li.querySelector('.layer__del').onclick = e => {
      e.stopPropagation();
      th.image = '';
      media.frames.thumb = null;
      renderThumbControls();
      refreshSummaries();
    };
    list.appendChild(li);
  } else {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'layer__add';
    add.textContent = t('thumbPick');
    add.onclick = () => pickFile('image/*', loadThumbImage);
    list.appendChild(add);
  }
}

function loadThumbImage(file) {
  readImage(file, im => {
    media.frames.thumb = im;
    cfg.thumbnail.image = file.name;
    renderThumbControls();
    refreshSummaries();
  });
}

function attachFrames() {
  ['intro', 'outro'].forEach(kind => {
    $(kind + 'Anim').onchange = () => {
      const f = cfg[kind];
      if (!f) return;
      f.anim = $(kind + 'Anim').value;
      onFramesChange();
      // показать переход: вступление — с его начала, концовку — с прихода
      seekPreview(kind === 'intro' ? 0 : sel.dur - (f.anim === 'cut' ? 0 : +f.animDur));
    };
    $(kind + 'Dir').onchange = () => {
      const f = cfg[kind];
      if (!f) return;
      f.dir = $(kind + 'Dir').value;
      seekPreview(kind === 'intro' ? 0 : sel.dur - +f.animDur);
    };
    $(kind + 'Contain').onclick = () => {
      const f = cfg[kind];
      if (!f) return;
      f.fit = f.fit === 'contain' ? 'cover' : 'contain';
      renderFrameControls();
      drawPreview();
    };
    $(kind + 'Pick').onclick = () => pickFile('image/*', file => loadFrameImage(kind, file));
  });

  $('thumbMode').onchange = () => {
    const th = cfg.thumbnail;
    th.mode = $('thumbMode').value;
    if (th.mode === 'frame') {
      th.time = Math.min(totalLen(), introLen() + Math.min(2, sel.dur / 2));
      if (!ui.playing) setAnimating(false);
      seekPreview(th.time - introLen());
    }
    renderThumbControls();
    renderRows('thumb');
    refreshSummaries();
  };
  $('thumbSave').onchange = () => { cfg.thumbnail.save = $('thumbSave').checked; };
}

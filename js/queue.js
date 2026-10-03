/* Список клипов и готовый bash-скрипт для render-clip.py. */

let queue = [];

function fullPath(name) {
  const base = ($('baseDir').value || '').replace(/\/+$/, '');
  if (!name) return name;
  if (name.startsWith('/') || !base) return name;   // абсолютный путь оставляем как есть
  return base + '/' + name;
}

function clipJSON() {
  const c = {
    image: media.imagePath || 'cover.jpg',
    audio: media.trackPath || 'track.wav',
    frame: [cfg.frame.w, cfg.frame.h],
    start: +sel.start.toFixed(1),
    duration: +sel.dur.toFixed(1),
    out: $('outName').value || 'clip.mp4',
    img: {
      scale: cfg.img.scale, x: +cfg.img.x.toFixed(3), y: +cfg.img.y.toFixed(3), fit: cfg.img.fit
    },
    smooth: cfg.smooth,
    anims: cfg.anims.map(a => (a.type === 'dim'
      ? {
          type: 'dim', value: +(+a.value).toFixed(2),
          from: +(+a.from).toFixed(2), to: +(+a.to).toFixed(2),
          fadeIn: +(+a.fadeIn).toFixed(2), fadeOut: +(+a.fadeOut).toFixed(2)
        }
      : {
          type: a.type, speed: +(+a.speed).toFixed(2),
          from: +(+a.from).toFixed(2), to: +(+a.to).toFixed(2)
        }))
  };

  const texts = cfg.texts.filter(tx => tx.text.trim());
  if (texts.length) {
    c.texts = texts.map(tx => ({
      text: tx.text, x: tx.x, y: tx.y, angle: tx.angle, size: tx.size,
      color: tx.color, alpha: +(+(tx.alpha ?? 1)).toFixed(2), font: tx.font,
      from: +(+tx.from).toFixed(2), to: +(+tx.to).toFixed(2),
      fadeIn: +(+tx.fadeIn).toFixed(2), fadeOut: +(+tx.fadeOut).toFixed(2)
    }));
  }

  ['intro', 'outro'].forEach(k => {
    const f = cfg[k];
    if (!f) return;
    c[k] = {
      image: f.image, duration: +(+f.duration).toFixed(2), fit: f.fit,
      anim: f.anim, dir: f.dir, animDur: +(+f.animDur).toFixed(2),
      audioFade: +(+f.audioFade).toFixed(2)
    };
  });

  const th = cfg.thumbnail;
  if (th.mode === 'frame') c.thumbnail = { mode: 'frame', time: +(+th.time).toFixed(2), save: !!th.save };
  else if (th.mode === 'image' && th.image) c.thumbnail = { mode: 'image', image: th.image, save: !!th.save };

  if (cfg.wave.on) {
    c.wave = {
      on: true, type: cfg.wave.type, freq: cfg.wave.freq,
      x: +cfg.wave.x.toFixed(3), y: cfg.wave.y, w: cfg.wave.w, h: cfg.wave.h,
      color: cfg.wave.color, alpha: cfg.wave.alpha
    };
    if (cfg.wave.outline.on) {
      c.wave.outline = { on: true, color: cfg.wave.outline.color, size: cfg.wave.outline.size };
    }
  }
  return c;
}

/* Пути собираются здесь, поэтому правка каталога чинит и уже отложенные клипы. */
function scriptText() {
  const renderer = $('renderer').value || './render-clip.py';
  const list = queue.length ? queue : [clipJSON()];
  return '#!/usr/bin/env bash\nset -e\n\n' + list.map(c => {
    const r = Object.assign({}, c, {
      image: fullPath(c.image), audio: fullPath(c.audio), out: fullPath(c.out)
    });
    ['intro', 'outro', 'thumbnail'].forEach(k => {
      if (r[k] && r[k].image) r[k] = Object.assign({}, r[k], { image: fullPath(r[k].image) });
    });
    return renderer + " <<'JSON'\n" + JSON.stringify(r, null, 2) + '\nJSON\n';
  }).join('\n');
}

function clipSummary(c) {
  const mv = c.anims.filter(a => a.type !== 'dim');
  const bits = [mv.length
    ? mv.map(a => t('anim' + a.type.charAt(0).toUpperCase() + a.type.slice(1))).join(' → ')
    : t('animNone')];
  if (c.anims.some(a => a.type === 'dim')) bits.push(t('animDim'));
  if (c.wave) bits.push(t(WAVE_TYPES.find(w => w.id === c.wave.type).key));
  if (c.texts) bits.push(t('blockText') + ' ×' + c.texts.length);
  if (c.intro) bits.push(t('sumIntro'));
  if (c.outro) bits.push(t('sumOutro'));
  if (c.thumbnail) bits.push(t('sumThumb'));
  return bits.join(', ');
}

function renderQueue() {
  const host = $('queue');
  host.innerHTML = '';
  queue.forEach((c, i) => {
    const li = document.createElement('div');
    li.className = 'queue__item';
    li.innerHTML = '<span class="queue__num"></span><span class="queue__name"></span>' +
                   '<span class="queue__meta"></span><button type="button" class="queue__del">×</button>';
    li.querySelector('.queue__num').textContent = String(i + 1).padStart(2, '0');
    li.querySelector('.queue__name').textContent = c.out;
    li.querySelector('.queue__meta').textContent = c.start + ' / ' + c.duration + ' ' + t('sec');
    li.title = clipSummary(c);
    li.querySelector('.queue__del').onclick = () => { queue.splice(i, 1); renderQueue(); };
    host.appendChild(li);
  });

  if (!queue.length) {
    const empty = document.createElement('div');
    empty.className = 'queue__empty';
    empty.textContent = t('queueEmpty');
    host.appendChild(empty);
  }
  if (!$('modal').hidden) $('scriptText').textContent = scriptText();
}

function addToQueue() {
  const stop = [], note = [];
  if (!media.trackPath) stop.push(t('warnNoTrack'));
  else if (!media.audioBuf) note.push(t('warnTrackNotLoaded'));
  if (!media.imagePath) stop.push(t('warnNoImage'));
  else if (!media.img) note.push(t('warnImageNotLoaded'));
  if ((cfg.intro && !media.frames.intro) || (cfg.outro && !media.frames.outro)) note.push(t('warnFrameNotLoaded'));
  if (cfg.thumbnail.mode === 'image' && !cfg.thumbnail.image) note.push(t('warnNoThumbImage'));

  const warn = $('addWarn');
  if (stop.length) {
    warn.textContent = t('warnNotAdded', { list: stop.join(', ') });
    warn.hidden = false;
    return;
  }
  warn.hidden = !note.length;
  warn.textContent = note.join('; ');

  queue.push(clipJSON());
  $('outName').value = 'clip' + String(queue.length + 1).padStart(2, '0') + '.mp4';
  renderQueue();
  refreshSummaries();
}

async function copyScript(btn) {
  const text = scriptText();
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const was = btn.textContent;
  btn.textContent = t('copied');
  setTimeout(() => { btn.textContent = was; }, 1400);
}

function openScript(open) {
  $('modal').hidden = !open;
  if (open) $('scriptText').textContent = scriptText();
}

function attachQueue() {
  $('addQueue').onclick = addToQueue;
  $('copyScript').onclick = () => copyScript($('copyScript'));
  $('copyScript2').onclick = () => copyScript($('copyScript2'));
  $('showScript').onclick = () => openScript(true);
  $('scriptBtn').onclick = () => openScript($('modal').hidden);
  $('closeModal').onclick = () => openScript(false);
  $('modal').onclick = e => { if (e.target === $('modal')) openScript(false); };
  $('outName').oninput = refreshSummaries;
  $('baseDir').oninput = () => { saveUi(); renderQueue(); };
  $('renderer').oninput = () => { saveUi(); renderQueue(); };
}

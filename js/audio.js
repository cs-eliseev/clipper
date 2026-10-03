/* Трек: чтение файла, пики для дорожки, прослушивание.

   Кнопка ▶ — транспорт: звук и превью идут по одним часам AudioContext,
   по концу общей шкалы всё начинается заново, стоп ставит превью на паузу. */

let actx = null;
let srcNode = null;
let playFrom = 0;                    // время AudioContext, соответствующее нулю общей шкалы

function pickFile(accept, cb) {
  const i = document.createElement('input');
  i.type = 'file';
  i.accept = accept;
  i.onchange = e => e.target.files[0] && cb(e.target.files[0]);
  i.click();
}

function fmtTime(s) {
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

async function loadAudio(file) {
  stopPlay();
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    media.audioBuf = await actx.decodeAudioData(await file.arrayBuffer());
  } catch (err) {
    alert(t('errAudio', { msg: err.message }));
    return;
  }
  media.trackName = file.name;
  if (!media.trackPath || media.trackPath === media.trackPathAuto) media.trackPath = file.name;
  media.trackPathAuto = file.name;
  computePeaks();
  clampSel();
  onTrackLoaded();
}

function loadImage(file) {
  const url = URL.createObjectURL(file);
  const im = new Image();
  im.onload = () => {
    URL.revokeObjectURL(url);
    media.img = im;
    media.imageName = file.name;
    if (!media.imagePath || media.imagePath === media.imagePathAuto) media.imagePath = file.name;
    media.imagePathAuto = file.name;
    onImageLoaded();
  };
  im.onerror = () => { URL.revokeObjectURL(url); alert(t('errImage')); };
  im.src = url;
}

/* 1600 огибающих точек — этого хватает дорожке любой ширины */
function computePeaks() {
  const N = 1600;
  const ch = media.audioBuf.getChannelData(0);
  const step = Math.max(1, Math.floor(ch.length / N));
  const peaks = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let m = 0;
    const a = i * step;
    const b = Math.min(a + step, ch.length);
    for (let j = a; j < b; j++) { const v = Math.abs(ch[j]); if (v > m) m = v; }
    peaks[i] = m;
  }
  media.peaks = peaks;
}

function clampSel() {
  if (!media.audioBuf) {
    sel.dur = clamp(sel.dur, MIN_DUR, MAX_DUR);
    sel.start = Math.max(0, sel.start);
    return;
  }
  sel.dur = clamp(sel.dur, MIN_DUR, Math.min(MAX_DUR, media.audioBuf.duration));
  sel.start = clamp(sel.start, 0, media.audioBuf.duration - sel.dur);
}

function killSource() {
  if (!srcNode) return;
  try { srcNode.stop(); } catch (err) { /* уже остановлен */ }
  srcNode = null;
}

/* Запустить звук с секунды at общей шкалы. Под вступлением звучат секунды
   трека до отрезка; если трек начинается позже — сначала тишина, источник
   стартует с задержкой. Конец шкалы ловит цикл превью, не источник:
   трек может кончиться раньше концовки. */
function startSource(at) {
  killSource();
  const trackAt = sel.start - introLen() + at;      // позиция в треке
  const wait = Math.max(0, -trackAt);
  const len = totalLen() - at - wait;
  playFrom = actx.currentTime - at;
  if (len <= 0.02 || trackAt >= media.audioBuf.duration) return;
  srcNode = actx.createBufferSource();
  srcNode.buffer = media.audioBuf;
  srcNode.connect(actx.destination);
  srcNode.start(actx.currentTime + wait, Math.max(0, trackAt), len);
}

function stopPlay() {
  if (!ui.playing) return;
  killSource();
  ui.playing = false;
  // превью остаётся там, где остановился звук
  seekPreview(clamp(actx.currentTime - playFrom, 0, totalLen()) - introLen());
  setAnimating(false);
  onPlayState();
}

function togglePlay() {
  // без трека транспорт гоняет превью без звука: пауза и пуск с того же места
  if (!media.audioBuf) { setAnimating(!ui.animating); onPlayState(); return; }
  if (ui.playing) { stopPlay(); return; }
  if (actx.state === 'suspended') actx.resume();
  // из паузы — с того же места, из холостого цикла — с начала
  const at = ui.animating ? 0 : clamp(ui.animT + introLen(), 0, totalLen());
  ui.playing = true;
  startSource(at);
  ui.animT = at - introLen();
  setAnimating(true);
  onPlayState();
}

/* позиция воспроизведения по общей шкале, 0..total */
function playPos() {
  if (!ui.playing || !actx) return null;
  return clamp(actx.currentTime - playFrom, 0, totalLen());
}

/* один шаг часов воспроизведения: конец шкалы — начать заново */
function playTick() {
  const at = actx.currentTime - playFrom;
  if (at >= totalLen()) { startSource(0); ui.animT = -introLen(); return; }
  ui.animT = at - introLen();
}

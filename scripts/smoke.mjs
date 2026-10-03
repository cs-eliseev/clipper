/* Прогон приложения в настоящем браузере: разметка, обработчики, чтение трека,
   отрисовка кадра и сборка скрипта.
 *
 *   node scripts/smoke.mjs
 *
 * Модульные тесты (npm test) закрывают логику; здесь проверяется, что она
 * действительно подключена к странице. Браузер запускается headless и ищется
 * среди chromium/chrome; если его нет — прогон пропускается с явным сообщением. */

import { spawn, execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 9334;
const BROWSERS = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];

function findBrowser() {
  for (const name of BROWSERS) {
    try {
      return execSync(`command -v ${name}`, { encoding: 'utf8' }).trim();
    } catch (error) {
      /* пробуем следующий */
    }
  }
  return null;
}

/* Сценарий выполняется внутри страницы. Возвращает список проверок:
   каждая — [название, прошла ли, что получилось]. */
const SCENARIO = `(async () => {
  const $ = id => document.getElementById(id);
  const checks = [];
  const check = (name, ok, detail) => checks.push([name, !!ok, detail === undefined ? '' : String(detail)]);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const drop = (node, file) => {
    const data = new DataTransfer();
    data.items.add(file);
    node.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true }));
  };

  localStorage.clear();

  check('страница собралась', !!$('app') && !!$('track') && !!$('panelBody'));

  // без трека ▶ — пуск и пауза превью, никаких диалогов
  check('превью на старте стоит', !ui.animating && $('play').textContent === '▶');
  $('play').click();
  check('без трека play запускает превью', ui.animating && $('play').textContent === '▮▮');
  $('play').click();
  check('без трека play ставит превью на паузу', !ui.animating);
  check('раскладки объявлены', $('variants').children.length === 3, $('variants').children.length);
  check('форматы кадра объявлены', $('formats').children.length > 0, $('formats').children.length);

  // трек: настоящий wav, чтобы прошло декодирование и построились пики
  const rate = 8000, seconds = 30, samples = rate * seconds;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const put = (at, text) => [...text].forEach((letter, i) => view.setUint8(at + i, letter.charCodeAt(0)));
  put(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); put(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  put(36, 'data'); view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i / 18) * 12000, true);
  drop($('waveBox'), new File([buffer], 'track.wav', { type: 'audio/wav' }));
  await wait(900);
  check('трек прочитан', $('trackName').textContent === 'track.wav', $('trackName').textContent);
  check('длительность показана', $('trackTotal').textContent.includes(':'), $('trackTotal').textContent);
  check('волна нарисована', $('wave').width > 100, $('wave').width);

  // обложка
  const source = document.createElement('canvas');
  source.width = 1400; source.height = 1400;
  const paint = source.getContext('2d');
  paint.fillStyle = '#7a4f2a'; paint.fillRect(0, 0, 1400, 1400);
  const cover = await new Promise(r => source.toBlob(r, 'image/png'));
  drop($('frame'), new File([cover], 'cover.png', { type: 'image/png' }));
  await wait(400);
  check('обложка загрузилась', $('imageName').textContent === 'cover.png', $('imageName').textContent);
  check('кадр нарисован', $('pv').getContext('2d').getImageData(5, 5, 1, 1).data[3] === 255);
  $('imgContain').click();
  $('imgFit').click();
  check('«вписать в кадр» снимает режим с полями', cfg.img.fit === 'cover' && !$('imgContain').classList.contains('btn--on'));
  // квадратная обложка в вертикальном кадре: при 1× её можно сдвинуть по горизонтали
  {
    const r = $('pv').getBoundingClientRect();
    const at = (type, x) => $('pv').dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + r.height / 2, pointerId: 3, bubbles: true }));
    try { at('pointerdown', r.width / 2); } catch (err) { /* синтетический указатель не захватить */ }
    at('pointermove', r.width / 2 + 30);
    at('pointerup', r.width / 2 + 30);
    check('картинка сдвигается при 1× в запасе пропорций', cfg.img.x < 0.5 && cfg.img.x > 0, cfg.img.x.toFixed(2));
    cfg.img.x = 0.5;
  }

  // отрезок
  $('segLen').value = '10';
  $('segLen').dispatchEvent(new Event('input'));
  check('длина отрезка принята', $('segLen').value.startsWith('10'), $('segLen').value);
  $('segLen').value = '999';
  $('segLen').dispatchEvent(new Event('input'));
  check('отрезок не длиннее трека', parseFloat($('segLen').value) <= seconds, $('segLen').value);
  $('segLen').value = '10';
  $('segLen').dispatchEvent(new Event('input'));

  // формат кадра
  document.querySelectorAll('#formats .seg__btn')[2].click();
  check('формат кадра сменился', $('fh').value === '1350', $('fw').value + '×' + $('fh').value);
  document.querySelectorAll('#formats .seg__btn')[0].click();

  // раскладки: дорожка переезжает между слотами
  const slots = [];
  ['b', 'c', 'a'].forEach(id => {
    document.querySelector('[data-variant="' + id + '"]').click();
    const parent = $('track').parentElement;
    slots.push(id + ':' + (parent.id || parent.dataset.slot));
  });
  check('дорожка переезжает по раскладкам',
        slots.join(' ') === 'b:slotBottom c:track a:slotTop', slots.join(' '));

  // слои
  document.querySelector('[data-block="wave"] .block__head').click();
  $('waveOn').click();
  check('полоса волны включилась', $('waveOn').classList.contains('btn--on'));
  document.querySelector('[data-block="text"] .block__head').click();
  document.querySelector('#textList .layer__add').click();
  $('textValue').value = 'проба';
  $('textValue').dispatchEvent(new Event('input'));
  check('надпись добавилась', document.querySelectorAll('#textList .layer').length === 1);
  document.querySelector('[data-block="anim"] .block__head').click();
  document.querySelector('#animList .layer__add').click();
  check('движение добавилось', document.querySelectorAll('#animList .layer').length === 1);
  check('дорожки слоёв показаны', document.querySelectorAll('.track__clip').length >= 3,
        document.querySelectorAll('.track__clip').length);
  check('шкала секунд нарисована', document.querySelectorAll('.track__tick-label').length >= 3,
        document.querySelectorAll('.track__tick-label').length);
  check('головка видна и без звука', document.querySelectorAll('.track__head:not([hidden])').length >= 3,
        document.querySelectorAll('.track__head').length);

  // число у ползунка — поле ввода: набрать, Enter
  const sizeBox = document.querySelector('[data-rows="text"] .field__value');
  sizeBox.value = '77'; sizeBox.dispatchEvent(new Event('change'));
  check('значение ползунка принято с клавиатуры', cfg.texts[0].size === 77, cfg.texts[0].size);
  sizeBox.value = '9999'; sizeBox.dispatchEvent(new Event('change'));
  check('набранное значение обрезано по максимуму', cfg.texts[0].size === 180, cfg.texts[0].size);
  check('прозрачность надписи есть среди ползунков',
        [...document.querySelectorAll('[data-rows="text"] .field__label')].some(l => /Прозрачность|Opacity/.test(l.textContent)));

  // раскрытая дорожка: по строке на каждое движение
  document.querySelector('#animList .layer__add').click();
  const laneBtn = [...document.querySelectorAll('.track__lane-name--btn')].find(b => /анимация|motion/.test(b.textContent));
  const rowsBefore = document.querySelectorAll('.track__lane').length;
  laneBtn.click();
  check('дорожка анимации раскрылась', document.querySelectorAll('.track__lane').length === rowsBefore + 1,
        document.querySelectorAll('.track__lane').length + ' из ' + rowsBefore);
  document.querySelector('.track__lane-name--btn').click();

  // головку на дорожке можно тащить — это перемотка
  {
    const laneBox = document.querySelector('.track__lane-box');
    const lr = laneBox.getBoundingClientRect();
    const at = (type, share) => laneBox.dispatchEvent(new PointerEvent(type, { clientX: lr.left + lr.width * share, clientY: lr.top + 5, pointerId: 9, bubbles: true }));
    at('pointerdown', 0.2); at('pointermove', 0.6); at('pointerup', 0.6);
    check('головка перетащена по дорожке', Math.abs((ui.animT + introLen()) / totalLen() - 0.6) < 0.05,
          ((ui.animT + introLen()) / totalLen()).toFixed(2));
  }

  // панорама вправо при 1×: квадратная обложка едет по запасу пропорций, масштаб не трогается
  cfg.img.scale = 1; cfg.img.x = 0.5;
  $('animType').value = 'panright'; $('animType').dispatchEvent(new Event('change'));
  check('панорама не поднимает масштаб', cfg.img.scale === 1, cfg.img.scale);
  {
    const a = cfg.anims[ui.animIdx]; a.from = 0; a.to = sel.dur;
    const at = tt => { ui.animT = tt; return imageLayout(animState()).wx; };
    const w0 = at(0), w1 = at(sel.dur);
    check('панорама вправо при 1× двигает картинку', w1 > w0 + 5, w0.toFixed(1) + ' → ' + w1.toFixed(1));
    cfg.img.x = 1;
    renderRows('anim');
    check('упёртая в край картинка помечена в подсказке', document.querySelector('[data-hint="anim"]').textContent.includes('⚠'));
    cfg.img.x = 0.5;
  }

  // заставки и миниатюра: файл кладётся напрямую — системный диалог из скрипта не открыть
  document.querySelector('[data-block="frames"] .block__head').click();
  loadFrameImage('intro', new File([cover], 'title.png', { type: 'image/png' }));
  loadFrameImage('outro', new File([cover], 'credits.png', { type: 'image/png' }));
  await wait(400);
  check('заставки добавились', document.querySelectorAll('#introList .layer, #outroList .layer').length === 2);
  check('шкала стала длиннее отрезка', $('time').textContent.includes('15.0'), $('time').textContent);
  check('дорожка кадров показана', document.querySelectorAll('.track__clip--frame').length === 2,
        document.querySelectorAll('.track__clip--frame').length);
  $('introAnim').value = 'slide'; $('introAnim').dispatchEvent(new Event('change'));
  check('направление появилось для сдвига', !$('introDir').hidden);
  check('вступление видно на превью', coveringFrame() === 'intro', ui.animT.toFixed(2));
  $('thumbMode').value = 'frame'; $('thumbMode').dispatchEvent(new Event('change'));
  check('ползунок кадра миниатюры появился', document.querySelectorAll('[data-rows="thumb"] .field__range').length === 1);
  check('превью остановилось на кадре', ui.animating === false);

  // транспорт: ▶ запускает звук и превью по одним часам, стоп ставит превью на паузу
  $('play').click();
  await wait(300);
  check('play включил звук и анимацию', ui.playing && ui.animating && playPos() !== null);
  $('play').click();
  check('стоп остановил и звук, и превью', !ui.playing && !ui.animating);

  // бегунок под кадром: перемотка на половину общей шкалы
  const box = $('scrub').getBoundingClientRect();
  const ptr = (type, x) => $('scrub').dispatchEvent(new PointerEvent(type, { clientX: x, clientY: box.top + 5, pointerId: 7, bubbles: true }));
  ptr('pointerdown', box.left + box.width / 2);
  ptr('pointerup', box.left + box.width / 2);
  check('бегунок перемотал превью', Math.abs(ui.animT + introLen() - totalLen() / 2) < 0.5,
        (ui.animT + introLen()).toFixed(1) + ' из ' + totalLen().toFixed(1));

  // скрипт
  $('baseDir').value = '/home/user/music';
  $('baseDir').dispatchEvent(new Event('input'));
  $('scriptBtn').click();
  const script = $('scriptText').textContent;
  check('скрипт собран', script.startsWith('#!/usr/bin/env bash'));
  check('в скрипте есть размер кадра', script.includes('"frame"'));
  check('пути собраны из каталога', script.includes('/home/user/music/cover.png'));
  check('надпись попала в описание', script.includes('проба'));
  check('прозрачность надписи попала в описание', script.includes('"alpha": 1'));
  check('заставки попали в описание', script.includes('"intro"') && script.includes('/home/user/music/credits.png'));
  check('миниатюра попала в описание', script.includes('"thumbnail"'));
  $('closeModal').click();

  // язык и тема
  $('prefsBtn').click();
  $('langSelect').value = 'en'; $('langSelect').dispatchEvent(new Event('change'));
  check('язык переключился', document.querySelector('.head__title').textContent === 'Clipper',
        document.querySelector('.head__title').textContent);
  $('themeSelect').value = 'light'; $('themeSelect').dispatchEvent(new Event('change'));
  await wait(400);
  const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  check('тема переключилась', background !== '#0c0c0e', background);

  check('состояние сохранено', Object.keys(localStorage).length >= 2,
        Object.keys(localStorage).sort().join(', '));

  return checks;
})()`;

const browser = findBrowser();
if (!browser) {
  console.log('браузер не найден (' + BROWSERS.join(', ') + ') — прогон пропущен');
  process.exit(0);
}

const profile = mkdtempSync(join(tmpdir(), 'clipper-smoke-'));
const child = spawn(browser, [
  '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required',
  '--window-size=1440,900', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  'about:blank'
], { stdio: 'ignore' });

const stop = code => {
  child.kill();
  /* профиль браузера может ещё дописываться — уборка не влияет на итог */
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    /* временный каталог подчистит система */
  }
  process.exit(code);
};

async function connect() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return;
    } catch (error) {
      /* ещё не поднялся */
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('браузер не открыл порт отладки');
}

try {
  await connect();
  const url = pathToFileURL(join(ROOT, 'index.html')).href;
  const target = await (await fetch(
    `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' }
  )).json();

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const failures = [];
  let id = 0;

  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    if (message.method === 'Runtime.exceptionThrown') {
      failures.push('ошибка на странице: ' +
        (message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text));
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      failures.push('console.error: ' + message.params.args.map(a => a.value ?? a.description).join(' '));
    }
  });

  const send = (method, params = {}) => new Promise(resolve => {
    const message_id = ++id;
    pending.set(message_id, resolve);
    socket.send(JSON.stringify({ id: message_id, method, params }));
  });

  await new Promise(resolve => socket.addEventListener('open', resolve));
  await send('Runtime.enable');
  await send('Page.enable');
  await new Promise(resolve => setTimeout(resolve, 1200));

  const result = await send('Runtime.evaluate', {
    expression: SCENARIO, awaitPromise: true, returnByValue: true
  });

  if (result.result?.exceptionDetails) {
    failures.push('сценарий упал: ' + (result.result.exceptionDetails.exception?.description || ''));
  }

  const checks = result.result?.result?.value || [];
  for (const [name, ok, detail] of checks) {
    console.log(`${ok ? '  ok' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
    if (!ok) failures.push(name);
  }

  console.log(`\nпроверок: ${checks.length}, не прошло: ${failures.length}`);
  failures.forEach(line => console.log('  ' + line));
  stop(failures.length ? 1 : 0);
} catch (error) {
  console.error('прогон не удался:', error.message);
  stop(1);
}

/* Пипетка: квадрат насыщенности, полоса тона, поле hex.
   Работает с любым .swatch[data-color] — куда класть значение,
   решает COLOR_TARGETS. */

const COLOR_TARGETS = {
  wave: {
    get: () => cfg.wave.color,
    set: v => { cfg.wave.color = v; }
  },
  outline: {
    get: () => cfg.wave.outline.color,
    set: v => { cfg.wave.outline.color = v; }
  },
  text: {
    get: () => (activeText() ? activeText().color : '#ffffff'),
    set: v => { if (activeText()) activeText().color = v; }
  }
};

function attachColorPicker() {
  const pop = $('cpop'), sv = $('cSV'), hue = $('cHue'), hex = $('cHex');
  const svc = sv.getContext('2d'), huec = hue.getContext('2d');
  let target = null, H = 0, S = 1, V = 1;

  function hsv2rgb(h, s, v) {
    const i = Math.floor(h / 60) % 6, f = h / 60 - Math.floor(h / 60);
    const p = v * (1 - s), q = v * (1 - f * s), tt = v * (1 - (1 - f) * s);
    const r = [v, q, p, p, tt, v][i], g = [tt, v, v, q, p, p][i], b = [p, p, tt, v, v, q][i];
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) {
      if (mx === r) h = 60 * (((g - b) / d) % 6);
      else if (mx === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    return [(h + 360) % 360, mx ? d / mx : 0, mx];
  }
  const toHex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  const current = () => { const [r, g, b] = hsv2rgb(H, S, V); return toHex(r, g, b); };

  function drawHue() {
    const g = huec.createLinearGradient(0, 0, hue.width, 0);
    for (let i = 0; i <= 6; i++) {
      const [r, gg, b] = hsv2rgb(i * 60, 1, 1);
      g.addColorStop(i / 6, 'rgb(' + r + ',' + gg + ',' + b + ')');
    }
    huec.fillStyle = g;
    huec.fillRect(0, 0, hue.width, hue.height);
    const x = H / 360 * hue.width;
    huec.strokeStyle = '#fff';
    huec.lineWidth = 2;
    huec.strokeRect(x - 2, 0, 4, hue.height);
  }
  function drawSV() {
    const [r, g, b] = hsv2rgb(H, 1, 1);
    svc.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
    svc.fillRect(0, 0, sv.width, sv.height);
    let gr = svc.createLinearGradient(0, 0, sv.width, 0);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    svc.fillStyle = gr;
    svc.fillRect(0, 0, sv.width, sv.height);
    gr = svc.createLinearGradient(0, 0, 0, sv.height);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,1)');
    svc.fillStyle = gr;
    svc.fillRect(0, 0, sv.width, sv.height);
    const x = S * sv.width, y = (1 - V) * sv.height;
    svc.strokeStyle = V > 0.6 && S < 0.5 ? '#000' : '#fff';
    svc.lineWidth = 2;
    svc.beginPath();
    svc.arc(x, y, 6, 0, 7);
    svc.stroke();
  }
  function push() {
    const c = current();
    hex.value = c;
    if (!target) return;
    COLOR_TARGETS[target].set(c);
    renderSwatch(target, c);
    drawPreview();
  }
  function setFromHex(c) {
    if (!/^#[0-9a-f]{6}$/i.test(c)) return false;
    const n = parseInt(c.slice(1), 16);
    [H, S, V] = rgb2hsv((n >> 16) & 255, (n >> 8) & 255, n & 255);
    drawHue();
    drawSV();
    return true;
  }

  let sdrag = false, hdrag = false;
  const svPos = e => {
    const r = sv.getBoundingClientRect();
    S = clamp((e.clientX - r.left) / r.width, 0, 1);
    V = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
    drawSV();
    push();
  };
  const huePos = e => {
    const r = hue.getBoundingClientRect();
    H = clamp((e.clientX - r.left) / r.width * 360, 0, 359.9);
    drawHue();
    drawSV();
    push();
  };

  sv.addEventListener('pointerdown', e => { sdrag = true; sv.setPointerCapture(e.pointerId); svPos(e); });
  sv.addEventListener('pointermove', e => sdrag && svPos(e));
  hue.addEventListener('pointerdown', e => { hdrag = true; hue.setPointerCapture(e.pointerId); huePos(e); });
  hue.addEventListener('pointermove', e => hdrag && huePos(e));
  ['pointerup', 'pointercancel'].forEach(ev => {
    sv.addEventListener(ev, () => { sdrag = false; });
    hue.addEventListener(ev, () => { hdrag = false; });
  });
  hex.oninput = () => { if (setFromHex(hex.value.trim())) push(); };

  document.addEventListener('click', e => {
    const box = e.target.closest('.swatch');
    if (box) {
      target = box.dataset.color;
      setFromHex(COLOR_TARGETS[target].get() || '#ffffff');
      hex.value = current();
      const r = box.getBoundingClientRect();
      pop.hidden = false;
      pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6) + 'px';
      pop.style.left = Math.min(window.innerWidth - pop.offsetWidth - 8, r.left) + 'px';
      return;
    }
    if (!e.target.closest('.cpop')) pop.hidden = true;
  });
}

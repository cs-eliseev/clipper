#!/usr/bin/env python3
"""
Рендер клипа по JSON-описанию кадра. По умолчанию 1080x1920.

    ./render-clip.py clip.json
    ./render-clip.py < clip.json
    ./render-clip.py --print-cmd clip.json     # показать команду ffmpeg, не запуская

Описание кадра (обязательны только image, audio и out):

{
  "image": "cover.jpg",
  "audio": "track.wav",
  "start": 45.0,                  с какой секунды трека берётся отрывок
  "duration": 15.0,
  "out": "clip01.mp4",
  "frame": [1080, 1920],          размер кадра; по умолчанию 1080x1920


  "img": {"scale": 1.0, "x": 0.5, "y": 0.5, "fit": "cover"},
      scale — приближение (1.0 = картинка вписана в кадр)
      x, y  — положение окна, 0..1: по запасу от разницы пропорций и масштаба
      fit   — cover (заполнить кадр, края обрезаются) или contain (целиком, с полями)

  "anims": [                      несколько движений подряд
      {"type": "zoomin",   "speed": 1.0, "from": 0,  "to": 6},
      {"type": "panright", "speed": 1.0, "from": 6,  "to": 15}
  ],
      type: none | zoomin | zoomout | panleft | panright | panup | pandown
      Зум, горизонталь и вертикаль — независимые дорожки, поэтому наезд и
      панорама могут идти одновременно. Движения по одной оси выстраиваются
      последовательно: следующее продолжается с того места, где закончилось
      предыдущее; в промежутках значение держится.

      Затемнение задаётся там же, отдельной записью:
      {"type": "dim", "value": 0.45, "from": 2, "to": 10,
       "fadeIn": 0.5, "fadeOut": 0.5}
      Их может быть несколько, они накладываются друг на друга.

  "smooth": 3,                    плавность движения: 1 быстро, 3 плавно (по умолчанию 3).
                                  Крупнее исходник — мельче шаг zoompan, но дольше рендер

  "dim": 0.45,                    старый формат затемнения, поддерживается

  "wave": {"on": true, "type": "wave-cline", "freq": 0.5,
           "x": 0.5, "y": 1620, "w": 1080, "h": 240,
           "color": "#ffffff", "alpha": 0.85,
           "outline": {"on": true, "color": "#000000", "size": 2}},
      type: wave-cline | wave-line | wave-point | wave-p2p
            freq-bar | freq-line | freq-dot
            vector | cqt | histogram
      freq — «частота»: для осциллограмм плотность развёртки,
             для спектра ширина окна анализа, 0..1

  "texts": [
      {"text": "первая строка|вторая", "x": 540, "y": 960, "angle": -4,
       "size": 64, "color": "#ffffff", "alpha": 1.0, "font": "/путь/шрифт.ttf",
       "from": 0, "to": 15, "fadeIn": 0.6, "fadeOut": 0.6}
  ],

  "intro": {"image": "title.png", "duration": 2.0, "fit": "cover",
            "anim": "slide", "dir": "left", "animDur": 0.6, "audioFade": 0.5},
  "outro": {"image": "credits.png", "duration": 3.0, "fit": "cover",
            "anim": "fade", "animDur": 0.8, "audioFade": 1.0},
      Начальный и конечный кадры — картинки до и после клипа.
      duration — сколько кадр держится; трек под ним продолжает играть:
      под вступлением звучат duration секунд ДО отрезка, под концовкой —
      столько же ПОСЛЕ. Если трек там кончается, остаётся тишина.
      anim — переход к клипу (для intro) или от клипа (для outro):
        cut        просто сменится
        fade       проявится
        slide      отъедет в сторону dir (left | right | up | down)
        slidefade  отъедет и растает
        zoom       вырастет и растает (концовка — сожмётся в кадр)
      animDur — длительность перехода; он идёт поверх клипа, сам клип не
      укорачивается. audioFade — плавный вход звука в начале (intro) и
      уход в конце (outro), секунды.

  "thumbnail": {"mode": "frame", "time": 4.5, "save": false},
  "thumbnail": {"mode": "image", "image": "poster.jpg", "save": true},
      Миниатюра для проводника — встраивается в mp4 как обложка.
      mode: none — не трогать (проводник покажет первый кадр),
            frame — кадр готового клипа на секунде time (по общей шкале,
                    вместе со вступлением), image — своё изображение,
                    подогнанное под кадр. save — ещё и положить рядом .jpg.
      Проводники читают обложку по-разному: GNOME и KDE — встроенную,
      Windows и macOS чаще берут первый кадр видео (то есть вступление).
}

Координаты текста — центр надписи в кадре (по умолчанию 1080x1920).
Переносы строк в тексте задаются символом |
"""

import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile

W, H, FPS = 1080, 1920, 30          # W и H переопределяются полем "frame"
SRC_SCALE = 1.6                      # запас исходника под наезд и панораму
MAX_SRC_W = 9000                     # потолок ширины исходника — держит память в узде
PAN_SPAN = 0.45                      # какую долю хода проходит панорама за клип
                                     # при скорости 1; меньше единицы, иначе кадр
                                     # упирается в край и заданное положение теряется


def set_frame(cfg):
    """Размер кадра из описания. Стороны округляются до чётных — этого требует h264."""
    global W, H
    fr = cfg.get("frame")
    if isinstance(fr, (list, tuple)) and len(fr) == 2:
        try:
            W, H = int(fr[0]), int(fr[1])
        except (TypeError, ValueError):
            die("поле frame должно быть парой чисел")
    W = max(64, W - W % 2)
    H = max(64, H - H % 2)


def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def clamp(v, lo, hi):
    return max(lo, min(hi, float(v)))


def esc_drawtext(s):
    s = s.replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:")
    s = s.replace("%", "\\%").replace(",", "\\,")
    return s.replace("|", "\n").replace("\n", "\\n")


def color(c, alpha=1.0):
    c = str(c).strip()
    if alpha is None or float(alpha) >= 1.0:
        return c
    return f"{c}@{float(alpha):.3f}"


# ---------------------------------------------------------------- анимация

def piecewise(points):
    """Кусочно-линейное выражение по номеру кадра on. points: [(кадр, значение)]."""
    points = [p for p in points]
    if len(points) == 1:
        return f"{points[0][1]:.5f}"
    expr = f"{points[-1][1]:.5f}"
    for i in range(len(points) - 2, -1, -1):
        f0, v0 = points[i]
        f1, v1 = points[i + 1]
        if f1 <= f0:
            continue
        seg = f"{v0:.5f}+({v1 - v0:.5f})*(on-{f0})/{f1 - f0}"
        expr = f"if(lt(on,{f1}),{seg},{expr})"
    return expr


def fit_chain(fit, w, h):
    """Подгонка картинки под w x h: cover заполняет и режет края,
    contain оставляет картинку целиком и добавляет чёрные поля."""
    if fit == "contain":
        return (f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
                f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black")
    return f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}"


def probe_size(path):
    """Размер картинки через ffprobe; None, если узнать не удалось."""
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                            "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
                           capture_output=True, text=True)
        w, h = r.stdout.strip().split("\n")[0].split(",")[:2]
        w, h = int(w), int(h)
        return (w, h) if w > 0 and h > 0 else None
    except (OSError, ValueError, IndexError):
        return None


def image_box(fit, size, sw, sh):
    """Картинка внутри окна sw x sh и холст под неё.

    Картинка вписывается по cover или contain: одна её сторона совпадает
    с окном, другая даёт запас — обрезку или поля. Холст той же пропорции,
    что кадр, вмещает и картинку, и окно в любом положении, картинка стоит
    в нём по центру. Панорама ходит по всему запасу: разница пропорций плюс
    то, что даёт масштаб. Без размера картинки считается, что она под кадр.
    Возвращает (IW, IH, CW, CH)."""
    if not size:
        return sw, sh, sw, sh
    w0, h0 = size
    k = (min if fit == "contain" else max)(sw / w0, sh / h0)
    iw, ih = w0 * k, h0 * k
    ratio = sw / sh
    cw = max(iw, ih * ratio, 2 * sw - iw, (2 * sh - ih) * ratio)
    return iw, ih, cw, cw / ratio


def build_anim(cfg, frames, dur, size=None):
    """Одно или несколько движений подряд. Всегда отдаёт кадр W x H.
    size — (ширина, высота) картинки; без него берётся из файла через ffprobe."""
    im = cfg.get("img") or {}
    if size is None and cfg.get("image") and os.path.isfile(cfg["image"]):
        size = probe_size(cfg["image"])
    scale = clamp(im.get("scale", 1.0), 1.0, 4.0)
    # Исходник рендерится в SRC_SCALE раз крупнее кадра — это запас разрешения.
    # Зум отсчитывается от него: z = 1 показывает исходник целиком, то есть
    # картинку, вписанную в кадр. Окно при этом всегда шире кадра (W*SRC_SCALE),
    # поэтому изображение остаётся резким на любом масштабе.
    z0 = scale

    segs = cfg.get("anims")
    if segs is None:                      # старый формат с одной анимацией
        a = cfg.get("anim")
        segs = [dict(a, **{"from": 0, "to": dur})] if a else []
    # пустой список — осознанный выбор: кадр стоит на месте

    # Свойства кадра независимы: зум, горизонталь и вертикаль ведут свои дорожки.
    # Поэтому наезд и панорама могут идти одновременно — они не мешают друг другу.
    AXIS = {"zoomin": "z", "zoomout": "z",
            "panright": "x", "panleft": "x",
            "pandown": "y", "panup": "y"}

    tracks = {"z": [], "x": [], "y": []}
    for a in segs:
        k = a.get("type", "none")
        if k in ("dim", "none"):
            continue
        if k not in AXIS:
            die(f"неизвестный тип анимации: {k}")
        t0 = clamp(a.get("from", 0), 0, dur)
        t1 = clamp(a.get("to", dur), 0, dur)
        if t1 - t0 < 0.05:
            continue
        tracks[AXIS[k]].append({"type": k, "speed": clamp(a.get("speed", 1.0), 0.1, 3.0),
                                "t0": t0, "t1": t1})
    for v in tracks.values():
        v.sort(key=lambda s: s["t0"])

    start_vals = {"z": z0,
                  "x": clamp(im.get("x", 0.5), 0, 1),
                  "y": clamp(im.get("y", 0.5), 0, 1)}

    def timeline(axis):
        """Ключевые точки одной дорожки: [(время, значение)]."""
        v = start_vals[axis]
        keys = [(0.0, v)]
        prev_end = 0.0
        for s in tracks[axis]:
            if s["t0"] > prev_end + 1e-6:
                keys.append((s["t0"], v))     # пауза — значение держится
            share = (s["t1"] - s["t0"]) / dur
            k = s["type"]
            if k == "zoomin":
                v = clamp(v * (1 + 0.1375 * s["speed"] * share), z0 / 2.5, z0 * 1.8)
            elif k == "zoomout":
                v = clamp(v / (1 + 0.1375 * s["speed"] * share), z0 / 2.5, z0 * 1.8)
            elif k in ("panright", "pandown"):
                v = clamp(v + PAN_SPAN * share * s["speed"], 0, 1)
            else:
                v = clamp(v - PAN_SPAN * share * s["speed"], 0, 1)
            keys.append((s["t1"], v))
            prev_end = s["t1"]
        if prev_end < dur - 1e-6:
            keys.append((dur, v))
        return [(int(round(t * FPS)), val) for t, val in keys]

    fz = piecewise(timeline("z"))
    fx = piecewise(timeline("x"))
    fy = piecewise(timeline("y"))

    # zoompan округляет координаты окна до целых пикселей исходника. При медленном
    # движении шаг получается около одного пикселя, и кадр идёт рывками. Лечится
    # укрупнением исходника: тот же кадр, но шаг становится долей выходного пикселя.
    smooth = clamp(cfg.get("smooth", 3), 1, 4)
    base_w, base_h = W * SRC_SCALE * scale, H * SRC_SCALE * scale
    _, _, cw1, _ = image_box(im.get("fit"), size, base_w, base_h)
    canvas_w = cw1 * smooth                       # холст шире окна на запас пропорций
    smooth = min(smooth, MAX_SRC_W / cw1) if canvas_w > MAX_SRC_W else smooth
    smooth = max(1.0, smooth)

    sw, sh = int(base_w * smooth), int(base_h * smooth)
    iw, ih, cw, ch = image_box(im.get("fit"), size, sw, sh)
    cw, ch = int(round(cw)), int(round(ch))
    # окно zoompan — sw x sh при z = 1; на холсте это зум cw/sw. Положение окна
    # отсчитывается от картинки, а не от холста: по краям холста только поля.
    # Запас берётся по модулю: и когда картинка шире окна (обрезка), и когда
    # уже (поля) рост x/y уводит содержимое влево/вверх — камера едет вправо/вниз.
    pad_x, pad_y = (cw - iw) / 2, (ch - ih) / 2
    fit = "decrease" if im.get("fit") == "contain" else "increase"
    win = lambda side, src: f"({side:.3f}-{src}/zoom)"
    return (f"[0:v]scale={sw}:{sh}:force_original_aspect_ratio={fit},"
            f"pad='max(iw,{cw})':'max(ih,{ch})':(ow-iw)/2:(oh-ih)/2:black,"
            f"zoompan=z='{cw / sw:.5f}*({fz})':"
            f"x='{pad_x:.3f}+{win(iw, 'iw')}/2+abs{win(iw, 'iw')}*(({fx})-0.5)':"
            f"y='{pad_y:.3f}+{win(ih, 'ih')}/2+abs{win(ih, 'ih')}*(({fy})-0.5)':"
            f"d={frames}:s={W}x{H}:fps={FPS}")


# ---------------------------------------------------------------- затемнение

def fade_chain(t0, t1, fin, fout, dur):
    """Появление и уход слоя через fade по альфе."""
    fin = max(0.01, float(fin))
    fout = max(0.01, float(fout))
    if t1 - t0 < fin + fout:
        fin = fout = max(0.01, (t1 - t0) / 2)
    out = f"fade=t=in:st={t0:.3f}:d={fin:.3f}:alpha=1"
    if t1 < dur - 0.01 or fout > 0.02:
        out += f",fade=t=out:st={max(0, t1 - fout):.3f}:d={fout:.3f}:alpha=1"
    return out


def build_dims(cfg, dur):
    """Затемнения: из списка anims (type=dim) и из старого поля dim."""
    items = [a for a in (cfg.get("anims") or []) if a.get("type") == "dim"]

    legacy = cfg.get("dim")
    if legacy is not None:
        if isinstance(legacy, (int, float)):
            legacy = {"on": float(legacy) > 0, "value": float(legacy)}
        if legacy.get("on", True):
            items.append(legacy)

    out = []
    for i, d in enumerate(items):
        val = clamp(d.get("value", 0.45), 0, 1)
        if val <= 0:
            continue
        t0 = clamp(d.get("from", 0), 0, dur)
        t1 = clamp(d.get("to", dur), 0, dur)
        if t1 <= t0:
            continue
        lbl = f"dim{i}"
        out.append((f"color=c=black@{val:.3f}:s={W}x{H}:r={FPS}:d={dur},format=yuva420p,"
                    f"{fade_chain(t0, t1, d.get('fadeIn', 0.4), d.get('fadeOut', 0.4), dur)}[{lbl}]",
                    lbl))
    return out


# ---------------------------------------------------------------- волна

WAVE_KINDS = {
    "wave-cline": ("showwaves", "cline"),
    "wave-line":  ("showwaves", "line"),
    "wave-point": ("showwaves", "point"),
    "wave-p2p":   ("showwaves", "p2p"),
    "freq-bar":   ("showfreqs", "bar"),
    "freq-line":  ("showfreqs", "line"),
    "freq-dot":   ("showfreqs", "dot"),
    "vector":     ("avectorscope", ""),
    "cqt":        ("showcqt", ""),
    "histogram":  ("ahistogram", ""),
}


def wave_filter(kind, ww, wh, col, freq):
    """Один визуализатор нужного типа.

    Частоту кадров визуализатора НЕ выравниваем фильтром fps: в связке с
    зацикленной картинкой он раздувает буфер до десятков гигабайт. overlay
    сам держит кадры при несовпадении частот, и результат остаётся 30 fps.
    """
    fam, mode = WAVE_KINDS.get(kind, WAVE_KINDS["wave-cline"])
    f = clamp(freq, 0, 1)
    if fam == "showwaves":
        rate = int(round(10 + f * 50))            # плотность развёртки
        s = f"showwaves=s={ww}x{wh}:mode={mode}:colors={col}:rate={rate}"
    elif fam == "showfreqs":
        win = 512 << int(round(f * 3))            # 512 / 1024 / 2048 / 4096
        s = f"showfreqs=s={ww}x{wh}:mode={mode}:ascale=log:colors={col}:win_size={win}"
    elif fam == "avectorscope":
        zoom = 0.6 + f * 2.4
        s = f"avectorscope=s={ww}x{wh}:rate={FPS}:zoom={zoom:.2f}:draw=line:rc=0:gc=0:bc=0"
    elif fam == "showcqt":
        count = 1 + int(round(f * 5))
        s = f"showcqt=s={ww}x{wh}:rate={FPS}:count={count}"
    else:
        s = f"ahistogram=s={ww}x{wh}:rate={FPS}"
    return s + ",format=yuva420p"


def wave_taps(cfg):
    """Сколько раз визуализатор читает звук: обводка — отдельный проход."""
    wv = cfg.get("wave") or {}
    if not wv.get("on"):
        return 0
    kind = wv.get("type", "wave-cline")
    tintable = kind.startswith(("wave-", "freq-")) or kind in ("wave", "spectrum")
    return 2 if (wv.get("outline") or {}).get("on") and tintable else 1


def build_wave(cfg, taps=None):
    """taps — метки звука для каждого прохода; по умолчанию сам трек ([1:a])."""
    wv = cfg.get("wave") or {}
    if not wv.get("on"):
        return [], []
    taps = list(taps or [])
    src = lambda: taps.pop(0) if taps else "1:a"

    kind = wv.get("type", "wave-cline")
    if kind == "wave":                     # старые имена
        kind = "wave-cline"
    elif kind == "spectrum":
        kind = "freq-bar"

    ww = int(wv.get("w", W))
    wh = int(wv.get("h", 240))
    wx = clamp(wv.get("x", 0.5), 0, 1)
    ox = int(round((W - ww) * wx))
    oy = int(wv.get("y", H - wh - 60))
    freq = clamp(wv.get("freq", 0.5), 0, 1)
    main = color(wv.get("color", "#ffffff"), wv.get("alpha", 0.85))

    outline = wv.get("outline") or {}
    filters, overlays = [], []

    # цветные визуализаторы не перекрашиваются — обводка им не положена
    tintable = kind.startswith(("wave-", "freq-"))

    if outline.get("on") and tintable:
        d = int(outline.get("size", 2))
        oc = color(outline.get("color", "#000000"), 1.0)
        filters.append(f"[{src()}]{wave_filter(kind, ww, wh, oc, freq)}[wo]")
        filters.append("[wo]split=4[wo1][wo2][wo3][wo4]")
        for i, (dx, dy) in enumerate([(-d, 0), (d, 0), (0, -d), (0, d)], 1):
            overlays.append((f"wo{i}", ox + dx, oy + dy))

    col = main if tintable else "white"
    filters.append(f"[{src()}]{wave_filter(kind, ww, wh, col, freq)}[wm]")
    overlays.append(("wm", ox, oy))
    return filters, overlays


# ---------------------------------------------------------------- текст

def build_texts(cfg, dur):
    out = []
    for i, t in enumerate(cfg.get("texts") or []):
        txt = (t.get("text") or "").strip()
        if not txt:
            continue
        font = t.get("font") or "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
        if not os.path.isfile(font):
            die(f"шрифт не найден: {font}")
        size = int(t.get("size", 64))
        col = color(t.get("color", "#ffffff"), clamp(t.get("alpha", 1.0), 0.0, 1.0))
        ang = float(t.get("angle", 0))
        x, y = float(t.get("x", W / 2)), float(t.get("y", H / 2))
        t0 = clamp(t.get("from", 0), 0, dur)
        t1 = clamp(t.get("to", dur), 0, dur)
        if t1 <= t0:
            continue
        lbl = f"t{i}"

        # надпись рисуется в центре прозрачного слоя, поворачивается вокруг центра,
        # и только потом слой сдвигается — иначе текст «уезжает по орбите»
        chain = (f"color=c=black@0:s={W}x{H}:r={FPS}:d={dur}[{lbl}bg];"
                 f"[{lbl}bg]drawtext=fontfile='{font}':text='{esc_drawtext(txt)}':"
                 f"fontcolor={col}:fontsize={size}:line_spacing={max(4, size // 4)}:"
                 f"x=(w-text_w)/2:y=(h-text_h)/2")
        if abs(ang) > 0.01:
            chain += f",rotate={ang}*PI/180:c=none:ow={W}:oh={H}"
        chain += "," + fade_chain(t0, t1, t.get("fadeIn", 0.6), t.get("fadeOut", 0.6), dur)
        chain += f"[{lbl}]"
        out.append((chain, lbl, int(round(x - W / 2)), int(round(y - H / 2))))
    return out


# ---------------------------------------------------------------- заставки

FRAME_ANIMS = ("cut", "fade", "slide", "slidefade", "zoom")
FRAME_DIRS = ("left", "right", "up", "down")
FRAME_ZOOM = 0.25                    # насколько вырастает заставка в переходе zoom


def frame_spec(cfg, kind, dur):
    """Нормализованное описание вступления (intro) или концовки (outro), либо None."""
    f = cfg.get(kind)
    if not f or not f.get("image"):
        return None
    anim = f.get("anim", "fade")
    if anim not in FRAME_ANIMS:
        die(f"неизвестный переход {kind}: {anim}")
    direction = f.get("dir", "left")
    if direction not in FRAME_DIRS:
        die(f"неизвестное направление {kind}: {direction}")
    hold = clamp(f.get("duration", 2.0), 0.1, 60)
    # переход идёт поверх клипа, поэтому не длиннее самого клипа
    trans = 0.0 if anim == "cut" else clamp(f.get("animDur", 0.6), 0.05, min(5.0, dur))
    return {"image": f["image"], "hold": hold, "trans": trans, "anim": anim,
            "dir": direction, "fit": f.get("fit", "cover"),
            "audioFade": clamp(f.get("audioFade", 0), 0, 10)}


def ease(f):
    """Плавный разгон и торможение (smoothstep) от выражения f в пределах 0..1."""
    return f"(({f})*({f})*(3-2*({f})))"


def build_frame(spec, kind, src, at):
    """Слой заставки для overlay.

    Вступление держится hold секунд с нуля, потом за trans секунд уходит,
    открывая клип. Концовка приходит поверх клипа за trans секунд до своего
    начала и держится hold секунд до конца. at — секунда общей шкалы, с
    которой слой лежит на видео. Возвращает (цепочка с меткой [kind], overlay).
    """
    hold, trans, anim, d = spec["hold"], spec["trans"], spec["anim"], spec["dir"]
    n = int(round((hold + trans) * FPS))
    zoom = anim == "zoom"
    # под зум исходник крупнее кадра, иначе zoompan шагает целыми пикселями
    sw, sh = (W * 2, H * 2) if zoom else (W, H)

    if zoom and kind == "intro":
        z = piecewise([(0, 1.0), (int(round(hold * FPS)), 1.0), (n, 1 + FRAME_ZOOM)])
    elif zoom:
        z = piecewise([(0, 1 + FRAME_ZOOM), (int(round(trans * FPS)), 1.0), (n, 1.0)])
    else:
        z = "1"

    chain = (f"[{src}]{fit_chain(spec['fit'], sw, sh)},"
             f"zoompan=z='{z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':"
             f"d={n}:s={W}x{H}:fps={FPS},format=yuva420p")
    if anim in ("fade", "slidefade", "zoom"):
        chain += (f",fade=t=out:st={hold:.3f}:d={trans:.3f}:alpha=1" if kind == "intro"
                  else f",fade=t=in:st=0:d={trans:.3f}:alpha=1")
    if at > 0:
        chain += f",setpts=PTS+{at:.3f}/TB"
    chain += f"[{kind}]"

    x, y = "0", "0"
    if anim in ("slide", "slidefade"):
        start = at + (hold if kind == "intro" else 0.0)      # начало перехода
        f = f"clip((t-{start:.3f})/{trans:.3f},0,1)"
        # доля пути за край: вступление уходит, концовка приходит
        gone = ease(f) if kind == "intro" else f"(1-{ease(f)})"
        sign = {"left": -1, "right": 1, "up": -1, "down": 1}[d]
        if kind == "outro":
            sign = -sign                  # приходит с противоположной стороны
        if d in ("left", "right"):
            x = f"{sign * W}*{gone}"
        else:
            y = f"{sign * H}*{gone}"
    return chain, f"overlay=x='{x}':y='{y}':eof_action=pass"


# ---------------------------------------------------------------- миниатюра

def thumb_spec(cfg):
    th = cfg.get("thumbnail") or {}
    mode = th.get("mode", "none")
    if mode not in ("none", "frame", "image"):
        die(f"неизвестный режим миниатюры: {mode}")
    if mode == "none":
        return None
    if mode == "image":
        if not th.get("image"):
            die("для миниатюры не указано изображение")
        if not os.path.isfile(th["image"]):
            die(f"нет файла: {th['image']}")
    return {"mode": mode, "time": float(th.get("time", 0)),
            "image": th.get("image"), "save": bool(th.get("save"))}


def thumb_cmds(spec, video, poster, total):
    """Команды, которые готовят poster (jpg): кадр из готового видео или своя картинка."""
    if spec["mode"] == "frame":
        at = clamp(spec["time"], 0, max(0.0, total - 1.0 / FPS))
        return [["ffmpeg", "-v", "error", "-ss", f"{at:.3f}", "-i", video,
                 "-frames:v", "1", "-q:v", "2", "-y", poster]]
    return [["ffmpeg", "-v", "error", "-i", spec["image"], "-vf", fit_chain("cover", W, H),
             "-frames:v", "1", "-q:v", "2", "-y", poster]]


def cover_cmd(video, poster, out):
    """Обложка вшивается без перекодирования — это секунды, не минуты."""
    return ["ffmpeg", "-v", "error", "-i", video, "-i", poster, "-map", "0", "-map", "1",
            "-c", "copy", "-disposition:v:1", "attached_pic",
            "-movflags", "+faststart", "-y", out]


# ---------------------------------------------------------------- сборка

def main():
    args = list(sys.argv[1:])
    if "--help" in args or "-h" in args:
        print(__doc__.strip())
        return
    print_only = "--print-cmd" in args
    args = [a for a in args if a != "--print-cmd"]

    raw = open(args[0], encoding="utf-8").read() if args else sys.stdin.read()
    try:
        cfg = json.loads(raw)
    except json.JSONDecodeError as e:
        die(f"не разобрать JSON: {e}")

    set_frame(cfg)

    for k in ("image", "audio", "out"):
        if not cfg.get(k):
            die(f"в описании нет поля {k}")
    for k in ("image", "audio"):
        if not os.path.isfile(cfg[k]):
            die(f"нет файла: {cfg[k]}")

    start = float(cfg.get("start", 0))
    dur = float(cfg.get("duration", 15))
    frames = int(round(dur * FPS))

    # Заставки раздвигают общую шкалу: вступление до отрезка, концовка после.
    # Слои клипа (движение, затемнение, надписи, волна) живут в своём времени
    # 0..dur, а сдвиг на вступление делается один раз, уже над готовым клипом.
    intro = frame_spec(cfg, "intro", dur)
    outro = frame_spec(cfg, "outro", dur)
    lead = intro["hold"] if intro else 0.0
    tail = outro["hold"] if outro else 0.0
    total = lead + dur + tail
    framed = bool(intro or outro)
    thumb = thumb_spec(cfg)

    # входы: 0 — обложка, 1 — трек, дальше заставки
    inputs = ["-loop", "1", "-i", cfg["image"]]
    a_ss = max(0.0, start - lead)
    a_pad = max(0.0, lead - start)          # трек начинается позже вступления — тишина
    inputs += ["-ss", str(a_ss), "-t", str(total - a_pad), "-i", cfg["audio"]]
    frame_src, n_in = {}, 2
    for kind, spec in (("intro", intro), ("outro", outro)):
        if spec:
            if not os.path.isfile(spec["image"]):
                die(f"нет файла: {spec['image']}")
            frame_src[kind] = f"{n_in}:v"
            inputs += ["-i", spec["image"]]
            n_in += 1

    # Звук. Без заставок трек идёт как есть; с ними — выравнивается по общей
    # шкале, дополняется тишиной и раздаётся визуализатору куском под клипом.
    chain = []
    taps = None
    amap = "1:a"
    if framed:
        steps = []
        if a_pad > 0:
            steps.append(f"adelay={int(round(a_pad * 1000))}:all=1")
        steps += ["apad", f"atrim=end={total:.3f}", "asetpts=PTS-STARTPTS"]
        if intro and intro["audioFade"] > 0:
            steps.append(f"afade=t=in:st=0:d={intro['audioFade']:.3f}")
        if outro and outro["audioFade"] > 0:
            fo = min(outro["audioFade"], total)
            steps.append(f"afade=t=out:st={total - fo:.3f}:d={fo:.3f}")
        n_taps = wave_taps(cfg)
        if n_taps:
            taps = [f"ws{i}" for i in range(n_taps)]
            chain.append(f"[1:a]{','.join(steps)},asplit=2[aout][awave]")
            split = f",asplit={n_taps}" + "".join(f"[{t}]" for t in taps) if n_taps > 1 else f"[{taps[0]}]"
            chain.append(f"[awave]atrim=start={lead:.3f}:end={lead + dur:.3f},"
                         f"asetpts=PTS-STARTPTS{split}")
        else:
            chain.append(f"[1:a]{','.join(steps)}[aout]")
        amap = "[aout]"

    # Основной поток бесконечен (-loop 1), его режет -t; слои поверх
    # кончаются сами, и после них картинка идёт дальше (eof_action=pass).
    chain.append(build_anim(cfg, frames, dur) + ",format=yuva420p[base]")
    cur, step = "base", 0

    for dchain, lbl in build_dims(cfg, dur):
        chain.append(dchain)
        step += 1
        chain.append(f"[{cur}][{lbl}]overlay=0:0:eof_action=pass[c{step}]")
        cur = f"c{step}"

    wfilters, woverlays = build_wave(cfg, taps)
    chain += wfilters
    for lbl, ox, oy in woverlays:
        step += 1
        chain.append(f"[{cur}][{lbl}]overlay={ox}:{oy}:eof_action=pass[c{step}]")
        cur = f"c{step}"

    for tchain, lbl, ox, oy in build_texts(cfg, dur):
        chain.append(tchain)
        step += 1
        chain.append(f"[{cur}][{lbl}]overlay={ox}:{oy}:eof_action=pass[c{step}]")
        cur = f"c{step}"

    if lead > 0:
        chain.append(f"[{cur}]tpad=start_duration={lead:.3f}:start_mode=add:color=black[held]")
        cur = "held"
    for kind, spec in (("intro", intro), ("outro", outro)):
        if not spec:
            continue
        at = 0.0 if kind == "intro" else lead + dur - spec["trans"]
        fchain, ov = build_frame(spec, kind, frame_src[kind], at)
        chain.append(fchain)
        step += 1
        chain.append(f"[{cur}][{kind}]{ov}[c{step}]")
        cur = f"c{step}"

    chain.append(f"[{cur}]format=yuv420p[v]")
    fc = ";".join(chain)

    # временный файл кладём рядом с результатом: os.replace не умеет
    # переносить между файловыми системами, а /tmp часто отдельный раздел
    out_dir = os.path.dirname(os.path.abspath(cfg["out"])) or "."
    os.makedirs(out_dir, exist_ok=True)
    tmp = tempfile.NamedTemporaryFile(dir=out_dir, prefix=".render-", suffix=".mp4", delete=False)
    tmp.close()
    cmds = [[
        "ffmpeg", "-v", "error", *inputs,
        "-filter_complex", fc, "-map", "[v]", "-map", amap,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-r", str(FPS), "-g", str(FPS), "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        "-t", str(total), "-y", tmp.name,
    ]]

    # миниатюра: отдельный кадр-постер и быстрая пересборка контейнера
    stem = tmp.name[:-4]
    poster, final = stem + ".jpg", tmp.name
    if thumb:
        final = stem + "-cover.mp4"
        cmds += thumb_cmds(thumb, tmp.name, poster, total)
        cmds.append(cover_cmd(tmp.name, poster, final))

    if print_only:
        os.unlink(tmp.name)
        for cmd in cmds:
            print(" ".join(shlex.quote(c) for c in cmd))
        return

    temps = [tmp.name, poster, final]
    for cmd in cmds:
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            for path in temps:
                if os.path.exists(path):
                    os.unlink(path)
            die("ffmpeg не справился:\n" + (r.stderr.strip() or "нет вывода"))

    if thumb:
        os.unlink(tmp.name)
        if thumb["save"]:
            shutil.move(poster, os.path.splitext(cfg["out"])[0] + ".jpg")
        else:
            os.unlink(poster)

    # переименовываем готовый файл — чтобы файловый менеджер не строил
    # миниатюру на недописанном и не кэшировал отказ
    os.replace(final, cfg["out"])
    print(f"готово: {cfg['out']}")


if __name__ == "__main__":
    main()

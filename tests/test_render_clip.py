"""Тесты рендера клипа.

Проверяется то, что дороже всего ошибиться: выражения зумпана, слои
затемнения, фильтры визуализатора, надписи и итоговая команда ffmpeg.
Сам ffmpeg не запускается — сравнивается то, что ему передаётся.

    python3 -m unittest discover -s tests -v
"""

import contextlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_renderer():
    """render-clip.py не импортируется по имени: дефис в названии."""
    path = os.path.join(ROOT, "render-clip.py")
    spec = importlib.util.spec_from_file_location("render_clip", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rc = load_renderer()


def base_cfg(**extra):
    cfg = {"image": "cover.jpg", "audio": "track.wav", "out": "clip.mp4"}
    cfg.update(extra)
    return cfg


class FrameSize(unittest.TestCase):
    def setUp(self):
        rc.W, rc.H = 1080, 1920

    def test_default_is_vertical(self):
        rc.set_frame(base_cfg())
        self.assertEqual((rc.W, rc.H), (1080, 1920))

    def test_custom_frame_applies(self):
        rc.set_frame(base_cfg(frame=[1080, 1350]))
        self.assertEqual((rc.W, rc.H), (1080, 1350))

    def test_odd_sides_become_even(self):
        """h264 не кодирует нечётные стороны."""
        rc.set_frame(base_cfg(frame=[1081, 1921]))
        self.assertEqual((rc.W % 2, rc.H % 2), (0, 0))

    def test_tiny_frame_is_lifted_to_minimum(self):
        rc.set_frame(base_cfg(frame=[2, 2]))
        self.assertGreaterEqual(min(rc.W, rc.H), 64)

    def test_broken_frame_stops_the_run(self):
        with contextlib.redirect_stderr(io.StringIO()) as captured:
            with self.assertRaises(SystemExit):
                rc.set_frame(base_cfg(frame=["широко", "высоко"]))
        self.assertIn("frame", captured.getvalue())


class Helpers(unittest.TestCase):
    def test_clamp_holds_the_range(self):
        self.assertEqual(rc.clamp(5, 0, 1), 1)
        self.assertEqual(rc.clamp(-5, 0, 1), 0)
        self.assertEqual(rc.clamp(0.4, 0, 1), 0.4)

    def test_color_without_alpha_stays_bare(self):
        self.assertEqual(rc.color("#ffffff", 1.0), "#ffffff")
        self.assertEqual(rc.color("#ffffff", None), "#ffffff")

    def test_color_with_alpha_gets_suffix(self):
        self.assertEqual(rc.color("#ffffff", 0.85), "#ffffff@0.850")

    def test_drawtext_escapes_what_breaks_the_filter(self):
        escaped = rc.esc_drawtext("а:б,в'г%д")
        for symbol in (":", ",", "'", "%"):
            self.assertNotIn(symbol, escaped.replace("\\" + symbol, ""))

    def test_pipe_becomes_line_break(self):
        self.assertIn("\\n", rc.esc_drawtext("первая|вторая"))

    def test_piecewise_single_point_is_constant(self):
        self.assertEqual(rc.piecewise([(0, 1.5)]), "1.50000")

    def test_piecewise_builds_nested_conditions(self):
        expression = rc.piecewise([(0, 1.0), (30, 1.5), (60, 2.0)])
        self.assertIn("if(lt(on,30)", expression)
        self.assertIn("if(lt(on,60)", expression)
        self.assertIn("2.00000", expression)

    def test_fade_chain_shrinks_fades_to_fit(self):
        """Проявление и затухание длиннее самого интервала — не должны налезать."""
        chain = rc.fade_chain(0, 1, 5, 5, 15)
        self.assertIn("d=0.500", chain)


class Animation(unittest.TestCase):
    def setUp(self):
        rc.W, rc.H = 1080, 1920

    def test_static_frame_has_flat_zoom(self):
        chain = rc.build_anim(base_cfg(), 450, 15)
        self.assertIn("s=1080x1920", chain)
        self.assertIn("d=450", chain)
        self.assertIn("1.00000", chain)

    def test_zoom_in_raises_the_scale(self):
        cfg = base_cfg(anims=[{"type": "zoomin", "speed": 1.0, "from": 0, "to": 15}])
        chain = rc.build_anim(cfg, 450, 15)
        self.assertIn("zoompan", chain)
        self.assertNotIn("if(lt(on,450),1.00000+(0.00000)", chain)

    def test_zoom_and_pan_run_on_separate_tracks(self):
        """Наезд и панорама по разным осям идут одновременно, не мешая друг другу."""
        cfg = base_cfg(anims=[
            {"type": "zoomin", "speed": 1.0, "from": 0, "to": 15},
            {"type": "panright", "speed": 1.0, "from": 0, "to": 15},
        ])
        chain = rc.build_anim(cfg, 450, 15)
        zoom_part = chain.split("z='")[1].split("'")[0]
        x_part = chain.split("x='")[1].split("'")[0]
        self.assertIn("if(lt(on,", zoom_part)
        self.assertIn("if(lt(on,", x_part)

    def test_contain_shrinks_and_cover_grows(self):
        self.assertIn("force_original_aspect_ratio=decrease", rc.build_anim(base_cfg(img={"fit": "contain"}), 450, 15))
        self.assertIn("force_original_aspect_ratio=increase", rc.build_anim(base_cfg(), 450, 15))

    def test_square_cover_leaves_horizontal_room(self):
        """Квадрат в вертикальном кадре при 1×: панораме есть куда идти по горизонтали."""
        iw, ih, cw, ch = rc.image_box("cover", (1000, 1000), 1728, 3072)
        self.assertEqual((round(iw), round(ih)), (3072, 3072))
        self.assertEqual((round(cw), round(ch)), (3072, 5461), "холст той же пропорции, что кадр")

    def test_contain_canvas_fits_both_edges(self):
        iw, ih, cw, ch = rc.image_box("contain", (1000, 1000), 1728, 3072)
        self.assertEqual((round(iw), round(ih)), (1728, 1728))
        self.assertGreaterEqual(ch, 2 * 3072 - 1728, "окно можно прижать и к верху, и к низу картинки")

    def test_without_size_image_matches_the_frame(self):
        self.assertEqual(rc.image_box("cover", None, 1728, 3072), (1728, 3072, 1728, 3072))

    def test_pan_uses_aspect_room_at_scale_one(self):
        cfg = base_cfg(anims=[{"type": "panright", "speed": 1.0, "from": 0, "to": 15}])
        chain = rc.build_anim(cfg, 450, 15, size=(1000, 1000))
        x_part = chain.split("x='")[1].split("'")[0]
        self.assertIn("-iw/zoom)*((", x_part, "ход считается от ширины картинки, не холста")
        self.assertIn("abs(", x_part, "запас по модулю: направление одно и для обрезки, и для полей")
        self.assertIn("if(lt(on,", x_part)
        self.assertIn("pad='max(iw,", chain)
        z_part = chain.split("z='")[1].split("'")[0]
        self.assertRegex(z_part, r"^1\.77[0-9]+\*\(", "зум холста = ширина холста / ширина окна")

    def test_offset_reaches_the_window_position(self):
        chain = rc.build_anim(base_cfg(img={"x": 0.8, "y": 0.5}), 450, 15, size=(1000, 1000))
        self.assertIn("x='0.000+(", chain, "картинка шире холста не бывает — поля нулевые")
        self.assertIn("-iw/zoom)*((if(lt(on,450),0.80000", chain)

    def test_probe_of_missing_file_is_none(self):
        self.assertIsNone(rc.probe_size("/нет/такого.png"))

    def test_scale_is_clamped(self):
        cfg = base_cfg(img={"scale": 99})
        self.assertIn("s=1080x1920", rc.build_anim(cfg, 450, 15))

    def test_frame_size_reaches_the_filter(self):
        rc.set_frame(base_cfg(frame=[1080, 1350]))
        self.assertIn("s=1080x1350", rc.build_anim(base_cfg(), 450, 15))


class Dimming(unittest.TestCase):
    def setUp(self):
        rc.W, rc.H = 1080, 1920

    def test_no_dim_no_layers(self):
        self.assertEqual(rc.build_dims(base_cfg(), 15), [])

    def test_dim_makes_one_layer(self):
        cfg = base_cfg(anims=[{"type": "dim", "value": 0.45, "from": 2, "to": 10}])
        layers = rc.build_dims(cfg, 15)
        self.assertEqual(len(layers), 1)
        chain, label = layers[0]
        self.assertIn("color=c=black@0.450", chain)
        self.assertIn("fade=t=in:st=2.000", chain)
        self.assertIn(label, chain)

    def test_several_dims_stack(self):
        cfg = base_cfg(anims=[
            {"type": "dim", "value": 0.3, "from": 0, "to": 5},
            {"type": "dim", "value": 0.5, "from": 5, "to": 10},
        ])
        self.assertEqual(len(rc.build_dims(cfg, 15)), 2)

    def test_old_format_still_works(self):
        self.assertEqual(len(rc.build_dims(base_cfg(dim=0.4), 15)), 1)


class Waveform(unittest.TestCase):
    def setUp(self):
        rc.W, rc.H = 1080, 1920

    def test_disabled_wave_adds_nothing(self):
        self.assertEqual(rc.build_wave(base_cfg()), ([], []))

    def test_oscilloscope_uses_showwaves(self):
        cfg = base_cfg(wave={"on": True, "type": "wave-cline", "w": 1080, "h": 240, "y": 1620})
        filters, overlays = rc.build_wave(cfg)
        self.assertTrue(any("showwaves" in f and "mode=cline" in f for f in filters))
        self.assertEqual(overlays[0][2], 1620)

    def test_every_kind_builds_a_filter(self):
        for kind in rc.WAVE_KINDS:
            cfg = base_cfg(wave={"on": True, "type": kind})
            filters, overlays = rc.build_wave(cfg)
            self.assertTrue(filters, kind)
            self.assertTrue(overlays, kind)

    def test_old_names_are_understood(self):
        for old, expected in (("wave", "showwaves"), ("spectrum", "showfreqs")):
            filters, _ = rc.build_wave(base_cfg(wave={"on": True, "type": old}))
            self.assertTrue(any(expected in f for f in filters), old)

    def test_horizontal_position_shifts_the_overlay(self):
        left = rc.build_wave(base_cfg(wave={"on": True, "w": 540, "x": 0}))[1][0][1]
        right = rc.build_wave(base_cfg(wave={"on": True, "w": 540, "x": 1}))[1][0][1]
        self.assertEqual(left, 0)
        self.assertEqual(right, 1080 - 540)

    def test_outline_adds_a_second_pass(self):
        cfg = base_cfg(wave={"on": True, "type": "wave-cline",
                             "outline": {"on": True, "color": "#000000", "size": 2}})
        filters, overlays = rc.build_wave(cfg)
        self.assertGreater(len(overlays), 1, "обводка рисуется отдельными слоями")

    def test_colourful_kinds_get_no_outline(self):
        """Вектороскоп и гистограмма рисуются своими цветами."""
        cfg = base_cfg(wave={"on": True, "type": "vector",
                             "outline": {"on": True, "color": "#000000", "size": 2}})
        _, overlays = rc.build_wave(cfg)
        self.assertEqual(len(overlays), 1)


class Texts(unittest.TestCase):
    FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

    def setUp(self):
        rc.W, rc.H = 1080, 1920

    def test_no_texts_no_layers(self):
        self.assertEqual(rc.build_texts(base_cfg(), 15), [])

    def test_empty_text_is_skipped(self):
        cfg = base_cfg(texts=[{"text": "   ", "font": self.FONT}])
        self.assertEqual(rc.build_texts(cfg, 15), [])

    @unittest.skipUnless(os.path.isfile(FONT), "нет шрифта DejaVu")
    def test_text_becomes_drawtext_with_fades(self):
        cfg = base_cfg(texts=[{"text": "проба", "x": 540, "y": 960, "size": 64,
                               "font": self.FONT, "from": 0, "to": 15}])
        chain, label, ox, oy = rc.build_texts(cfg, 15)[0]
        self.assertIn("drawtext", chain)
        self.assertIn("fontsize=64", chain)
        self.assertIn("fade=t=in", chain)
        self.assertEqual((ox, oy), (0, 0), "надпись по центру кадра не смещается")

    @unittest.skipUnless(os.path.isfile(FONT), "нет шрифта DejaVu")
    def test_alpha_goes_into_fontcolor(self):
        cfg = base_cfg(texts=[{"text": "проба", "color": "#ffffff", "alpha": 0.4, "font": self.FONT}])
        self.assertIn("fontcolor=#ffffff@0.400", rc.build_texts(cfg, 15)[0][0])
        cfg = base_cfg(texts=[{"text": "проба", "color": "#ffffff", "font": self.FONT}])
        self.assertIn("fontcolor=#ffffff:", rc.build_texts(cfg, 15)[0][0], "без alpha цвет остаётся голым")

    @unittest.skipUnless(os.path.isfile(FONT), "нет шрифта DejaVu")
    def test_position_shifts_the_layer(self):
        cfg = base_cfg(texts=[{"text": "проба", "x": 100, "y": 200, "font": self.FONT}])
        _, _, ox, oy = rc.build_texts(cfg, 15)[0]
        self.assertEqual((ox, oy), (100 - 540, 200 - 960))

    @unittest.skipUnless(os.path.isfile(FONT), "нет шрифта DejaVu")
    def test_angle_adds_rotation(self):
        cfg = base_cfg(texts=[{"text": "проба", "angle": -4, "font": self.FONT}])
        self.assertIn("rotate=", rc.build_texts(cfg, 15)[0][0])

    def test_missing_font_stops_the_run(self):
        cfg = base_cfg(texts=[{"text": "проба", "font": "/нет/такого.ttf"}])
        with contextlib.redirect_stderr(io.StringIO()) as captured:
            with self.assertRaises(SystemExit):
                rc.build_texts(cfg, 15)
        self.assertIn("шрифт", captured.getvalue())


class Frames(unittest.TestCase):
    """Вступление и концовка: слои поверх клипа на общей шкале."""

    def setUp(self):
        rc.W, rc.H = 1080, 1920

    def test_missing_frame_is_none(self):
        self.assertIsNone(rc.frame_spec(base_cfg(), "intro", 15))
        self.assertIsNone(rc.frame_spec(base_cfg(intro={"duration": 2}), "intro", 15))

    def test_cut_has_no_transition(self):
        spec = rc.frame_spec(base_cfg(intro={"image": "a.png", "anim": "cut", "animDur": 2}), "intro", 15)
        self.assertEqual(spec["trans"], 0.0)

    def test_transition_never_outlives_the_clip(self):
        spec = rc.frame_spec(base_cfg(intro={"image": "a.png", "anim": "fade", "animDur": 9}), "intro", 3)
        self.assertLessEqual(spec["trans"], 3)

    def test_unknown_transition_stops_the_run(self):
        with contextlib.redirect_stderr(io.StringIO()) as captured:
            with self.assertRaises(SystemExit):
                rc.frame_spec(base_cfg(outro={"image": "a.png", "anim": "explode"}), "outro", 15)
        self.assertIn("outro", captured.getvalue())

    def test_intro_holds_then_fades_out(self):
        spec = rc.frame_spec(base_cfg(intro={"image": "a.png", "duration": 2, "anim": "fade", "animDur": 0.5}), "intro", 15)
        chain, overlay = rc.build_frame(spec, "intro", "2:v", 0.0)
        self.assertIn("d=75", chain, "2 с выдержки + 0.5 с перехода при 30 fps")
        self.assertIn("fade=t=out:st=2.000:d=0.500:alpha=1", chain)
        self.assertIn("[intro]", chain)
        self.assertIn("eof_action=pass", overlay)
        self.assertNotIn("setpts", chain, "вступление лежит с нуля")

    def test_outro_fades_in_and_is_shifted(self):
        spec = rc.frame_spec(base_cfg(outro={"image": "a.png", "duration": 3, "anim": "fade", "animDur": 1}), "outro", 15)
        chain, _ = rc.build_frame(spec, "outro", "3:v", 14.0)
        self.assertIn("fade=t=in:st=0:d=1.000:alpha=1", chain)
        self.assertIn("setpts=PTS+14.000/TB", chain)

    def test_slide_moves_the_layer(self):
        spec = rc.frame_spec(base_cfg(intro={"image": "a.png", "duration": 2, "anim": "slide", "dir": "left", "animDur": 0.5}), "intro", 15)
        _, overlay = rc.build_frame(spec, "intro", "2:v", 0.0)
        self.assertIn("x='-1080*", overlay)
        self.assertIn("(t-2.000)/0.500", overlay)
        spec = rc.frame_spec(base_cfg(outro={"image": "a.png", "anim": "slide", "dir": "up", "animDur": 0.5}), "outro", 15)
        _, overlay = rc.build_frame(spec, "outro", "3:v", 14.5)
        self.assertIn("y='1920*", overlay, "концовка, идущая вверх, приходит снизу")

    def test_zoom_uses_a_larger_source(self):
        spec = rc.frame_spec(base_cfg(intro={"image": "a.png", "anim": "zoom"}), "intro", 15)
        chain, _ = rc.build_frame(spec, "intro", "2:v", 0.0)
        self.assertIn("scale=2160:3840", chain)
        self.assertIn("1.25000", chain)

    def test_contain_pads_the_frame(self):
        spec = rc.frame_spec(base_cfg(outro={"image": "a.png", "fit": "contain"}), "outro", 15)
        chain, _ = rc.build_frame(spec, "outro", "3:v", 14.0)
        self.assertIn("pad=", chain)


class Thumbnail(unittest.TestCase):
    def setUp(self):
        rc.W, rc.H = 1080, 1920

    def test_none_is_none(self):
        self.assertIsNone(rc.thumb_spec(base_cfg()))
        self.assertIsNone(rc.thumb_spec(base_cfg(thumbnail={"mode": "none"})))

    def test_frame_mode_extracts_from_the_video(self):
        spec = rc.thumb_spec(base_cfg(thumbnail={"mode": "frame", "time": 4.5}))
        cmds = rc.thumb_cmds(spec, "video.mp4", "poster.jpg", 20)
        self.assertEqual(len(cmds), 1)
        self.assertIn("4.500", cmds[0])
        self.assertIn("video.mp4", cmds[0])

    def test_frame_time_stays_inside_the_video(self):
        spec = rc.thumb_spec(base_cfg(thumbnail={"mode": "frame", "time": 99}))
        cmd = rc.thumb_cmds(spec, "video.mp4", "poster.jpg", 20)[0]
        self.assertLess(float(cmd[cmd.index("-ss") + 1]), 20)

    def test_image_mode_needs_an_existing_file(self):
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                rc.thumb_spec(base_cfg(thumbnail={"mode": "image", "image": "/нет/такого.png"}))

    def test_cover_is_attached_without_reencoding(self):
        cmd = rc.cover_cmd("video.mp4", "poster.jpg", "out.mp4")
        self.assertIn("attached_pic", cmd)
        self.assertEqual(cmd[cmd.index("-c") + 1], "copy")


class CommandLine(unittest.TestCase):
    """Сквозной прогон: описание на входе — команда ffmpeg на выходе."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="clipper-tests-")
        cls.image = os.path.join(cls.tmp, "cover.jpg")
        cls.audio = os.path.join(cls.tmp, "track.wav")
        for path in (cls.image, cls.audio):
            open(path, "wb").close()

    def run_renderer(self, cfg):
        return subprocess.run(
            [sys.executable, os.path.join(ROOT, "render-clip.py"), "--print-cmd"],
            input=json.dumps(cfg), capture_output=True, text=True
        )

    def clip(self, **extra):
        cfg = {"image": self.image, "audio": self.audio,
               "out": os.path.join(self.tmp, "clip.mp4"), "start": 10, "duration": 15}
        cfg.update(extra)
        return cfg

    def test_prints_a_runnable_command(self):
        result = self.run_renderer(self.clip())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith("ffmpeg"))
        self.assertIn("-c:v libx264", result.stdout)
        self.assertIn("s=1080x1920", result.stdout)
        self.assertIn("-t 15.0", result.stdout)

    def test_custom_frame_reaches_the_command(self):
        result = self.run_renderer(self.clip(frame=[1080, 1350]))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("s=1080x1350", result.stdout)

    def test_segment_start_is_passed(self):
        self.assertIn("-ss 42.0", self.run_renderer(self.clip(start=42)).stdout)

    def test_missing_field_is_reported(self):
        cfg = self.clip()
        del cfg["out"]
        result = self.run_renderer(cfg)
        self.assertEqual(result.returncode, 1)
        self.assertIn("out", result.stderr)

    def test_missing_file_is_reported(self):
        result = self.run_renderer(self.clip(image="/нет/такого.jpg"))
        self.assertEqual(result.returncode, 1)
        self.assertIn("нет файла", result.stderr)

    def test_broken_json_is_reported(self):
        result = subprocess.run(
            [sys.executable, os.path.join(ROOT, "render-clip.py"), "--print-cmd"],
            input="{не json", capture_output=True, text=True
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("JSON", result.stderr)

    def frame_clip(self, **extra):
        return self.clip(intro={"image": self.image, "duration": 2, "anim": "slide", "animDur": 0.5},
                         outro={"image": self.image, "duration": 3, "anim": "fade", "animDur": 1},
                         wave={"on": True, "type": "wave-cline",
                               "outline": {"on": True, "color": "#000000", "size": 2}},
                         **extra)

    def test_frames_stretch_the_timeline(self):
        """Общая длина — вступление + отрезок + концовка; трек берётся с запасом до отрезка."""
        result = self.run_renderer(self.frame_clip())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("-t 20.0", result.stdout)
        self.assertIn("-ss 8.0", result.stdout, "звук под вступлением — 2 с до отрезка")
        self.assertIn("tpad=start_duration=2.000", result.stdout)
        self.assertIn("[intro]", result.stdout)
        self.assertIn("[outro]", result.stdout)

    def test_wave_reads_the_segment_not_the_padding(self):
        result = self.run_renderer(self.frame_clip())
        self.assertIn("atrim=start=2.000:end=17.000", result.stdout)
        self.assertIn("asplit=2[ws0][ws1]", result.stdout, "обводка — второй проход визуализатора")
        self.assertIn("-map '[aout]'", result.stdout)

    def test_short_track_start_gets_silence(self):
        result = self.run_renderer(self.frame_clip(start=0.5))
        self.assertIn("adelay=1500:all=1", result.stdout)
        self.assertIn("-ss 0.0", result.stdout)

    def test_thumbnail_adds_two_more_commands(self):
        result = self.run_renderer(self.clip(thumbnail={"mode": "frame", "time": 3}))
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = [l for l in result.stdout.splitlines() if l.startswith("ffmpeg")]
        self.assertEqual(len(lines), 3, "рендер, кадр-постер, обложка")
        self.assertIn("attached_pic", lines[2])

    def test_no_temporary_file_is_left_behind(self):
        self.run_renderer(self.clip())
        leftovers = [n for n in os.listdir(self.tmp) if n.startswith(".render-")]
        self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main()

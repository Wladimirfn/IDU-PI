"""Pruebas de validar_video_audio.py con audio sintético.

Uso (requiere numpy), desde esta carpeta:
    python -m unittest test_validar_video_audio
"""

import contextlib
import importlib.util
import io
import json
import tempfile
import unittest
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("validar", HERE / "validar_video_audio.py")
validar = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(validar)

SR = 24000


def write_wav(path, samples):
    data = (np.clip(samples, -1, 1) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(data.tobytes())


def speech(seconds=2.0):
    """A voiced tone with a 300 ms fade-out and 50 ms of silence: a clean take."""
    silence = int(0.05 * SR)
    t = np.arange(int(seconds * SR) - silence) / SR
    x = 0.3 * np.sin(2 * np.pi * 180 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * t))
    fade = int(0.3 * SR)
    x[-fade:] *= np.linspace(1, 0, fade)
    return np.concatenate([x, np.zeros(silence)])


def burst(x, start_from_end_s, length_s, amp=0.6, freq=300):
    y = x.copy()
    a = len(y) - int(start_from_end_s * SR)
    n = int(length_s * SR)
    t = np.arange(n) / SR
    y[a:a + n] += amp * np.sin(2 * np.pi * freq * t)
    return y


class Project:
    """A throwaway HyperFrames-style project: index.html plus its WAVs."""

    def __init__(self, tmp):
        self.dir = Path(tmp)
        self.tags = []

    def voice(self, n, samples, start, declared, tag=None):
        write_wav(self.dir / f"vo{n}.wav", samples)
        self.tags.append(
            (tag or '<audio id="vo{n}" src="vo{n}.wav" data-start="{start}" data-duration="{declared}"></audio>')
            .format(n=n, start=start, declared=declared)
        )

    def music(self, seconds, start, declared, score=None):
        write_wav(self.dir / "bgm.wav", np.zeros(int(seconds * SR)))
        self.tags.append(
            f'<audio id="bgm" src="bgm.wav" data-start="{start}" data-duration="{declared}"></audio>'
        )
        if score is not None:
            (self.dir / "partitura.json").write_text(json.dumps(score), encoding="utf-8")

    def run(self):
        (self.dir / "index.html").write_text("\n".join(self.tags), encoding="utf-8")
        errors, warnings = [], []
        with contextlib.redirect_stdout(io.StringIO()):
            validar.check_voices(self.dir, errors, warnings)
            validar.check_music(self.dir, errors, warnings)
        return errors, warnings


SCORE = {"titulo": "Prueba", "tempo": 80, "progresion": ["Am", "F", "C", "G"]}


class ValidarVideoAudio(unittest.TestCase):
    def project(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        return Project(tmp.name)

    def test_clean_project_passes(self):
        p = self.project()
        p.voice(1, speech(), 0, 1.9)
        p.music(3, 0, 3, SCORE)
        errors, warnings = p.run()
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])

    def test_music_starting_late_only_needs_its_own_duration(self):
        # Regression: compared the file against start + duration, so any music
        # not starting at 0 blocked the render.
        p = self.project()
        p.voice(1, speech(), 0, 1.9)
        p.music(10, 5, 10, SCORE)
        errors, _ = p.run()
        self.assertEqual(errors, [])

    def test_music_shorter_than_declared_fails(self):
        p = self.project()
        p.voice(1, speech(), 0, 1.9)
        p.music(8, 0, 10, SCORE)
        errors, _ = p.run()
        self.assertTrue(any("cut off" in e for e in errors), errors)

    def test_short_click_in_tail_fails(self):
        p = self.project()
        x = speech()
        x[len(x) - int(0.06 * SR):len(x) - int(0.05 * SR)] = 0.8  # 10 ms spike
        p.voice(1, x, 0, 1.9)
        p.music(3, 0, 3, SCORE)
        errors, _ = p.run()
        self.assertTrue(any("click" in e for e in errors), errors)

    def test_burst_longer_than_40ms_is_not_a_click(self):
        # Regression: CLICK_MAX_MS was declared but unused, so an 80 ms burst
        # (a strong final syllable) was flagged as a click.
        p = self.project()
        p.voice(1, burst(speech(), 0.12, 0.08), 0, 1.9)
        p.music(3, 0, 3, SCORE)
        errors, _ = p.run()
        self.assertFalse(any("click" in e for e in errors), errors)

    def test_strong_final_syllable_passes(self):
        p = self.project()
        p.voice(1, burst(speech(), 0.25, 0.12, amp=0.5, freq=220), 0, 1.9)
        p.music(3, 0, 3, SCORE)
        errors, _ = p.run()
        self.assertEqual(errors, [])

    def test_overlapping_voices_fail(self):
        p = self.project()
        p.voice(1, speech(), 0, 1.9)
        p.voice(2, speech(), 1.5, 1.9)
        p.music(5, 0, 5, SCORE)
        errors, _ = p.run()
        self.assertTrue(any("overlap" in e for e in errors), errors)

    def test_declared_longer_than_file_fails(self):
        p = self.project()
        p.voice(1, speech(), 0, 2.5)
        p.music(3, 0, 3, SCORE)
        errors, _ = p.run()
        self.assertTrue(any("desync" in e for e in errors), errors)

    def test_missing_score_warns_and_incomplete_score_fails(self):
        p = self.project()
        p.voice(1, speech(), 0, 1.9)
        p.music(3, 0, 3)
        _, warnings = p.run()
        self.assertTrue(any("partitura.json" in w for w in warnings), warnings)

        q = self.project()
        q.voice(1, speech(), 0, 1.9)
        q.music(3, 0, 3, {"titulo": "Sin tempo"})
        errors, _ = q.run()
        self.assertTrue(any("tempo" in e for e in errors), errors)

    def test_hyperframes_markup_with_attributes_in_between(self):
        # Regression: the regex required id, src, data-start, data-duration back to
        # back, so real HyperFrames output read as "no narration clips found".
        p = self.project()
        hf = ('<audio data-hf-id="hf-{n}" id="vo{n}" class="clip" src="vo{n}.wav" '
              'data-track-index="0" data-start="{start}" data-volume="1" data-duration="{declared}"></audio>')
        p.voice(1, speech(), 0, 1.9, tag=hf)
        p.voice(2, speech(), 2.5, 1.9, tag="<audio data-duration='{declared}' src='vo{n}.wav' "
                                          "data-start='{start}' class='clip' id='vo{n}'></audio>")
        p.music(5, 0, 5, SCORE)
        p.tags.append('<audio data-hf-id="m" id="bgm2" class="clip"></audio>')  # not bgm: ignored
        errors, warnings = p.run()
        self.assertEqual(errors, [])
        self.assertEqual(warnings, [])

    def test_clips_are_checked_in_start_order(self):
        p = self.project()
        p.voice(2, speech(), 2.5, 1.9)
        p.voice(1, speech(), 0, 1.9)
        p.music(5, 0, 5, SCORE)
        errors, _ = p.run()
        self.assertEqual(errors, [])

    def test_clip_missing_an_attribute_fails_by_name(self):
        p = self.project()
        p.voice(1, speech(), 0, 1.9, tag='<audio id="vo{n}" src="vo{n}.wav" data-start="{start}"></audio>')
        p.music(3, 0, 3, SCORE)
        errors, _ = p.run()
        self.assertTrue(any('id="vo1" is missing data-duration' in e for e in errors), errors)

    def test_final_spanish_s_from_a_real_take_is_not_a_click(self):
        # Regression from a real voicebox take: idupi-pizarra p5.wav ends in an
        # "s"/"ts" that peaks in 10 ms but fades over ~50 ms. Listened to by the
        # owner: natural speech, no click. Its last 400 ms, as 10 ms RMS frames:
        p5_tail = [0.0063, 0.0054, 0.0067, 0.0090, 0.0297, 0.0830, 0.0731, 0.0349,
                   0.0198, 0.0143, 0.0058, 0.0029, 0.0012, 0.0007, 0.0003, 0.0002,
                   0.0002, 0.0001, 0.0001] + [0.0] * 21
        rng = np.random.default_rng(5)
        hop = int(0.010 * SR)
        frames = [rng.standard_normal(hop) * rms for rms in p5_tail]
        x = np.concatenate([speech(1.6)[: int(1.6 * SR)] * 0.02] + frames)
        p = self.project()
        p.voice(1, x, 0, len(x) / SR - 0.01)
        p.music(3, 0, 3, SCORE)
        errors, _ = p.run()
        self.assertFalse(any("click" in e for e in errors), errors)


if __name__ == "__main__":
    unittest.main()

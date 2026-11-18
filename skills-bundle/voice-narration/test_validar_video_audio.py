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

    def music(self, seconds, start, declared, score=None, volume=None):
        write_wav(self.dir / "bgm.wav", np.zeros(int(seconds * SR)))
        volume_attr = f' data-volume="{volume}"' if volume is not None else ""
        self.tags.append(
            f'<audio id="bgm" src="bgm.wav" data-start="{start}" data-duration="{declared}"{volume_attr}></audio>'
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

    def test_loud_music_bed_fails(self):
        p = self.project()
        p.voice(1, speech(), 0, 1.9)
        p.music(3, 0, 3, SCORE, volume="0.22")
        errors, _ = p.run()
        self.assertTrue(any("music bed gain" in e for e in errors), errors)

    def test_music_bed_warns_between_default_and_error(self):
        p = self.project()
        p.voice(1, speech(), 0, 1.9)
        p.music(3, 0, 3, SCORE, volume="0.16")
        errors, warnings = p.run()
        self.assertEqual(errors, [])
        self.assertTrue(any("music bed gain" in w for w in warnings), warnings)

    def test_score_with_drums_warns(self):
        p = self.project()
        p.voice(1, speech(), 0, 1.9)
        score = {**SCORE, "voces": {"bateria": {"kick": "x...x...", "hat": "....x..."}}}
        p.music(3, 0, 3, score, volume="0.10")
        errors, warnings = p.run()
        self.assertEqual(errors, [])
        self.assertTrue(any("drums" in w for w in warnings), warnings)

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


_tts_spec = importlib.util.spec_from_file_location("tts_es", HERE / "tts_es.py")
tts_es = importlib.util.module_from_spec(_tts_spec)
_tts_spec.loader.exec_module(tts_es)

_vv_spec = importlib.util.spec_from_file_location("voz_validator", HERE / "voz_validator.py")
vv = importlib.util.module_from_spec(_vv_spec)
_vv_spec.loader.exec_module(vv)


class VoiceValidatorAndTtsTests(unittest.TestCase):
    def test_spanish_numbers_and_decimals_canonicalize_equally(self):
        ref = "Con veinticuatro llaves y treinta y cinco por ciento en noventa coma cincuenta y uno."
        hyp = "Con 24 llaves y 35% en 90,51."
        self.assertEqual(vv.canonicalize_es_tokens(ref), vv.canonicalize_es_tokens(hyp))
        al = vv.align_transcript(ref, hyp)
        self.assertEqual(al["wer"], 0.0)

    def test_tail_hallucination_words_are_blocked(self):
        ref = "Recien en la etapa tres escribe el archivo final."
        hyp = "Recien en la etapa 3 escribe el archivo final es similia similia de pereccion"
        ev = vv.evaluate_clip_speech(ref, hyp, {"has_anomaly": False})
        self.assertEqual(ev["verdict"], "block")
        self.assertTrue(any("hallucinated tail words" in e for e in ev["errors"]), ev)

    def test_technical_acronym_garbled_as_spanish_name_is_blocked(self):
        ref = "No necesitás abrir archivos JSON gigantes para saber quién está en tu equipo."
        hyp = "No necesitas abrir archivos Juan jugantes para saber quien esta en tu equipo."
        ev = vv.evaluate_clip_speech(ref, hyp, {"has_anomaly": False})
        self.assertEqual(ev["verdict"], "block")
        self.assertTrue(any("json" in e for e in ev["errors"]), ev)

    def test_tail_gap_burst_detects_long_island_but_not_clean_speech(self):
        clean_5s = speech(5.0)
        self.assertFalse(vv.find_tail_anomaly(clean_5s, SR)["has_anomaly"])

        # Add 350 ms silence gap followed by 900 ms hallucination burst before EOF.
        t = np.arange(int(0.9 * SR)) / SR
        gib = 0.25 * np.sin(2 * np.pi * 240 * t)
        dirty = np.concatenate([clean_5s[: int(3.75 * SR)], np.zeros(int(0.35 * SR)), gib])
        info = vv.find_tail_anomaly(dirty, SR)
        self.assertTrue(info["has_anomaly"])
        self.assertEqual(info["kind"], "tail_gap_burst")

    def test_check_voices_with_guion_and_injected_stt_writes_audio_qa(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        p = Project(tmp.name)
        p.voice(1, speech(4.0), 0, 3.9, tag='<audio id="vo1" src="e01.wav" data-start="{start}" data-duration="{declared}"></audio>')
        (p.dir / "e01.wav").write_bytes((p.dir / "vo1.wav").read_bytes())
        p.music(6, 0, 6, SCORE)
        (p.dir / "guion.md").write_text(
            "# Guion\n\n### e01 · Demo\nNo uses archivos JSON rotos.\n",
            encoding="utf-8",
        )
        (p.dir / "index.html").write_text("\n".join(p.tags), encoding="utf-8")

        errors, warnings = [], []
        with contextlib.redirect_stdout(io.StringIO()):
            report = validar.check_voices(
                p.dir,
                errors,
                warnings,
                write_qa=True,
                transcribe_fn=lambda _path: "No uses archivos Juan rotos es similia similia",
            )
        self.assertIsNotNone(report)
        qa_path = p.dir / "audit" / "audio-qa.json"
        self.assertTrue(qa_path.exists())
        self.assertEqual(report["scenes"][0]["verdict"], "block")
        self.assertTrue(any("hallucinated tail" in e for e in errors), errors)
        self.assertTrue(any("json" in e for e in errors), errors)

    def test_prepare_spanish_tts_text_rewrites_acronyms_and_protects_decimals(self):
        raw = "En idu-pi, no leas JSON a mano: corrí run-bench con work-glm al 87.84 por ciento."
        norm = tts_es.prepare_spanish_tts_text(raw, glossary={"corrí": "corré"})
        self.assertIn("jota son", norm.lower())
        self.assertIn("ran bench", norm.lower())
        self.assertIn("ge, ele, eme", norm.lower())
        self.assertNotIn("corrí", norm.lower())

        chunks = tts_es.split_sentences_for_tts(
            "El score fue 87.84 puntos. Luego validamos en cinco terminales distintas sin fallar nada.",
            max_words=10,
        )
        self.assertTrue(any("87.84" in c for c in chunks), chunks)
        self.assertGreaterEqual(len(chunks), 2)

    def test_synthesize_validated_clip_retries_bad_take_and_preserves_backup(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        out_wav = Path(tmp.name) / "voz" / "e01.wav"
        backup = Path(tmp.name) / "voz-prefade"

        attempts = []

        def synth(_text, attempt):
            attempts.append(attempt)
            if attempt == 1:
                # Bad first take ends with a gap + loud gibberish island.
                base = speech(4.0)[: int(3.0 * SR)]
                t = np.arange(int(0.8 * SR)) / SR
                return np.concatenate([base, np.zeros(int(0.3 * SR)), 0.25 * np.sin(2 * np.pi * 260 * t)]), SR
            return speech(4.0), SR

        def stt(path):
            a, _ = tts_es.read_pcm16_wav(path)
            # First attempt simulates hallucinated tail words; retry produces clean script.
            if vv.find_tail_anomaly(a, SR)["has_anomaly"]:
                return "Hola mundo es similia delotigue"
            return "Hola mundo"

        res = tts_es.synthesize_validated_clip(
            "e01",
            "Hola mundo.",
            out_wav,
            synth,
            backup_dir=backup,
            require_stt=True,
            transcribe_fn=stt,
        )
        self.assertEqual(attempts, [1, 2])
        self.assertTrue(res["passed"])
        self.assertEqual(res["verdict"], "pass")
        self.assertTrue(out_wav.exists())
        self.assertTrue((backup / "e01.wav").exists())

    def test_mixed_asr_tens_y_unit_and_compound_tokens_match_cleanly(self):
        ref = "En la comparativa final frente a cincuenta y tres de cuatro Hydrogen y Claude Opus con run-bench e idu-pi."
        hyp = "En la comparativa final frente a 50 y 3 de cuatro Jaidroyen y clodopus con runbench y dupi."
        al = vv.align_transcript(ref, hyp)
        self.assertEqual(al["missing_anchors"], [], al)
        self.assertIn("53", vv.canonicalize_es_tokens(hyp))

    def test_tail_gap_burst_distinguishes_clean_clause_vs_growl_under_stt(self):
        ref = "Cerramos la clase con una regla simple."
        # Loud articulated final clause (0.24 RMS) with zero extra STT words passes.
        ok = vv.evaluate_clip_speech(
            ref,
            ref,
            {"has_anomaly": True, "kind": "tail_gap_burst", "burst_duration_ms": 1400, "burst_peak_rms": 0.24},
        )
        self.assertEqual(ok["verdict"], "pass", ok)
        # Low unarticulated growl (0.11 RMS) > 1000ms after pause is blocked even with no extra words.
        growl = vv.evaluate_clip_speech(
            ref,
            ref,
            {"has_anomaly": True, "kind": "tail_gap_burst", "burst_duration_ms": 1800, "burst_peak_rms": 0.11},
        )
        self.assertEqual(growl["verdict"], "block", growl)
        # Isolated loud shriek (<1.2s) after long dead gap (>=480ms) is also blocked without extra STT words.
        shriek = vv.evaluate_clip_speech(
            ref,
            ref,
            {"has_anomaly": True, "kind": "tail_gap_burst", "gap_duration_ms": 700, "burst_duration_ms": 950, "burst_peak_rms": 0.23},
        )
        self.assertEqual(shriek["verdict"], "block", shriek)

    def test_spelled_glm_four_tokens_matches_but_mangled_fails(self):
        ref = "Mientras tanto, en la prueba real de nuestro sistema, work-glm resolvió la tarea limpia y rápido."
        ok = vv.evaluate_clip_speech(ref, "Mientras tanto, en la prueba real de nuestro sistema, Work G L E M resolvió la tarea limpia y rápido.", {"has_anomaly": False})
        self.assertEqual(ok["verdict"], "pass", ok)
        bad = vv.evaluate_clip_speech(ref, "Mientras tanto, en la prueba real de nuestro sistema, el m5 resolvió la tarea limpia y rápido.", {"has_anomaly": False})
        self.assertEqual(bad["verdict"], "block", bad)

    def test_contextual_en_pi_and_lowercase_glm_anchor_rules(self):
        anchors = vv.extract_critical_tokens("Usa glm en Pi hoy.")
        self.assertIn("glm", anchors)
        self.assertIn("pi", anchors)
        # Contextual "in p" matches "pi" cleanly when preceded by "in"/"en".
        al = vv.align_transcript("Explora con deepseek en Pi hoy.", "Explora con deepseek in p hoy.")
        self.assertEqual(al["missing_anchors"], [], al)
        al_mp = vv.align_transcript("Explora con deepseek v4 flash en Pi.", "Explora con deepseek v4 flash mp.")
        self.assertEqual(al_mp["missing_anchors"], [], al_mp)
        al_no_ctx = vv.align_transcript("El arnés Pi usa modelos rápidos.", "El arnés MP usa modelos rápidos.")
        self.assertTrue(any(m["token"] == "pi" for m in al_no_ctx["missing_anchors"]), al_no_ctx)

    def test_trim_chunk_boundaries_verified_strips_detached_noise_without_losing_words(self):
        t_head = np.arange(int(0.2 * SR)) / SR
        lead_puff = 0.04 * np.sin(2 * np.pi * 200 * t_head)
        gap = np.zeros(int(0.14 * SR))
        main = speech(1.8)[:-int(0.05 * SR)]
        t_tail = np.arange(int(0.35 * SR)) / SR
        tail_breath = 0.04 * np.sin(2 * np.pi * 160 * t_tail)
        noisy = np.concatenate([lead_puff, gap, main, gap, tail_breath]).astype(np.float32)

        def fake_stt(path: Path) -> str:
            arr, _ = tts_es.read_pcm16_wav(path)
            # Trailing breath/puff gone -> still retains all expected words.
            if len(arr) >= int(1.4 * SR):
                return "Hola mundo completo"
            return "Hola"

        with tempfile.TemporaryDirectory() as tmp:
            trimmed, hyp, meta = tts_es.trim_chunk_boundaries_verified(
                noisy,
                SR,
                "Hola mundo completo.",
                fake_stt,
                Path(tmp),
                "c1",
            )
        self.assertTrue(meta["trimmed_trailing"], meta)
        self.assertLess(len(trimmed), len(noisy) - int(0.3 * SR))
        self.assertEqual(hyp, "Hola mundo completo")

    def test_trim_chunk_boundaries_collapses_multi_puff_and_long_groan_but_refuses_word_loss(self):
        main = speech(1.8)
        t_puff = np.arange(int(0.18 * SR)) / SR
        puff = 0.03 * np.sin(2 * np.pi * 180 * t_puff)
        silence_long = np.zeros(int(1.25 * SR))
        silence_mid = np.zeros(int(0.35 * SR))
        # >2.1s groan tail (speech ends >2s before EOF) plus multi-puff layout.
        multi_puff = np.concatenate([main, silence_long, puff, silence_mid, puff]).astype(np.float32)

        def same_text_stt(_path: Path) -> str:
            return "Hola mundo completo"

        with tempfile.TemporaryDirectory() as tmp:
            trimmed, _hyp, meta = tts_es.trim_chunk_boundaries_verified(
                multi_puff,
                SR,
                "Hola mundo completo.",
                same_text_stt,
                Path(tmp),
                "multi",
            )
        self.assertTrue(meta["trimmed_trailing"], meta)
        self.assertLess(len(trimmed), int(2.1 * SR))

        # Guard: if trailing burst carries a garbled word ("mp" instead of "en Pi"), do not chop it off.
        with_tail_word = np.concatenate([main, np.zeros(int(0.14 * SR)), 0.14 * np.sin(2 * np.pi * 240 * t_puff)]).astype(np.float32)

        def drop_last_stt(path: Path) -> str:
            arr, _ = tts_es.read_pcm16_wav(path)
            if len(arr) >= len(main) + int(0.16 * SR):
                return "Explora en deepseek mp"
            return "Explora en deepseek"

        with tempfile.TemporaryDirectory() as tmp:
            kept, kept_hyp, kept_meta = tts_es.trim_chunk_boundaries_verified(
                with_tail_word,
                SR,
                "Explora en deepseek en Pi.",
                drop_last_stt,
                Path(tmp),
                "guard",
            )
        self.assertFalse(kept_meta["trimmed_trailing"], kept_meta)
        self.assertEqual(kept_hyp, "Explora en deepseek mp")
        self.assertGreaterEqual(len(kept), len(main) + int(0.16 * SR))


if __name__ == "__main__":
    unittest.main()

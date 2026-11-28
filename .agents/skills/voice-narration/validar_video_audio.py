"""Puerta de validacion para un video con audio: se ejecuta ANTES de renderizar.

Comprueba todo lo que rompe un video narrado con musica:
  1. Cada clip de voz dura lo que declara el HTML.
  2. Ningun clip se solapa con el siguiente.
  3. Ningun final de voz tiene chasquido (<40ms), cola de alucinacion/ruido ni fade falso.
  4. Con guion.md y STT local (Whisper): lo que el audio realmente dice coincide
     con el guion, sin palabras inventadas en la cola ni terminos tecnicos rotos.
  5. La musica existe, dura lo suficiente, NO es procedural y no tapa la voz.

Uso (requiere numpy; STT usa transformers/whisper o Voicebox si estan disponibles):
    python validar_video_audio.py --proyecto "/ruta/al/proyecto" [--require-stt] [--no-stt]

Salida: codigo 0 si todo pasa, 1 si algo falla. Nunca renderices con codigo 1.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import wave
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import voz_validator as vv  # noqa: E402

# A tail frame is a click when it exceeds its neighbours by this factor...
CLICK_RATIO = 5.0
# ...and the burst rises and falls in less than this. A final syllable or a
# sibilant lasts longer; flagging it as a click is how real speech gets "cleaned".
CLICK_MAX_MS = 40
TAIL_AUDIBLE = 0.006

# A music bed above this gain masks a voice at normal listening levels. The
# measured default is 0.10-0.14 with ducking. The old fixed 0.22 is an error.
MUSIC_VOLUME_WARN = 0.14
MUSIC_VOLUME_ERROR = 0.20

AUDIO_QA_VERSION = 1


def read_audio(path):
    """Devuelve (audio mono, sr). Acepta PCM16."""
    with wave.open(str(path), "rb") as f:
        sr, n, ch = f.getframerate(), f.getnframes(), f.getnchannels()
        raw = f.readframes(n)
    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    return a, sr


def duration(path):
    with wave.open(str(path), "rb") as f:
        return f.getnframes() / f.getframerate()


find_tail_click = vv.find_tail_click


TAG = re.compile(r"<[a-zA-Z][\w-]*\b([^>]*)>")
ATTR = re.compile(r"""([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')""")
NEEDED = ("src", "data-start", "data-duration")


def _parse_audio_tags(html, id_pattern, errors):
    """Tags whose id matches id_pattern, as dicts sorted by start."""
    found = []
    for m in TAG.finditer(html):
        attrs = {k: a if a or not b else b for k, a, b in ATTR.findall(m.group(1))}
        if not re.fullmatch(id_pattern, attrs.get("id", "")):
            continue
        missing = [k for k in NEEDED if k not in attrs]
        if missing:
            errors.append(f'id="{attrs["id"]}" is missing {", ".join(missing)}')
            continue
        try:
            start, dur = float(attrs["data-start"]), float(attrs["data-duration"])
        except ValueError:
            errors.append(f'id="{attrs["id"]}" has a non-numeric data-start or data-duration')
            continue
        found.append({
            "id": attrs["id"],
            "src": attrs["src"],
            "start": start,
            "declared": dur,
            "attrs": attrs,
        })
    return sorted(found, key=lambda c: c["start"])


def tagged_clips(html, id_pattern, errors):
    """Tags whose id matches id_pattern, as (src, start, duration), sorted by start."""
    return [(c["src"], c["start"], c["declared"]) for c in _parse_audio_tags(html, id_pattern, errors)]


def first_tag_attrs(html, id_pattern):
    """Attributes of the first tag whose id matches, for non-timing fields."""
    for m in TAG.finditer(html):
        attrs = {k: a if a or not b else b for k, a, b in ATTR.findall(m.group(1))}
        if re.fullmatch(id_pattern, attrs.get("id", "")):
            return attrs
    return None


def drum_hits(bateria):
    """Pieces with at least one hit in a 16/32-step pattern."""
    if not isinstance(bateria, dict):
        return []
    return [
        piece
        for piece, pattern in bateria.items()
        if isinstance(pattern, str) and re.search(r"[xX]", pattern)
    ]


def _resolve_scene_script(clip, idx, guion_scenes, ordered_ids):
    """Match a narration clip (`voN`, `eNN.wav`, or `data-script`) to its script text."""
    attrs = clip.get("attrs") or {}
    if attrs.get("data-script"):
        return attrs["id"], attrs["data-script"].strip()

    stem = Path(clip["src"]).stem.lower()
    clip_id = clip["id"].lower()
    if stem in guion_scenes:
        return stem, guion_scenes[stem]["text"]
    if clip_id in guion_scenes:
        return clip_id, guion_scenes[clip_id]["text"]

    m = re.match(r"vo(\d+)$", clip_id)
    if m:
        num = int(m.group(1))
        for cand in (f"e{num:02d}", f"e{num}"):
            if cand in guion_scenes:
                return cand, guion_scenes[cand]["text"]

    if idx < len(ordered_ids):
        sid = ordered_ids[idx]
        return sid, guion_scenes[sid]["text"]

    return stem or clip_id, None


def _load_audio_manifest(project):
    manifest_path = project / "audio-manifest.json"
    if not manifest_path.exists():
        return None, None
    return manifest_path, json.loads(manifest_path.read_text(encoding="utf-8"))


def _manifest_voice_clips(manifest, errors):
    clips = []
    for idx, item in enumerate(manifest.get("voices") or []):
        if not isinstance(item, dict) or not item.get("src"):
            errors.append(f"audio-manifest.json voices[{idx}] is missing src")
            continue
        try:
            start = float(item.get("start", 0.0))
            declared = float(item["duration"])
        except (KeyError, TypeError, ValueError):
            errors.append(f"audio-manifest.json voices[{idx}] has invalid start/duration")
            continue
        clips.append({
            "id": str(item.get("id") or f"vo{idx + 1}"),
            "src": str(item["src"]),
            "start": start,
            "declared": declared,
            "attrs": {k: str(v) for k, v in item.items() if v is not None},
        })
    return sorted(clips, key=lambda c: c["start"])


def check_voices(
    project,
    errors,
    warnings,
    *,
    guion_path=None,
    stt_mode="auto",
    stt_python=None,
    require_stt=False,
    write_qa=False,
    transcribe_fn=None,
):
    html_path = project / "index.html"
    manifest_path = project / "audio-manifest.json"
    source_path = None
    parsed_clips = []
    if html_path.exists():
        html = html_path.read_text(encoding="utf-8", errors="replace")
        parsed_clips = _parse_audio_tags(html, r"vo\d+", errors)
        if parsed_clips:
            source_path = html_path
    if not parsed_clips and manifest_path.exists():
        _, manifest = _load_audio_manifest(project)
        parsed_clips = _manifest_voice_clips(manifest or {}, errors)
        source_path = manifest_path
    if not parsed_clips:
        errors.append("no narration clips found in index.html or audio-manifest.json")
        return None

    script_file = Path(guion_path) if guion_path else (project / "guion.md")
    guion_scenes = vv.parse_guion_markdown(script_file) if script_file.exists() else {}
    ordered_ids = list(guion_scenes.keys())

    # Resolve WAV paths upfront so Whisper runs in one single batched model load.
    clip_records = []
    existing_paths = []
    for idx, clip in enumerate(parsed_clips):
        path = project / clip["src"]
        scene_key, ref_text = _resolve_scene_script(clip, idx, guion_scenes, ordered_ids)
        rec = {
            **clip,
            "path": path,
            "name": Path(clip["src"]).name,
            "scene_key": scene_key,
            "expected": ref_text,
        }
        clip_records.append(rec)
        if path.exists():
            existing_paths.append(path)

    has_any_script = any(bool(rec["expected"]) for rec in clip_records)
    transcripts: dict[str, str] = {}
    stt_engine = "disabled"

    if stt_mode != "off" and existing_paths and (has_any_script or require_stt or stt_mode == "on"):
        if transcribe_fn is not None:
            transcripts = {str(p): str(transcribe_fn(p) or "").strip() for p in existing_paths}
            stt_engine = "injected"
        else:
            try:
                transcripts, stt_engine = vv.transcribe_clips(existing_paths, stt_python=stt_python)
            except Exception as exc:
                if require_stt or stt_mode == "on":
                    errors.append(f"STT voice validation unavailable: {exc}")
                else:
                    warnings.append(f"STT voice validation skipped ({exc})")

    print(f"\n  voz: {len(clip_records)} clip(s) [stt={stt_engine}]")
    print(f"    {'archivo':<22} {'decl':>7} {'real':>7} {'delta':>7} {'wer':>6}  estado")

    prev_end = 0.0
    prev_name = ""
    qa_scenes = []
    voice_hashes = {}

    for rec in clip_records:
        src = rec["src"]
        start = rec["start"]
        declared = rec["declared"]
        path = rec["path"]
        name = rec["name"]

        if not path.exists():
            errors.append(f"missing voice file: {src}")
            continue

        voice_hashes[src] = vv.sha256_file(path)
        real = duration(path)
        delta = declared - real
        state = "ok"
        clip_errors = []
        clip_warnings = []

        # 1. declared duration must not exceed the real one
        if delta > 0.05:
            msg = f"declares {declared:.2f}s but file is {real:.2f}s (+{delta:.2f}s) — video will desync"
            errors.append(f"{name}: {msg}")
            clip_errors.append(msg)
            state = "DESYNC"

        # 2. no overlap with the previous clip
        if start < prev_end - 0.01:
            msg = f"starts {start:.2f}s before {prev_name} ends {prev_end:.2f}s — voices overlap"
            errors.append(f"{name}: {msg}")
            clip_errors.append(msg)
            state = "OVERLAP"

        # 3. no <40ms click / noisy tail
        a, sr = read_audio(path)
        has_click, tail_rms = find_tail_click(a, sr)
        if has_click:
            msg = "closing click detected in the tail"
            errors.append(f"{name}: {msg}")
            clip_errors.append(msg)
            state = "CLICK"
        elif tail_rms > TAIL_AUDIBLE:
            msg = f"tail RMS {tail_rms:.4f} is still audible"
            warnings.append(f"{name}: {msg}")
            clip_warnings.append(msg)

        # 4. longer trailing hallucination/noise islands & STT parity
        tail_info = vv.find_tail_anomaly(a, sr)
        hyp_text = transcripts.get(str(path))
        speech_eval = vv.evaluate_clip_speech(rec["expected"], hyp_text, tail_info)

        for e in speech_eval["errors"]:
            errors.append(f"{name}: {e}")
            clip_errors.append(e)
            if state == "ok":
                state = "HALLUCINATION" if "hallucinated" in e or "burst" in e else "VOICE_FAIL"
        for w in speech_eval["warnings"]:
            warnings.append(f"{name}: {w}")
            clip_warnings.append(w)
            if state == "ok":
                state = "warn"

        wer_str = (
            f"{speech_eval['alignment']['wer']:.3f}"
            if speech_eval.get("alignment")
            else "  n/a"
        )
        print(f"    {name:<22} {declared:>7.2f} {real:>7.2f} {delta:>7.2f} {wer_str:>6}  {state}")

        qa_scenes.append({
            "id": rec["scene_key"],
            "clipId": rec["id"],
            "src": src,
            "durationSec": round(real, 4),
            "declaredDurationSec": round(declared, 4),
            "expected": rec["expected"],
            "transcript": hyp_text,
            "wer": speech_eval["alignment"]["wer"] if speech_eval.get("alignment") else None,
            "tailInsertions": speech_eval["alignment"]["tail_insertions"] if speech_eval.get("alignment") else [],
            "missingAnchors": speech_eval["alignment"]["missing_anchors"] if speech_eval.get("alignment") else [],
            "tailAnomaly": tail_info,
            "verdict": "block" if clip_errors else ("revise" if clip_warnings else "pass"),
            "errors": clip_errors,
            "warnings": clip_warnings,
        })

        prev_end = start + real
        prev_name = name

    print(f"    last voice ends at {prev_end:.2f}s")

    qa_report = {
        "version": AUDIO_QA_VERSION,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sttEngine": stt_engine,
        "inputs": {
            "indexHtml": vv.sha256_file(source_path) if source_path else None,
            "guionMd": vv.sha256_file(script_file) if script_file.exists() else None,
            "voices": voice_hashes,
        },
        "scenes": qa_scenes,
    }

    if write_qa:
        audit_dir = project / "audit"
        audit_dir.mkdir(parents=True, exist_ok=True)
        (audit_dir / "audio-qa.json").write_text(
            json.dumps(qa_report, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    return qa_report


def check_music(project, errors, warnings):
    html_path = project / "index.html"
    tracks = []
    attrs = {}
    if html_path.exists():
        html = html_path.read_text(encoding="utf-8", errors="replace")
        tracks = tagged_clips(html, r"bgm", errors)
        attrs = first_tag_attrs(html, r"bgm") or {}
    if not tracks:
        _, manifest = _load_audio_manifest(project)
        bgm = (manifest or {}).get("bgm") if isinstance(manifest, dict) else None
        if isinstance(bgm, dict) and bgm.get("src"):
            tracks = [(str(bgm["src"]), float(bgm.get("start", 0.0)), float(bgm.get("duration", 0.0)))]
            if bgm.get("volume") is not None:
                attrs = {"data-volume": str(bgm["volume"])}
    if not tracks:
        warnings.append("no bgm track found in index.html or audio-manifest.json")
        return

    src, _start, dur_s = tracks[0]
    path = project / src
    print(f"\n  musica: {src}")

    raw_volume = attrs.get("data-volume")
    if raw_volume is not None:
        try:
            volume = float(raw_volume)
        except ValueError:
            errors.append('id="bgm" has a non-numeric data-volume')
        else:
            if volume > MUSIC_VOLUME_ERROR:
                errors.append(
                    f"music bed gain {volume:.2f} is above {MUSIC_VOLUME_ERROR:.2f}: "
                    "it masks the voice. Measure a ducked mix and lower it; "
                    "0.10-0.14 is the measured default."
                )
            elif volume > MUSIC_VOLUME_WARN:
                warnings.append(
                    f"music bed gain {volume:.2f} is above {MUSIC_VOLUME_WARN:.2f}; "
                    "confirm the mix is ducked and the voice still wins."
                )

    if not path.exists():
        errors.append(f"missing music file: {src}")
        return

    real = duration(path)
    # The file plays from data-start, so it only has to last data-duration.
    if real < dur_s - 0.1:
        errors.append(
            f"music is {real:.2f}s but the track declares {dur_s:.2f}s — it will cut off"
        )
    else:
        print(f"    duracion {real:.2f}s · declarado {dur_s:.2f}s  ok")

    # A score file next to the WAV is the proof the AI composed it.
    score = path.parent / "partitura.json"
    if score.exists():
        data = json.loads(score.read_text(encoding="utf-8"))
        missing = [k for k in ("titulo", "tempo", "progresion") if not data.get(k)]
        if missing:
            errors.append(f"score is incomplete: missing {', '.join(missing)}")
        else:
            print(f"    partitura IA: \"{data['titulo']}\" · {data['tempo']} BPM · "
                  f"{len(data['progresion'])} acordes  ok")
            active = []
            voces = data.get("voces")
            if isinstance(voces, dict):
                active += drum_hits(voces.get("bateria"))
            sections = data.get("vocesPorSeccion")
            if isinstance(sections, list):
                for i, section in enumerate(sections):
                    if isinstance(section, dict):
                        active += [f"section {i}:{p}" for p in drum_hits(section.get("bateria"))]
            if active:
                warnings.append(
                    "the score writes drums/percussion ("
                    + ", ".join(active[:6])
                    + "); a voiceover bed usually leaves them out. "
                    "Confirm the music brief wants them or remove the layer."
                )
    else:
        warnings.append(
            "no partitura.json next to the music: cannot prove the AI composed it. "
            "A procedural loop and a real song look alike without the score."
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--proyecto", required=True)
    ap.add_argument("--guion", help="Ruta a guion.md (por defecto <proyecto>/guion.md)")
    ap.add_argument("--transcribir", action="store_true", help="Exige validacion STT con Whisper local")
    ap.add_argument("--require-stt", action="store_true", help="Falla si no hay runtime Whisper/Voicebox disponible")
    ap.add_argument("--no-stt", action="store_true", help="Omite transcripcion Whisper (solo fisicos + colas)")
    ap.add_argument("--stt-python", help="Interprete Python con transformers/torch/librosa para STT")
    ap.add_argument("--no-qa", action="store_true", help="No escribir audit/audio-qa.json")
    ap.add_argument("--json", action="store_true", help="Imprimir reporte JSON final por stdout")
    args = ap.parse_args()

    project = Path(args.proyecto)
    if not (project / "index.html").exists() and not (project / "audio-manifest.json").exists():
        print(f"ERROR: {project}/index.html and {project}/audio-manifest.json not found")
        return 1

    stt_mode = "off" if args.no_stt else ("on" if (args.transcribir or args.require_stt) else "auto")
    errors, warnings = [], []
    print(f"== validacion de audio: {project.name}")

    qa_report = check_voices(
        project,
        errors,
        warnings,
        guion_path=args.guion,
        stt_mode=stt_mode,
        stt_python=args.stt_python,
        require_stt=bool(args.transcribir or args.require_stt),
        write_qa=False,
    )
    music_errors, music_warnings = [], []
    check_music(project, music_errors, music_warnings)
    errors.extend(music_errors)
    warnings.extend(music_warnings)

    if qa_report is not None:
        bgm_src = None
        if (project / "index.html").exists():
            html = (project / "index.html").read_text(encoding="utf-8", errors="replace")
            bgm_attrs = first_tag_attrs(html, r"bgm")
            bgm_src = bgm_attrs.get("src") if bgm_attrs else None
        if not bgm_src:
            _, manifest = _load_audio_manifest(project)
            bgm = (manifest or {}).get("bgm") if isinstance(manifest, dict) else None
            if isinstance(bgm, dict) and bgm.get("src"):
                bgm_src = str(bgm["src"])
        bgm_path = (project / bgm_src) if bgm_src else None
        partitura_path = (bgm_path.parent / "partitura.json") if bgm_path else None
        qa_report["inputs"]["music"] = (
            {bgm_src: vv.sha256_file(bgm_path)} if (bgm_src and bgm_path and bgm_path.exists()) else {}
        )
        qa_report["inputs"]["partitura"] = (
            vv.sha256_file(partitura_path) if (partitura_path and partitura_path.exists()) else None
        )
        qa_report["musicErrors"] = music_errors
        qa_report["musicWarnings"] = music_warnings
        if not args.no_qa:
            audit_dir = project / "audit"
            audit_dir.mkdir(parents=True, exist_ok=True)
            (audit_dir / "audio-qa.json").write_text(
                json.dumps(qa_report, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )

    print("\n" + "=" * 62)
    if warnings:
        print(f"{len(warnings)} aviso(s):")
        for w in warnings:
            print(f"  - {w}")
    if errors:
        print(f"\n{len(errors)} ERROR(es) — NO renderizar:")
        for e in errors:
            print(f"  - {e}")
        if args.json and qa_report is not None:
            print("\n" + json.dumps({"errors": errors, "warnings": warnings, "report": qa_report}, ensure_ascii=False))
        return 1

    if args.json and qa_report is not None:
        print(json.dumps({"errors": errors, "warnings": warnings, "report": qa_report}, ensure_ascii=False))
    print("todo correcto: se puede renderizar")
    return 0


if __name__ == "__main__":
    sys.exit(main())

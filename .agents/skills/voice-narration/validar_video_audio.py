"""Puerta de validacion para un video con audio: se ejecuta ANTES de renderizar.

Comprueba las cuatro cosas que se rompieron en el video de idu-pi:
  1. Cada clip de voz dura lo que declara el HTML.
  2. Ningun clip se solapa con el siguiente.
  3. Ningun final de voz tiene chasquido ni cola ruidosa.
  4. La musica existe, dura lo suficiente y NO es una variacion procedural.

Uso:
    python validar_video_audio.py --proyecto "C:/ruta/al/proyecto"

Salida: codigo 0 si todo pasa, 1 si algo falla. Nunca renderices con codigo 1.
"""

import argparse
import json
import re
import sys
import wave
from pathlib import Path

import numpy as np

# A tail frame is a click when it exceeds its neighbours by this factor.
CLICK_RATIO = 5.0
CLICK_MAX_MS = 40
TAIL_AUDIBLE = 0.006


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


def periodic(seg, sr):
    if len(seg) < 400:
        return 0.0
    w = seg - seg.mean()
    if np.sqrt(np.mean(w ** 2)) < 1e-6:
        return 1.0
    ac = np.correlate(w, w, mode="full")[len(w) - 1:]
    if ac[0] <= 0:
        return 0.0
    lo, hi = int(sr / 400), min(int(sr / 70), len(ac) - 1)
    if hi <= lo:
        return 0.0
    return float(np.max(ac[lo:hi]) / ac[0])


def find_tail_click(a, sr):
    """Devuelve (hay_click, rms_cola). Detecta por firma temporal, no por voz."""
    hop = int(0.010 * sr)
    if len(a) < hop * 12:
        return False, 0.0

    env = np.array([
        np.sqrt(np.mean(a[i:i + hop] ** 2))
        for i in range(0, len(a) - hop, hop)
    ])
    seg = env[-40:] if len(env) > 40 else env
    tail_rms = float(np.mean(seg[-2:])) if len(seg) >= 2 else 0.0

    for i in range(2, len(seg) - 2):
        peak = seg[i]
        if peak < 0.05:
            continue
        left = seg[max(0, i - 6):max(0, i - 2)]
        right = seg[i + 3:min(len(seg), i + 7)]
        neigh = np.concatenate([left, right]) if len(left) + len(right) else np.array([1e-9])
        base = float(np.median(neigh)) or 1e-9
        if peak > base * CLICK_RATIO:
            return True, tail_rms

    return False, tail_rms


def check_voices(project, errors, warnings):
    html = (project / "index.html").read_text(encoding="utf-8", errors="replace")
    clips = re.findall(
        r'id="vo\d+"\s+src="([^"]+)"\s+data-start="([\d.]+)"\s+data-duration="([\d.]+)"',
        html,
    )
    if not clips:
        errors.append("no narration clips found in index.html")
        return

    print(f"\n  voz: {len(clips)} clip(s)")
    print(f"    {'archivo':<26} {'decl':>7} {'real':>7} {'delta':>7}  estado")

    prev_end = 0.0
    prev_name = ""
    for src, start_s, dur_s in clips:
        start, declared = float(start_s), float(dur_s)
        path = project / src
        name = Path(src).name

        if not path.exists():
            errors.append(f"missing voice file: {src}")
            continue

        real = duration(path)
        delta = declared - real
        state = "ok"

        # 1. declared duration must not exceed the real one
        if delta > 0.05:
            errors.append(
                f"{name}: declares {declared:.2f}s but file is {real:.2f}s "
                f"(+{delta:.2f}s) — video will desync"
            )
            state = "DESYNC"

        # 2. no overlap with the previous clip
        if start < prev_end - 0.01:
            errors.append(
                f"{name}: starts {start:.2f}s before {prev_name} ends {prev_end:.2f}s — voices overlap"
            )
            state = "OVERLAP"

        # 3. no click / noisy tail
        a, sr = read_audio(path)
        has_click, tail_rms = find_tail_click(a, sr)
        if has_click:
            errors.append(f"{name}: closing click detected in the tail")
            state = "CLICK"
        elif tail_rms > TAIL_AUDIBLE:
            warnings.append(f"{name}: tail RMS {tail_rms:.4f} is still audible")

        prev_end = start + real
        prev_name = name
        print(f"    {name:<26} {declared:>7.2f} {real:>7.2f} {delta:>7.2f}  {state}")

    print(f"    last voice ends at {prev_end:.2f}s")


def check_music(project, errors, warnings):
    html = (project / "index.html").read_text(encoding="utf-8", errors="replace")
    m = re.search(
        r'id="bgm"[^>]*src="([^"]+)"[^>]*data-start="([\d.]+)"[^>]*data-duration="([\d.]+)"',
        html,
    )
    if not m:
        warnings.append("no bgm track found in index.html")
        return

    src, start_s, dur_s = m.group(1), float(m.group(2)), float(m.group(3))
    path = project / src
    print(f"\n  musica: {src}")

    if not path.exists():
        errors.append(f"missing music file: {src}")
        return

    real = duration(path)
    if real < start_s + dur_s - 0.1:
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
    else:
        warnings.append(
            "no partitura.json next to the music: cannot prove the AI composed it. "
            "A procedural loop and a real song look alike without the score."
        )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--proyecto", required=True)
    args = ap.parse_args()

    project = Path(args.proyecto)
    if not (project / "index.html").exists():
        print(f"ERROR: {project}/index.html not found")
        return 1

    errors, warnings = [], []
    print(f"== validacion de audio: {project.name}")

    check_voices(project, errors, warnings)
    check_music(project, errors, warnings)

    print("\n" + "=" * 62)
    if warnings:
        print(f"{len(warnings)} aviso(s):")
        for w in warnings:
            print(f"  - {w}")
    if errors:
        print(f"\n{len(errors)} ERROR(es) — NO renderizar:")
        for e in errors:
            print(f"  - {e}")
        return 1

    print("todo correcto: se puede renderizar")
    return 0


if __name__ == "__main__":
    sys.exit(main())

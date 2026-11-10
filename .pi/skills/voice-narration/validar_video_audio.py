"""Puerta de validacion para un video con audio: se ejecuta ANTES de renderizar.

Comprueba las cuatro cosas que se rompieron en el video de idu-pi:
  1. Cada clip de voz dura lo que declara el HTML.
  2. Ningun clip se solapa con el siguiente.
  3. Ningun final de voz tiene chasquido ni cola ruidosa.
  4. La musica existe, dura lo suficiente y NO es una variacion procedural.
  5. La musica es una cama: gain medido y sin bateria bajo la voz por defecto.

Uso (requiere numpy):
    python validar_video_audio.py --proyecto "/ruta/al/proyecto"

Salida: codigo 0 si todo pasa, 1 si algo falla. Nunca renderices con codigo 1.
"""

import argparse
import json
import re
import sys
import wave
from pathlib import Path

import numpy as np

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
            # Temporal signature: how long the burst takes to rise from and fall
            # back to 1/CLICK_RATIO of its peak (10 ms frames). A click is over in
            # under CLICK_MAX_MS; a final Spanish "s"/"ts" peaks as sharply but
            # fades over ~50 ms (idupi-pizarra p5.wav), so the tail decides.
            floor = peak / CLICK_RATIO
            lo = hi = i
            while lo > 0 and seg[lo - 1] >= floor:
                lo -= 1
            while hi < len(seg) - 1 and seg[hi + 1] >= floor:
                hi += 1
            if (hi - lo + 1) * 10 < CLICK_MAX_MS:
                return True, tail_rms

    return False, tail_rms


TAG = re.compile(r"<[a-zA-Z][\w-]*\b([^>]*)>")
ATTR = re.compile(r"""([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')""")
NEEDED = ("src", "data-start", "data-duration")


def tagged_clips(html, id_pattern, errors):
    """Tags whose id matches id_pattern, as (src, start, duration), sorted by start.

    Attributes are read by name, in any order and among any others: HyperFrames
    writes <audio data-hf-id="..." id="vo1" class="clip" src="..." ...>.
    """
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
        found.append((attrs["src"], start, dur))
    return sorted(found, key=lambda c: c[1])


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


def check_voices(project, errors, warnings):
    html = (project / "index.html").read_text(encoding="utf-8", errors="replace")
    clips = tagged_clips(html, r"vo\d+", errors)
    if not clips:
        errors.append("no narration clips found in index.html")
        return

    print(f"\n  voz: {len(clips)} clip(s)")
    print(f"    {'archivo':<26} {'decl':>7} {'real':>7} {'delta':>7}  estado")

    prev_end = 0.0
    prev_name = ""
    for src, start, declared in clips:
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
    tracks = tagged_clips(html, r"bgm", errors)
    if not tracks:
        warnings.append("no bgm track found in index.html")
        return

    src, _start, dur_s = tracks[0]
    path = project / src
    print(f"\n  musica: {src}")

    attrs = first_tag_attrs(html, r"bgm") or {}
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

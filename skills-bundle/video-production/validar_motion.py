"""Puerta de validacion de MOVIMIENTO para un explainer renderizado en codigo.

Por que existe
--------------
`validar_video_audio.py` bloquea el render cuando el audio esta mal: duracion,
solapes, clicks, musica sin partitura. Nada equivalente existia para la imagen
en movimiento, y por eso los cuatro defectos que se ven en pantalla -letras que
parpadean, personajes pobres, informacion que falta, cosas desalineadas- no
tenian forma de detectarse antes de publicar.

El oraculo ya estaba ahi y nadie lo usaba: `keyframes/eNN.png` es el estado
final y quieto de cada escena, aprobado a mano en la revision de fotogramas.
Si la animacion termina en ese fotograma, la escena esta donde se aprobo; si
termina corrida, el keyframe lo dice y este script mide cuanto.

Uso (requiere numpy y Pillow)
-----------------------------
    python validar_motion.py --proyecto "/ruta/al/proyecto"

Salida: codigo 0 si todo pasa, 1 si algo falla. Nunca renderices con codigo 1.

Que mide
--------
1. Alineacion  - el frame al final de cada escena contra su keyframe aprobado:
                 corrimiento en px, correlacion de bordes y pixeles encendidos
                 que no coinciden.
2. Parpadeo    - diferencia entre frames consecutivos en la ventana quieta de
                 cada escena. Un titular estatico que parpadea da picos; uno
                 bien rasterizado da ~0.
3. Congelados  - tramos sin ningun cambio dentro de una escena.
4. Negros      - frames con luminancia casi nula.

No mide si el video "esta bueno". Mide si es el video que se aprobo, estable.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

# --- umbrales ---------------------------------------------------------------
# Calibrados contra idupi-explainer-v2. Ajustar solo con evidencia: si un video
# nuevo falla aca, primero mirar el diff, despues tocar el numero.
MAX_SHIFT_PX = 8        # corrimiento aceptable a 1920 de ancho
MIN_EDGE_CORR = 0.55    # correlacion de bordes en el mejor alineamiento
MAX_RESIDUAL = 26.0     # diferencia media de pixeles tras alinear (0-255)
MAX_FLICKER = 6.0       # p99 del diff por pixel a resolucion nativa (0-255)
MAX_FLICKER_PX = 3000   # pixeles que cambian en la ventana que deberia estar quieta
MIN_FROZEN_S = 1.5      # tramo congelado dentro de una escena
MAX_BLACK_S = 0.4       # tramo negro permitido (fundidos finales suelen durar mas)

ANALYSIS_FPS = 10
ANALYSIS_W = 480
ANALYSIS_H = 270

# Lo setea main() con --debug: guarda un PNG por escena con los pixeles que
# cambian. Es la evidencia que convierte "parpadea" en un archivo que se mira.
DEBUG_DIR = None


def gstream(video, fps=ANALYSIS_FPS, w=ANALYSIS_W, h=ANALYSIS_H):
    """Decodifica el video a un array (n, h, w) uint8 en gris, en un solo pase."""
    cmd = [
        "ffmpeg", "-v", "error", "-i", str(video),
        "-vf", f"fps={fps},scale={w}:{h}",
        "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ]
    raw = subprocess.run(cmd, capture_output=True, check=False).stdout
    if not raw:
        raise SystemExit(f"ffmpeg no devolvio frames para {video}")
    n = len(raw) // (w * h)
    return np.frombuffer(raw[: n * w * h], dtype=np.uint8).reshape(n, h, w)


def load_keyframe(path, w=ANALYSIS_W, h=ANALYSIS_H):
    im = Image.open(path).convert("L").resize((w, h), Image.LANCZOS)
    return np.asarray(im, dtype=np.uint8)


def edges(a):
    """Magnitud de gradiente normalizada a 0-255. Robusta a diferencia de brillo."""
    a = a.astype(np.float32)
    gx = np.abs(np.diff(a, axis=1, prepend=a[:, :1]))
    gy = np.abs(np.diff(a, axis=0, prepend=a[:1, :]))
    g = np.hypot(gx, gy)
    return (g / (g.max() or 1.0) * 255.0).astype(np.float32)


def best_shift(edges_a, edges_b, search=8, step=2):
    """Corrimiento (dx, dy) que mejor alinea b sobre a, y la correlacion lograda."""
    base = edges_a - edges_a.mean()
    denom_a = np.linalg.norm(base) or 1.0
    best = (0, 0, -1.0)
    for dy in range(-search, search + 1, step):
        for dx in range(-search, search + 1, step):
            shifted = np.roll(np.roll(edges_b, dy, axis=0), dx, axis=1)
            cand = shifted - shifted.mean()
            denom = denom_a * (np.linalg.norm(cand) or 1.0)
            corr = float((base * cand).sum() / denom) if denom else 0.0
            if corr > best[2]:
                best = (dx, dy, corr)
    # refinar alrededor del mejor punto con paso 1
    dx0, dy0, _ = best
    for dy in range(max(-search, dy0 - 1), min(search, dy0 + 1) + 1):
        for dx in range(max(-search, dx0 - 1), min(search, dx0 + 1) + 1):
            shifted = np.roll(np.roll(edges_b, dy, axis=0), dx, axis=1)
            cand = shifted - shifted.mean()
            denom = denom_a * (np.linalg.norm(cand) or 1.0)
            corr = float((base * cand).sum() / denom) if denom else 0.0
            if corr > best[2]:
                best = (dx, dy, corr)
    return best


def ink_mask(a):
    """Pixeles encendidos, con umbral adaptativo al contraste de la escena."""
    f = a.astype(np.float32)
    thr = f.mean() + f.std() * 0.6
    return f > thr


def scene_windows(timeline, scene):
    """(t_fin_quieto, inicio_ventana_quieta) de una escena."""
    fin = float(scene.get("fin_voz", 0.0))
    prev_end = fin
    for f in reversed(scene.get("frases", [])):
        prev_end = float(f.get("end", fin))
        break
    return fin, max(float(scene["start"]), fin - 0.7)


def flicker_native(video, t0, duration, label="", fps=ANALYSIS_FPS):
    """Parpadeo medido a resolucion NATIVA dentro de una ventana corta.

    Escalar a 480x270 antes de comparar promedia bloques de 4x4 y borra justo
    el aliasing de texto que se ve como parpadeo: el defecto desaparece del
    instrumento antes de medirse. Por eso la ventana quieta se decodifica 1:1.
    Devuelve (p99 del diff por pixel, maximo, pixeles que cambian > 8).
    """
    cmd = [
        "ffmpeg", "-v", "error",
        "-ss", f"{max(0.0, t0):.3f}", "-t", f"{duration:.3f}",
        "-i", str(video),
        "-vf", f"fps={fps}",
        "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ]
    raw = subprocess.run(cmd, capture_output=True, check=False).stdout
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", str(video)],
        capture_output=True, text=True, check=False,
    ).stdout.strip()
    try:
        width, height = (int(v) for v in probe.split(","))
    except ValueError:
        return 0.0, 0.0, 0, (0, 0, 0, 0)
    frame_bytes = width * height
    n = len(raw) // frame_bytes
    if n < 2:
        return 0.0, 0.0, 0, (0, 0, 0, 0)
    arr = np.frombuffer(raw[: n * frame_bytes], dtype=np.uint8).reshape(n, height, width)
    diffs = np.abs(np.diff(arr.astype(np.int16), axis=0))
    mask = (diffs > 8).any(axis=0)
    changed = int(mask.sum())
    if changed:
        ys, xs = np.nonzero(mask)
        bbox = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
    else:
        bbox = (0, 0, 0, 0)
    if DEBUG_DIR is not None:
        peak = diffs.max(axis=0).astype(np.float32)
        Image.fromarray(np.clip(peak * 12, 0, 255).astype(np.uint8)).save(
            DEBUG_DIR / f"{label or f'{t0:07.2f}'}-diff.png"
        )
    return float(np.percentile(diffs, 99)), float(diffs.max()), changed, bbox


def check_scenes(project, frames, timeline, video, errors, warnings):
    kf_dir = project / "keyframes"
    print(f"\n  escenas: {len(timeline['scenes'])}")
    header = (
        f"    {'escena':<7} {'t':>7} {'corrim.':>10} {'corr':>6} {'resid':>7} "
        f"{'parpadeo':>9} {'px/parp':>8}  estado"
    )
    print(header)

    for scene in timeline["scenes"]:
        sid = scene["id"]
        fin, quiet_from = scene_windows(timeline, scene)
        # 0.1s antes del final de voz: el ultimo beat ya asento, la transicion
        # al siguiente estilo todavia no empezo (aire_escena).
        t = max(0.0, fin - 0.1)
        idx = min(len(frames) - 1, int(round(t * ANALYSIS_FPS)))
        got = frames[idx]

        kf_path = kf_dir / f"{sid}.png"
        if not kf_path.exists():
            errors.append(f"{sid}: falta el keyframe aprobado {kf_path.name}")
            continue
        want = load_keyframe(kf_path)

        dx, dy, corr = best_shift(edges(want), edges(got))
        shift_px = max(abs(dx), abs(dy)) * (1920 // ANALYSIS_W)
        sx = 1920 // ANALYSIS_W
        shifted = np.roll(np.roll(got.astype(np.float32), dy, axis=0), dx, axis=1)
        residual = float(np.abs(shifted - want.astype(np.float32)).mean())

        mask_want = ink_mask(want)
        mask_got = ink_mask(shifted.astype(np.uint8))
        union = np.logical_or(mask_want, mask_got).sum()
        iou = float(np.logical_and(mask_want, mask_got).sum() / union) if union else 1.0

        window_s = max(0.2, fin - quiet_from)
        flicker, flicker_max, changed_px, bbox = flicker_native(
            video, quiet_from, window_s, label=sid
        )

        state = "ok"
        if shift_px > MAX_SHIFT_PX:
            errors.append(
                f"{sid}: desplazada {shift_px}px ({dx * sx:+d},{dy * sx:+d}) "
                f"respecto de {kf_path.name}"
            )
            state = "DESALINEADA"
        elif corr < MIN_EDGE_CORR:
            errors.append(f"{sid}: contenido distinto del keyframe (corr {corr:.2f})")
            state = "DISTINTA"
        elif residual > MAX_RESIDUAL:
            warnings.append(f"{sid}: residual alto {residual:.1f} sobre el keyframe")
        if flicker > MAX_FLICKER or changed_px > MAX_FLICKER_PX:
            where = (
                f"entre x {bbox[0]}-{bbox[2]}, y {bbox[1]}-{bbox[3]}"
                if changed_px
                else "sin region"
            )
            errors.append(
                f"{sid}: parpadeo en la ventana quieta (p99 {flicker:.1f}, "
                f"max {flicker_max:.0f}, {changed_px} px cambian {where})"
            )
            state = "PARPADEO"
        if iou < 0.55:
            warnings.append(f"{sid}: solo {iou * 100:.0f}% de pixeles encendidos coinciden")

        print(
            f"    {sid:<7} {t:>7.2f} {shift_px:>8}px {corr:>6.2f} "
            f"{residual:>7.1f} {flicker:>9.1f} {changed_px:>8}  {state}"
        )


def check_frozen_and_black(frames, errors, warnings):
    f = frames.astype(np.float32)
    diffs = np.abs(np.diff(f, axis=0)).mean(axis=(1, 2))
    lum = f.mean(axis=(1, 2))

    frozen_run = int(MIN_FROZEN_S * ANALYSIS_FPS)
    run = 0
    run_start = 0
    worst = 0.0
    worst_span = (0.0, 0.0)
    for i, d in enumerate(diffs):
        if d < 0.05:
            if run == 0:
                run_start = i
            run += 1
            span = run / ANALYSIS_FPS
            if span > worst:
                worst = span
                worst_span = (run_start / ANALYSIS_FPS, (i + 1) / ANALYSIS_FPS)
        else:
            run = 0
    if worst >= MIN_FROZEN_S:
        errors.append(
            f"tramo congelado de {worst:.1f}s entre {worst_span[0]:.1f}s y "
            f"{worst_span[1]:.1f}s (umbral {MIN_FROZEN_S}s): nada se mueve en pantalla"
        )

    black_run = int(MAX_BLACK_S * ANALYSIS_FPS)
    run = 0
    worst_black = 0.0
    for value in lum:
        if value < 6.0:
            run += 1
            worst_black = max(worst_black, run / ANALYSIS_FPS)
        else:
            run = 0
    if worst_black >= MAX_BLACK_S:
        warnings.append(f"tramo negro de {worst_black:.1f}s (puede ser un fundido)")

    print(
        f"\n  global: {len(frames)} frames analizados · "
        f"movimiento medio {diffs.mean():.2f} · "
        f"tramo congelado max {worst:.1f}s · negro max {worst_black:.1f}s"
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--proyecto", required=True)
    ap.add_argument("--video", default=None)
    ap.add_argument(
        "--debug",
        nargs="?",
        const=".motion",
        default=None,
        help="guarda un PNG por escena con los pixeles que cambian (default: .motion/)",
    )
    args = ap.parse_args()

    project = Path(args.proyecto)
    global DEBUG_DIR
    if args.debug:
        DEBUG_DIR = (project / args.debug) if not Path(args.debug).is_absolute() else Path(args.debug)
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    timeline_path = project / "timeline.json"
    if not timeline_path.exists():
        print(f"ERROR: falta {timeline_path}")
        return 1

    video = Path(args.video) if args.video else project / "idupi-explainer-v2.mp4"
    if not video.exists():
        candidatos = sorted(project.glob("*.mp4"))
        if not candidatos:
            print("ERROR: no hay .mp4 en el proyecto")
            return 1
        video = candidatos[0]

    timeline = json.loads(timeline_path.read_text(encoding="utf-8"))
    print(f"== validacion de motion: {project.name}")
    print(f"   video: {video.name}")

    frames = gstream(video)
    errors, warnings = [], []

    check_scenes(project, frames, timeline, video, errors, warnings)
    check_frozen_and_black(frames, errors, warnings)

    print("\n" + "=" * 68)
    if warnings:
        print(f"{len(warnings)} aviso(s):")
        for w in warnings:
            print(f"  - {w}")
    if errors:
        print(f"\n{len(errors)} ERROR(es) — NO renderizar:")
        for e in errors:
            print(f"  - {e}")
        return 1

    print("motion correcto: cada escena termina en su keyframe y no parpadea")
    return 0


if __name__ == "__main__":
    sys.exit(main())

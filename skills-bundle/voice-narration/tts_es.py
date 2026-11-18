"""Spanish TTS pre-normalizer, sentence chunker, and per-take validated generator.

Prevents the two primary Chatterbox/Kokoro Spanish narration failure modes:
  1. Long-paragraph attention collapse causing gibberish tail loops (splits into
     short <=22-word chunks, validates each take with Whisper + tail check, retries
     failed takes automatically before assembling the scene WAV).
  2. English/acronym grapheme misreads (`JSON` -> "Juan", `GLM` -> "elem",
     `Claude` -> "te ha dado", `gpt-oss` -> "ebreteos") via ordered phonetic
     substitution + optional per-project glossary.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import tempfile
import urllib.request
import wave
from pathlib import Path
from typing import Callable

import numpy as np

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

import voz_validator as vv  # noqa: E402

# Ordered multi-word / compound rules first, then single-token acronyms/loanwords.
DEFAULT_PHONETIC_RULES: tuple[tuple[str, str], ...] = (
    (r"\bpull\s+requests?\b", lambda m: "pul ricuests" if m.group(0).lower().endswith("s") else "pul ricuest"),
    (r"\bCommand\s+Code\b", "Comán Coud"),
    (r"\bXiaomi\s+MiMo\b", "Shaómi Mimo"),
    (r"\bgentle-shell\b", "yéntel shel"),
    (r"\brun-bench\b", "ran bench"),
    (r"\bidu-pi\b", "idupi"),
    (r"\bwork-glm\b", "uork, ge, ele, eme"),
    (r"\bgpt-oss\b", "ge, pe, te, o, ese, ese"),
    (r"\bdeepseek\b", "díp sik"),
    (r"\bv(\d+)\b", lambda m: f"ve {m.group(1)}"),
    (r"-b\b", " be"),
    (r"\bconsult-openai\b", "consúlt óupen ei ái"),
    (r"\bconsult-gemini\b", "consúlt yémini"),
    (r"\bOpenRouter\b", "Óupen Rúter"),
    (r"\bOpenCode\b", "Óupen Coud"),
    (r"\bOpenAI\b", "Óupen Ei Ái"),
    (r"\bAnthropic\b", "Antrópic"),
    (r"\bAntigravity\b", "Antigráviti"),
    (r"\bXiaomi\b", "Shaómi"),
    (r"\bArtificial\s+Analysis\b", "Artifíshal Análisis"),
    (r"\bHydrogen\b", "Jáidroyen"),
    (r"\bArgon\b", "Árgon"),
    (r"\bClaude\s+Opus\b", "Clód, Ópus"),
    (r"\bClaude\b", "Clód"),
    (r"\bGemini\b", "Yémini"),
    (r"\bOpus\b", "Ópus"),
    (r"\bFlash\b", "Flash"),
    (r"\bpropose\b", "propóus"),
    (r"\boptimize\b", "óptimais"),
    (r"\bsandboxes\b", "sándboxes"),
    (r"\bsandbox\b", "sándbox"),
    (r"\bbackup\b", "bácap"),
    (r"\bissue\b", "íshu"),
    (r"\bequis-high\b", "equis jai"),
    (r"\bxhigh\b", "equis jai"),
    (r"\bhigh\b", "jai"),
    (r"\bJSON\b", "jota son"),
    (r"\bYAML\b", "yámel"),
    (r"\bHTML\b", "hache te eme ele"),
    (r"\bCLI\b", "ce ele i"),
    (r"\bMCP\b", "eme ce pe"),
    (r"\bAPI\b", "a pe i"),
    (r"\bUI\b", "u i"),
    (r"\bPRs\b", "pe erres"),
    (r"\bPR\b", "pe erre"),
    (r"\bWAV\b", "uav"),
    (r"\bMP4\b", "eme pe cuatro"),
    (r"\bGLM\b", "ge, ele, eme"),
    (r"\bGPT\b", "ge, pe, te"),
    (r"\bOSS\b", "o, ese, ese"),
    (r"\bPi\b", "Pí"),
    (r"\bglm\b", "ge, ele, eme"),
    (r"\bmimo\b", "mimo"),
    (r"\bopencode\b", "óupen coud"),
    (r"\btests\b", "test"),
)


def prepare_spanish_tts_text(text: str, glossary: dict[str, str] | None = None) -> str:
    """Rewrite acronyms, model slugs, and English loanwords into speakable Spanish."""
    out = text.strip()
    if glossary:
        # User/project glossary overrides run before built-in rules, longest keys first.
        for src in sorted(glossary.keys(), key=len, reverse=True):
            pattern = re.compile(rf"\b{re.escape(src)}\b", re.IGNORECASE)
            out = pattern.sub(glossary[src], out)

    for pattern_str, repl in DEFAULT_PHONETIC_RULES:
        out = re.sub(pattern_str, repl, out, flags=re.IGNORECASE if pattern_str.startswith(r"\b") and pattern_str[2].islower() else 0)

    # Read remaining kebab-case identifiers cleanly as spaced tokens rather than smashed syllables.
    out = re.sub(r"(?<=[A-Za-záéíóúÁÉÍÓÚ0-9])-(?=[A-Za-záéíóúÁÉÍÓÚ0-9])", " ", out)
    out = re.sub(r"\s*[—–]+\s*", ", ", out)
    out = re.sub(r"(,\s*){2,}", ", ", out)
    out = re.sub(r"\s+,", ",", out)
    out = re.sub(r"\s+", " ", out).strip()
    return out


def split_sentences_for_tts(text: str, max_words: int = 28) -> list[str]:
    """Split a paragraph into short, stable <=max_words Spanish TTS chunks."""
    cleaned = re.sub(r"\s+", " ", text.strip())
    if not cleaned:
        return []

    # Protect decimals like 28.5 or 3.8 before splitting on sentence terminators.
    protected = re.sub(r"(\d)\.(\d)", r"\1<DOT>\2", cleaned)
    raw_sentences = re.split(r"(?<=[.!?])\s+", protected)

    chunks: list[str] = []
    for sent in raw_sentences:
        s = sent.replace("<DOT>", ".").strip()
        if not s:
            continue
        words = s.split()
        if len(words) <= max_words:
            chunks.append(s)
            continue

        # Split over-long sentences along natural comma/colon/semicolon pauses.
        clauses = re.split(r"(?<=[,;:])\s+", s)
        buf = ""
        for clause in clauses:
            candidate = f"{buf} {clause}".strip() if buf else clause
            if len(candidate.split()) <= max_words:
                buf = candidate
            else:
                if buf:
                    chunks.append(buf)
                # Split long clauses near safe conjunctions/prepositions rather than mid-number.
                c_words = clause.split()
                while len(c_words) > max_words:
                    cut = max_words
                    safe = [
                        k for k in range(max(4, max_words // 2), min(len(c_words), max_words + 1))
                        if c_words[k].lower() in ("con", "frente", "porque", "cuando", "para", "mientras", "pero")
                    ]
                    if safe:
                        cut = safe[-1]
                    chunks.append(" ".join(c_words[:cut]))
                    c_words = c_words[cut:]
                buf = " ".join(c_words)
        if buf:
            chunks.append(buf)
    return chunks


def _apply_edge_fades(samples: np.ndarray, sr: int, fade_in_ms: int = 12, fade_out_ms: int = 35) -> np.ndarray:
    out = samples.astype(np.float32, copy=True)
    fi = min(len(out) // 4, int(fade_in_ms * sr / 1000))
    fo = min(len(out) // 3, int(fade_out_ms * sr / 1000))
    if fi > 0:
        out[:fi] *= np.linspace(0.0, 1.0, fi, dtype=np.float32)
    if fo > 0:
        out[-fo:] *= np.linspace(1.0, 0.0, fo, dtype=np.float32)
    return out


def trim_trailing_silence(
    samples: np.ndarray,
    sr: int,
    speech_threshold: float = 0.011,
    head_pad_ms: int = 25,
    pad_ms: int = 130,
    fade_ms: int = 35,
) -> np.ndarray:
    """Trim dead digital silence at head and tail while preserving natural speech + fades."""
    hop = max(1, int(0.020 * sr))
    if len(samples) <= hop:
        return samples

    audible = [
        i for i in range(0, len(samples) - hop + 1, hop)
        if float(np.sqrt(np.mean(samples[i:i + hop] ** 2))) >= speech_threshold
    ]
    if not audible:
        return samples

    start_sample = max(0, audible[0] - int(head_pad_ms * sr / 1000))
    end_sample = min(len(samples), audible[-1] + hop + int(pad_ms * sr / 1000))
    return _apply_edge_fades(samples[start_sample:end_sample], sr, fade_in_ms=12, fade_out_ms=fade_ms)


def trim_chunk_boundaries_verified(
    samples: np.ndarray,
    sr: int,
    ref_chunk: str,
    run_stt_fn: Callable[[Path], str | None],
    work_dir: Path,
    tag: str,
) -> tuple[np.ndarray, str | None, dict[str, bool]]:
    """Trim dead silence plus STT-verified detached head/tail pops, gasps, or buzzes."""
    cleaned = trim_trailing_silence(samples, sr)
    base_wav = work_dir / f"{tag}_base.wav"
    write_pcm16_wav(base_wav, cleaned, sr)
    hyp = run_stt_fn(base_wav)
    meta = {"trimmed_leading": False, "trimmed_trailing": False}

    if hyp is None or not ref_chunk.strip():
        return cleaned, hyp, meta

    base_al = vv.align_transcript(ref_chunk, hyp)
    base_tokens = vv.canonicalize_es_tokens(hyp)
    ref_tokens = vv.canonicalize_es_tokens(ref_chunk)
    bounds = vv.find_chunk_boundary_artifacts(cleaned, sr)

    def _keeps_all_words(cand_wave: np.ndarray, cand_tag: str, side: str) -> tuple[bool, str | None, dict | None]:
        cand_wav = work_dir / f"{tag}_{cand_tag}.wav"
        write_pcm16_wav(cand_wav, cand_wave, sr)
        cand_hyp = run_stt_fn(cand_wav)
        if cand_hyp is None:
            return False, None, None
        cand_al = vv.align_transcript(ref_chunk, cand_hyp)
        if len(cand_al["missing_anchors"]) > len(base_al["missing_anchors"]):
            return False, None, None

        cand_tokens = vv.canonicalize_es_tokens(cand_hyp)
        if cand_tokens == base_tokens:
            return True, cand_hyp, cand_al

        # Allow stripping ONLY a single stray hallucinated filler token (multi-word hallucinations retry cleanly).
        if side == "trailing":
            dropped = base_tokens[len(cand_tokens):]
            is_clean_prefix = (
                len(dropped) == 1
                and cand_tokens == base_tokens[:len(cand_tokens)]
                and cand_al["wer"] < base_al["wer"]
                and dropped[0] in base_al["tail_insertions"]
            )
            return bool(is_clean_prefix), cand_hyp, cand_al

        # Leading side: never trim a prefix token if any leading reference token disappears.
        lead_drop = len(base_tokens) - len(cand_tokens)
        is_clean_suffix = (
            lead_drop == 1
            and cand_tokens == base_tokens[lead_drop:]
            and cand_al["wer"] < base_al["wer"]
            and not any(tok in ref_tokens[:2] for tok in base_tokens[:lead_drop])
        )
        return bool(is_clean_suffix), cand_hyp, cand_al

    tail_candidates = bounds.get("trailing_cut_candidates") or (
        [bounds["trailing_cut_sample"]] if bounds.get("trailing_cut_sample") else []
    )
    for k, tail_cut in enumerate(tail_candidates):
        if not tail_cut or tail_cut <= int(0.6 * sr):
            continue
        end_idx = min(len(cleaned), tail_cut + int(0.05 * sr))
        cand = _apply_edge_fades(cleaned[:end_idx], sr, fade_in_ms=12, fade_out_ms=35)
        ok, cand_hyp, cand_al = _keeps_all_words(cand, f"notail_{k}", "trailing")
        if ok and cand_al is not None and cand_hyp is not None:
            cleaned = cand
            hyp = cand_hyp
            base_al = cand_al
            base_tokens = vv.canonicalize_es_tokens(hyp)
            meta["trimmed_trailing"] = True
            bounds = vv.find_chunk_boundary_artifacts(cleaned, sr)
            break

    lead_candidates = bounds.get("leading_cut_candidates") or (
        [bounds["leading_cut_sample"]] if bounds.get("leading_cut_sample") else []
    )
    for k, lead_cut in enumerate(lead_candidates):
        if not lead_cut or len(cleaned) - lead_cut <= int(0.6 * sr):
            continue
        cand = _apply_edge_fades(cleaned[lead_cut:], sr, fade_in_ms=14, fade_out_ms=35)
        ok, cand_hyp, cand_al = _keeps_all_words(cand, f"nolead_{k}", "leading")
        if ok and cand_al is not None and cand_hyp is not None:
            cleaned = cand
            hyp = cand_hyp
            meta["trimmed_leading"] = True
            break

    return cleaned, hyp, meta


def write_pcm16_wav(path: Path, samples: np.ndarray, sr: int) -> None:
    """Write mono float [-1, 1] numpy samples to a 16-bit PCM WAV."""
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.clip(np.round(samples * 32767.0), -32768, 32767).astype(np.int16)
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sr)
        f.writeframes(pcm.tobytes())


def read_pcm16_wav(path: Path) -> tuple[np.ndarray, int]:
    """Read mono float [-1, 1] numpy array and sample rate from a PCM16 WAV."""
    with wave.open(str(path), "rb") as f:
        sr = f.getframerate()
        n = f.getnframes()
        ch = f.getnchannels()
        raw = f.readframes(n)
    a = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        a = a.reshape(-1, ch).mean(axis=1)
    return a, sr


def synthesize_validated_clip(
    scene_id: str,
    script_text: str,
    out_wav: Path,
    synthesize_chunk_fn: Callable[[str, int], tuple[np.ndarray, int]],
    *,
    backup_dir: Path | None = None,
    glossary: dict[str, str] | None = None,
    max_words: int = 28,
    max_retries: int = 4,
    pause_ms: int = 160,
    stt_python: str | None = None,
    require_stt: bool = True,
    wer_error: float = vv.DEFAULT_WER_ERROR,
    transcribe_fn: Callable[[Path], str] | None = None,
) -> dict:
    """Generate a Spanish scene clip sentence-by-sentence with automatic validation/retry.

    Returns a dictionary containing `scene_id`, `duration_s`, `chunks`, `verdict`,
    and `passed` (`True` unless all attempts failed validation).
    """
    ref_chunks = split_sentences_for_tts(script_text, max_words=max_words or 28)
    if not ref_chunks:
        raise ValueError(f"{scene_id}: empty script text")

    if transcribe_fn is None and require_stt:
        resolved = vv.discover_stt_python(stt_python)
        if not resolved and not vv._voicebox_health_url():
            raise RuntimeError(
                "STT runtime required for validated synthesis (set IDU_STT_PYTHON or run Voicebox)."
            )

    def _run_stt(wav_path: Path) -> str | None:
        if transcribe_fn is not None:
            return transcribe_fn(wav_path)
        if not require_stt and not vv.discover_stt_python(stt_python) and not vv._voicebox_health_url():
            return None
        res_map, _ = vv.transcribe_clips([wav_path], stt_python=stt_python)
        return res_map[str(wav_path)]

    accepted_waves: list[np.ndarray] = []
    sample_rate: int | None = None
    chunk_reports: list[dict] = []

    with tempfile.TemporaryDirectory(prefix=f"idu-tts-{scene_id}-") as tmp_dir:
        tmp = Path(tmp_dir)
        for idx, ref_chunk in enumerate(ref_chunks, start=1):
            tts_chunk = prepare_spanish_tts_text(ref_chunk, glossary=glossary)
            best_report: dict | None = None
            best_wave: np.ndarray | None = None
            best_score: tuple | None = None

            for attempt in range(1, max_retries + 1):
                wav_arr, sr = synthesize_chunk_fn(tts_chunk, attempt)
                sample_rate = sample_rate or sr
                raw_chunk = np.asarray(wav_arr, dtype=np.float32)
                cleaned, hyp, trim_meta = trim_chunk_boundaries_verified(
                    raw_chunk,
                    sr,
                    ref_chunk,
                    _run_stt,
                    tmp,
                    f"{scene_id}_c{idx}_a{attempt}",
                )

                has_click, _ = vv.find_tail_click(cleaned, sr)
                tail = vv.find_tail_anomaly(cleaned, sr)
                # Chunk-level WER uses relaxed error bar vs full clip, while clicks & tail hallucinations stay strict.
                verdict = vv.evaluate_clip_speech(
                    ref_chunk,
                    hyp,
                    tail,
                    wer_warn=0.30,
                    wer_error=max(wer_error, 0.48),
                    has_click=has_click,
                )
                report = {
                    "chunk": idx,
                    "attempt": attempt,
                    "expected": ref_chunk,
                    "tts_input": tts_chunk,
                    "transcript": hyp,
                    "trimmed": trim_meta,
                    "tail": tail,
                    "verdict": verdict["verdict"],
                    "errors": verdict["errors"],
                    "warnings": verdict["warnings"],
                    "wer": verdict["alignment"]["wer"] if verdict["alignment"] else None,
                }
                score = (
                    len(report["errors"]),
                    len(verdict["alignment"]["tail_insertions"]) if verdict["alignment"] else 0,
                    1 if tail.get("has_anomaly") else 0,
                    report["wer"] if report["wer"] is not None else 1.0,
                )
                if best_report is None or score < best_score:
                    best_score = score
                    best_report = report
                    best_wave = cleaned
                if verdict["verdict"] != "block":
                    best_report = report
                    best_wave = cleaned
                    break

            assert best_wave is not None and best_report is not None
            accepted_waves.append(best_wave)
            chunk_reports.append(best_report)

    assert sample_rate is not None
    pause_samples = np.zeros(int(pause_ms * sample_rate / 1000), dtype=np.float32)
    pieces: list[np.ndarray] = []
    for k, w in enumerate(accepted_waves):
        if k > 0 and len(pause_samples) > 0:
            pieces.append(pause_samples)
        pieces.append(w)
    full_wave = np.concatenate(pieces) if len(pieces) > 1 else pieces[0]

    write_pcm16_wav(out_wav, full_wave, sample_rate)
    if backup_dir is not None:
        backup_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(out_wav, backup_dir / out_wav.name)

    full_has_click, _ = vv.find_tail_click(full_wave, sample_rate)
    full_tail = vv.find_tail_anomaly(full_wave, sample_rate)
    full_hyp = _run_stt(out_wav)
    full_eval = vv.evaluate_clip_speech(
        script_text,
        full_hyp,
        full_tail,
        wer_error=wer_error,
        has_click=full_has_click,
    )

    return {
        "scene_id": scene_id,
        "wav": str(out_wav),
        "duration_s": round(len(full_wave) / sample_rate, 4),
        "chunks": chunk_reports,
        "transcript": full_hyp,
        "tail": full_tail,
        "verdict": full_eval["verdict"],
        "errors": full_eval["errors"],
        "warnings": full_eval["warnings"],
        "wer": full_eval["alignment"]["wer"] if full_eval["alignment"] else None,
        "passed": full_eval["verdict"] != "block",
    }


def load_glossary(path: Path | None) -> dict[str, str]:
    """Load optional JSON object mapping raw script phrases -> Spanish phonetic strings."""
    if path is None or not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"Glossary must be a JSON object: {path}")
    return {str(k): str(v) for k, v in data.items()}


def voicebox_http_chunk_fn(
    profile_id: str,
    engine: str = "chatterbox",
    language: str = "es",
    base_url: str = "http://127.0.0.1:17493",
) -> Callable[[str, int], tuple[np.ndarray, int]]:
    """Return a synthesize_chunk_fn calling local Voicebox HTTP `/generate` + `/audio/{id}`."""
    base = base_url.rstrip("/")

    def _gen(text: str, attempt: int) -> tuple[np.ndarray, int]:
        payload = json.dumps({
            "profile_id": profile_id,
            "text": text,
            "language": language,
            "engine": engine,
            "seed": 1000 + attempt * 97,
        }).encode("utf-8")
        req = urllib.request.Request(
            f"{base}/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            meta = json.loads(resp.read().decode("utf-8"))
        gen_id = meta["id"]

        # Poll SSE status stream until completed/failed.
        status_req = urllib.request.Request(f"{base}/generate/{gen_id}/status")
        with urllib.request.urlopen(status_req, timeout=180) as sresp:
            for raw in sresp:
                line = raw.decode("utf-8", errors="replace").strip()
                if not line.startswith("data: "):
                    continue
                evt = json.loads(line[6:])
                if evt.get("status") == "failed":
                    raise RuntimeError(f"Voicebox generation failed: {evt.get('error')}")
                if evt.get("status") == "completed":
                    break

        with urllib.request.urlopen(f"{base}/audio/{gen_id}", timeout=60) as aresp:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
                tmp.write(aresp.read())
                tmp_path = Path(tmp.name)
        try:
            return read_pcm16_wav(tmp_path)
        finally:
            tmp_path.unlink(missing_ok=True)

    return _gen


def main() -> int:
    ap = argparse.ArgumentParser(description="Prepare Spanish TTS script or preview phonetic chunks.")
    ap.add_argument("--guion", help="Path to guion.md to inspect/normalize")
    ap.add_argument("--glossary", help="Optional JSON pronunciation dictionary")
    ap.add_argument("--max-words", type=int, default=28)
    args = ap.parse_args()

    glossary = load_glossary(Path(args.glossary)) if args.glossary else {}
    if not args.guion:
        ap.print_help()
        return 1

    scenes = vv.parse_guion_markdown(Path(args.guion))
    for sid, entry in scenes.items():
        print(f"=== {sid} · {entry['title']} ===")
        for idx, chunk in enumerate(split_sentences_for_tts(entry["text"], max_words=args.max_words), start=1):
            print(f"  [{idx}] REF: {chunk}")
            print(f"      TTS: {prepare_spanish_tts_text(chunk, glossary=glossary)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

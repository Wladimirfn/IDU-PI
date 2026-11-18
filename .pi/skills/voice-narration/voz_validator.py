"""Speech-to-Text (Whisper) and tail-anomaly validation for Spanish narration clips.

Catches the failures amplitude/click checks miss:
  1. Trailing TTS hallucinations or extra spoken words after the script ends
     (for example Chatterbox inventing words at the end of a long sentence).
  2. Multi-second trailing breath/growl/rumble artifacts masked by micro-fades.
  3. Garbled technical acronyms, proper nouns, or high word-error rates against guion.md.

Runs offline against cached `openai/whisper-base` (either in-process via transformers
or by discovering the local voicebox virtualenv / Voicebox HTTP server).
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
import urllib.error
import urllib.request
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np

WHISPER_SAMPLE_RATE = 16000
DEFAULT_WHISPER_MODEL = "openai/whisper-base"

DEFAULT_WER_WARN = 0.24
DEFAULT_WER_ERROR = 0.36
MAX_TAIL_INSERT_WORDS = 2

_UNITS = {
    "cero": 0, "uno": 1, "dos": 2, "tres": 3, "cuatro": 4,
    "cinco": 5, "seis": 6, "siete": 7, "ocho": 8, "nueve": 9,
}
_TEENS = {
    "diez": 10, "once": 11, "doce": 12, "trece": 13, "catorce": 14, "quince": 15,
    "dieciseis": 16, "diecisiete": 17, "dieciocho": 18, "diecinueve": 19,
    "veinte": 20, "veintiuno": 21, "veintidos": 22, "veintitres": 23,
    "veinticuatro": 24, "veinticinco": 25, "veintiseis": 26, "veintisiete": 27,
    "veintiocho": 28, "veintinueve": 29,
}
_TENS = {
    "treinta": 30, "cuarenta": 40, "cincuenta": 50, "sesenta": 60,
    "setenta": 70, "ochenta": 80, "noventa": 90,
}
_HUNDREDS = {
    "cien": 100, "ciento": 100, "doscientos": 200, "trescientos": 300,
    "cuatrocientos": 400, "quinientos": 500, "seiscientos": 600,
    "setecientos": 700, "ochocientos": 800, "novecientos": 900,
}

# Phonetic renderings that satisfy technical anchors when pronounced cleanly in Spanish.
PHONETIC_EQUIVALENTS: dict[str, tuple[str, ...]] = {
    "json": ("json", "jotason", "yotason", "yeison"),
    "idupi": ("idupi", "idupii", "idu pi", "y dupi", "ydupi"),
    "openai": ("openai", "openi", "openay", "upenay", "oupen ei ai"),
    "claude": ("claude", "clod", "claud", "clot"),
    "deepseek": ("deepseek", "dipsik", "deepsick", "deep seek"),
    "xiaomi": ("xiaomi", "shaomi", "siaomi"),
    "gemini": ("gemini", "yemini", "jemini"),
    "hydrogen": ("hydrogen", "jaidroyen", "jaidrochen", "hidrogen", "hydrochen"),
    "glm": ("glm", "ge ele eme", "glem", "geleme"),
    "gpt": ("gpt", "ge pe te"),
    "oss": ("oss", "o ese ese"),
    "cli": ("cli", "ce ele i"),
    "pull": ("pull", "pul"),
    "request": ("request", "ricuest"),
    "backup": ("backup", "bacap", "back up"),
    "command": ("command", "coman"),
    "code": ("code", "coud", "cout"),
    "antigravity": ("antigravity", "anti gravity", "antigraviti"),
    "openrouter": ("openrouter", "open router", "openruter", "oupen ruter"),
    "opencode": ("opencode", "open code", "oupencoud"),
    "anthropic": ("anthropic", "antropic", "antropik"),
    "work": ("work", "uork", "worg"),
    "gentle": ("gentle", "yentel", "yentle"),
    "shell": ("shell", "shel", "gentleshell"),
    "v4": ("v4", "ve4", "v 4", "ve 4", "ve cuatro"),
    "high": ("high", "jai"),
    "equis": ("equis", "x"),
    "propose": ("propose", "propous", "propos"),
    "benchmark": ("benchmark", "bench"),
    "run": ("run", "ran"),
    "bench": ("bench",),
}

_SPANISH_STOPWORDS = frozenset({
    "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al",
    "a", "en", "y", "o", "u", "e", "con", "sin", "por", "para", "que", "como",
    "se", "su", "sus", "tu", "tus", "te", "me", "nos", "es", "son", "fue",
    "era", "mas", "pero", "si", "no", "ni", "cuando", "donde", "cada", "todo",
    "toda", "todos", "todas", "este", "esta", "estos", "estas", "ese", "esa",
    "esos", "esas", "eso", "lo", "le", "les", "hay", "muy", "ya", "solo",
    "sobre", "entre", "hasta", "antes", "despues", "tras", "bajo", "frente",
    "mientras", "tanto", "junto", "menos", "apenas", "mas", "vez", "solo",
    "paso", "punto", "regla", "etapa", "dos", "tres", "cuatro", "uno", "cien",
})


def strip_accents(text: str) -> str:
    """Fold Unicode accents while keeping ASCII alphanumerics intact."""
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(c for c in decomposed if unicodedata.category(c) != "Mn")


def sha256_file(path: Path) -> str:
    """Return hex SHA-256 of a file."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def parse_guion_markdown(path: Path) -> dict[str, dict[str, str]]:
    """Parse scenes (e.g. `### e01 · Title` or `### vo1`) from a guion.md file."""
    text = path.read_text(encoding="utf-8", errors="replace")
    sections: dict[str, dict[str, str]] = {}
    cur_id: str | None = None
    cur_title = ""
    buf: list[str] = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        m = re.match(r"^#{2,4}\s+((?:e|vo)\d{1,3})\b(?:\s*[·:\-–—]\s*(.+))?$", line, re.IGNORECASE)
        if m:
            if cur_id is not None:
                sections[cur_id] = {"title": cur_title, "text": " ".join(buf).strip()}
            cur_id = m.group(1).lower()
            cur_title = (m.group(2) or "").strip()
            buf = []
        elif cur_id is not None and line and not line.startswith("#") and not line.startswith("<!--"):
            buf.append(line)

    if cur_id is not None:
        sections[cur_id] = {"title": cur_title, "text": " ".join(buf).strip()}
    return sections


def _parse_spanish_number(tokens: list[str], idx: int) -> tuple[str | None, int]:
    """Consume a Spanish cardinal phrase at `tokens[idx]` -> (digits_str, next_idx)."""
    n = len(tokens)
    w = tokens[idx]
    if w in _UNITS:
        if idx + 1 < n and tokens[idx + 1] == "mil":
            rest_val, next_i = _parse_sub_thousand(tokens, idx + 2)
            return str(_UNITS[w] * 1000 + rest_val), next_i
        return str(_UNITS[w]), idx + 1
    if w in _TEENS:
        if idx + 1 < n and tokens[idx + 1] == "mil":
            rest_val, next_i = _parse_sub_thousand(tokens, idx + 2)
            return str(_TEENS[w] * 1000 + rest_val), next_i
        return str(_TEENS[w]), idx + 1
    if w in _TENS or w in _HUNDREDS:
        val, next_i = _parse_sub_thousand(tokens, idx)
        if next_i < n and tokens[next_i] == "mil":
            rest_val, final_i = _parse_sub_thousand(tokens, next_i + 1)
            return str(val * 1000 + rest_val), final_i
        return str(val), next_i
    if w == "mil":
        rest_val, next_i = _parse_sub_thousand(tokens, idx + 1)
        return str(1000 + rest_val), next_i
    return None, idx


def _parse_sub_thousand(tokens: list[str], idx: int) -> tuple[int, int]:
    n = len(tokens)
    if idx >= n:
        return 0, idx
    total = 0
    i = idx
    if tokens[i] in _HUNDREDS:
        if tokens[i] == "cien":
            return 100, i + 1
        total += _HUNDREDS[tokens[i]]
        i += 1
    if i < n and tokens[i] in _TENS:
        total += _TENS[tokens[i]]
        i += 1
        if i + 1 < n and tokens[i] == "y" and tokens[i + 1] in _UNITS:
            total += _UNITS[tokens[i + 1]]
            i += 2
        return total, i
    if i < n and tokens[i] in _TEENS:
        return total + _TEENS[tokens[i]], i + 1
    if i < n and tokens[i] in _UNITS:
        return total + _UNITS[tokens[i]], i + 1
    return total, i


def canonicalize_es_tokens(text: str) -> list[str]:
    """Normalize Spanish text + numerals + percentages for fair ASR comparison."""
    s = strip_accents(text.lower())
    s = re.sub(r"(\d+)\s*%", r"\1 por ciento", s)
    s = re.sub(r"(\d+)[.,](\d+)", r"\1 coma \2", s)
    s = s.replace("$", " pesos ")
    s = re.sub(r"([a-z])(\d)", r"\1 \2", s)
    s = re.sub(r"(\d)([a-z])", r"\1 \2", s)
    raw = re.findall(r"[a-z0-9]+", s)

    # Collapse numeric phrases into canonical digit strings.
    out: list[str] = []
    i = 0
    while i < len(raw):
        num_str, next_i = _parse_spanish_number(raw, i)
        if num_str is not None:
            out.append(num_str)
            i = next_i
        else:
            out.append(raw[i])
            i += 1

    # Collapse mixed tens + "y" + unit digits from ASR ("50 y 3" -> "53", "60 y 1" -> "61")
    # and drop "coma"/"punto" decimal connector when flanked by numbers.
    merged: list[str] = []
    idx = 0
    while idx < len(out):
        if (
            idx + 2 < len(out)
            and out[idx].isdigit()
            and out[idx + 1] == "y"
            and out[idx + 2].isdigit()
            and int(out[idx]) in (20, 30, 40, 50, 60, 70, 80, 90)
            and 1 <= int(out[idx + 2]) <= 9
        ):
            merged.append(str(int(out[idx]) + int(out[idx + 2])))
            idx += 3
            continue
        merged.append(out[idx])
        idx += 1

    collapsed: list[str] = []
    for k, tok in enumerate(merged):
        if (
            tok in ("coma", "punto")
            and k > 0
            and k + 1 < len(merged)
            and merged[k - 1].isdigit()
            and merged[k + 1].isdigit()
        ):
            continue
        collapsed.append(tok)
    return collapsed


def _best_token_similarity(
    target: str,
    hyp_tokens: list[str],
    contextual_en_pi: bool = False,
) -> tuple[float, str]:
    """Check if `target` (or a phonetic alias) appears in 1..4-gram windows of hyp_tokens."""
    candidates = PHONETIC_EQUIVALENTS.get(target, (target,))
    best_score = 0.0
    best_span = ""
    n = len(hyp_tokens)
    for start in range(n):
        for width in (1, 2, 3, 4):
            if start + width > n:
                break
            chunk_words = hyp_tokens[start:start + width]
            joined = "".join(chunk_words)
            spaced = " ".join(chunk_words)
            if target == "pi" and (
                joined in ("enp", "inp")
                or (contextual_en_pi and (joined == "mp" or (width == 1 and joined.endswith("mp"))))
            ):
                return 0.90, spaced
            for cand in candidates:
                cand_compact = cand.replace(" ", "")
                if cand_compact == joined:
                    return 1.0, spaced
                if len(cand_compact) >= 4 and width == 1 and (
                    cand_compact in joined or (len(cand_compact) >= 6 and joined.startswith(cand_compact))
                ):
                    return 0.92, spaced
                if len(cand_compact) >= 3 and width == 1 and (
                    joined.startswith(cand_compact) or joined.endswith(cand_compact)
                ):
                    return 0.88, spaced
                score = max(
                    SequenceMatcher(None, cand_compact, joined).ratio(),
                    SequenceMatcher(None, cand, spaced).ratio(),
                )
                if score > best_score:
                    best_score = score
                    best_span = spaced
    return best_score, best_span


_KNOWN_TECH_ACRONYMS = frozenset({
    "glm", "gpt", "oss", "json", "cli", "api", "mcp", "html", "yaml",
})


def extract_critical_tokens(ref_text: str) -> list[str]:
    """Extract high-signal technical anchors (acronyms, model names, code slugs, big numbers)."""
    anchors: list[str] = []
    seen: set[str] = set()

    def add(tok: str) -> None:
        clean = strip_accents(tok.lower()).strip("-")
        if len(clean) >= 2 and clean not in _SPANISH_STOPWORDS and clean not in seen:
            seen.add(clean)
            anchors.append(clean)

    # 1. Explicit uppercase acronyms (JSON, CLI, PR, API...) or known lowercase acronyms
    for m in re.finditer(r"\b[A-ZÁÉÍÓÚ]{2,}\b", ref_text):
        add(m.group(0))
    for tok in re.findall(r"[a-zA-Z0-9]+", ref_text.lower()):
        if tok in _KNOWN_TECH_ACRONYMS:
            add(tok)

    # 2. Hyphenated identifiers (idu-pi -> idupi, gpt-oss, work-glm, deepseek-v4-flash)
    number_words = set(_UNITS) | set(_TEENS) | set(_TENS) | set(_HUNDREDS) | {"mil"}
    for m in re.finditer(r"\b[a-zA-Z]+(?:-[a-zA-Z0-9]+)+\b", ref_text):
        slug = strip_accents(m.group(0).lower())
        if slug == "idu-pi":
            add("idupi")
            continue
        for part in m.group(0).split("-"):
            low = strip_accents(part.lower())
            if part and not part.isdigit() and low not in number_words:
                add(part)

    # 3. Non-initial capitalized proper names (Claude, Gemini, OpenAI, Xiaomi...)
    sentences = re.split(r"(?<=[.!?¿¡:])\s+", ref_text.strip())
    for sent in sentences:
        words = re.findall(r"[A-Za-zÁÉÍÓÚáéíóúÜüÑñ0-9]+", sent)
        for idx, word in enumerate(words):
            if idx == 0:
                continue
            if any(c.isupper() for c in word):
                add(word)

    # 4. Canonicalized multi-digit numbers (excluding small ordinals 0..9)
    for tok in canonicalize_es_tokens(ref_text):
        if tok.isdigit() and len(tok) >= 2:
            add(tok)

    return anchors


def align_transcript(ref_text: str, hyp_text: str) -> dict:
    """Compare Whisper transcription against reference script and isolate defects."""
    rw = canonicalize_es_tokens(ref_text)
    hw = canonicalize_es_tokens(hyp_text)
    sm = SequenceMatcher(None, rw, hw, autojunk=False)

    opcodes = sm.get_opcodes()
    subs = ins = dels = 0
    diffs: list[dict] = []
    tail_insertions: list[str] = []
    omitted_content: list[str] = []
    severe_mismatches: list[dict] = []

    ref_len = max(1, len(rw))
    for tag, i1, i2, j1, j2 in opcodes:
        if tag == "equal":
            continue
        ref_span = rw[i1:i2]
        hyp_span = hw[j1:j2]
        diffs.append({
            "op": tag,
            "ref": " ".join(ref_span),
            "hyp": " ".join(hyp_span),
        })
        if tag == "replace":
            subs += max(i2 - i1, j2 - j1)
            ref_joined = "".join(ref_span)
            hyp_joined = "".join(hyp_span)
            sim = SequenceMatcher(None, ref_joined, hyp_joined).ratio()
            # Flag complete phonetic divergence on multi-word/long tokens.
            if sim < 0.42 and (len(ref_joined) >= 6 or (i2 - i1) >= 2):
                severe_mismatches.append({
                    "ref": " ".join(ref_span),
                    "hyp": " ".join(hyp_span),
                    "similarity": round(sim, 3),
                })
        elif tag == "insert":
            ins += j2 - j1
            # Extra words right at or after the last 2 reference words indicate end hallucination.
            if i1 >= len(rw) - 1:
                tail_insertions.extend(hyp_span)
        elif tag == "delete":
            dels += i2 - i1
            content = [w for w in ref_span if w not in _SPANISH_STOPWORDS]
            if len(content) >= 2:
                omitted_content.append(" ".join(ref_span))

    # Also treat tail replacements that explode word count (+2 or more extra words at EOF) as tail insertions.
    if opcodes:
        last_tag, i1, i2, j1, j2 = opcodes[-1]
        if last_tag == "replace" and i2 >= len(rw) - 1:
            excess = (j2 - j1) - (i2 - i1)
            if excess >= MAX_TAIL_INSERT_WORDS:
                tail_insertions.extend(hw[j1 + (i2 - i1):j2])

    wer = (subs + ins + dels) / ref_len

    anchors = extract_critical_tokens(ref_text)
    has_en_pi = any(rw[idx] == "en" and rw[idx + 1] == "pi" for idx in range(len(rw) - 1))
    missing_anchors: list[dict] = []
    for anchor in anchors:
        if anchor.isdigit():
            if anchor not in hw:
                missing_anchors.append({"token": anchor, "best_match": "", "score": 0.0})
            continue
        score, match = _best_token_similarity(anchor, hw, contextual_en_pi=has_en_pi)
        min_score = 0.68 if len(anchor) >= 5 else 0.82
        if score < min_score:
            missing_anchors.append({
                "token": anchor,
                "best_match": match,
                "score": round(score, 3),
            })

    return {
        "ref_words": len(rw),
        "hyp_words": len(hw),
        "wer": round(wer, 3),
        "tail_insertions": tail_insertions,
        "omitted_content": omitted_content,
        "missing_anchors": missing_anchors,
        "severe_mismatches": severe_mismatches,
        "diffs": diffs,
    }


CLICK_RATIO = 5.0
CLICK_MAX_MS = 40


def find_tail_click(a: np.ndarray, sr: int) -> tuple[bool, float]:
    """Return `(has_click, tail_rms)` detecting <40ms bursts >=5x neighbours in EOF window."""
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
            floor = peak / CLICK_RATIO
            lo = hi = i
            while lo > 0 and seg[lo - 1] >= floor:
                lo -= 1
            while hi < len(seg) - 1 and seg[hi + 1] >= floor:
                hi += 1
            if (hi - lo + 1) * 10 < CLICK_MAX_MS:
                return True, tail_rms

    return False, tail_rms


def find_chunk_boundary_artifacts(a: np.ndarray, sr: int) -> dict:
    """Detect detached leading pops/fillers and trailing breath/chirp islands on chunks.

    Operates in 20 ms hops without minimum 3.5 s clip restriction so individual sentence
    chunks can have stray boundary noises trimmed and STT-verified before concatenation.
    Uses >=80 ms valleys to avoid mistaking voiceless /p,t,k/ stop closures for breaks,
    and returns ordered candidate cut points (earliest first) so multi-puff tails collapse.
    """
    hop = max(1, int(0.020 * sr))
    if sr <= 0 or len(a) < hop * 25:  # < 0.5s
        return {
            "leading_cut_sample": None,
            "trailing_cut_sample": None,
            "leading_cut_candidates": [],
            "trailing_cut_candidates": [],
        }

    frames = np.array([
        float(np.sqrt(np.mean(a[i:i + hop] ** 2)))
        for i in range(0, len(a) - hop + 1, hop)
    ])
    if float(np.max(frames)) < 0.04:
        return {
            "leading_cut_sample": None,
            "trailing_cut_sample": None,
            "leading_cut_candidates": [],
            "trailing_cut_candidates": [],
        }

    strong = [i for i, v in enumerate(frames) if v >= 0.045]
    if not strong:
        return {
            "leading_cut_sample": None,
            "trailing_cut_sample": None,
            "leading_cut_candidates": [],
            "trailing_cut_candidates": [],
        }

    leading_candidates: list[int] = []
    # Scan first 1.2s for a brief pre-onset puff separated by >=80ms quiet valley.
    head_limit = min(len(frames), 60)
    valley = 0
    saw_puff = False
    for idx in range(head_limit):
        v = frames[idx]
        if v >= 0.012 and valley == 0:
            saw_puff = True
        elif saw_puff and v < 0.015:
            valley += 1
        elif saw_puff and v >= 0.015 and valley > 0:
            if valley >= 4 and idx <= 55:  # >= 80ms gap before real onset (<1.1s)
                leading_candidates.append(max(0, (idx - 1) * hop))
                break
            if v >= 0.045:
                break
            valley = 0

    trailing_candidates: list[int] = []
    # Scan last 4.4s (never skipping >2s groans) for quiet valleys followed by audible tail sound.
    scan_from = max(strong[0] + 6, len(frames) - 220)
    last_strong = strong[-1]
    valley = 0
    cur_start = -1
    saw_main = any(frames[i] >= 0.045 for i in range(0, min(len(frames), scan_from + 1)))
    min_spacing = max(1, int(0.080 * sr))
    for idx in range(scan_from, len(frames)):
        v = frames[idx]
        if v >= 0.045:
            saw_main = True
            valley = 0
            cur_start = -1
        elif saw_main and v < 0.015:
            if valley == 0:
                cur_start = idx
            valley += 1
            after = frames[idx + 1:]
            has_tail_energy = len(after) > 0 and any(x >= 0.010 for x in after)
            is_low_hum_tail = idx > last_strong and valley >= 2 and v < 0.012 and len(after) > 0 and float(np.max(after)) < 0.045
            if has_tail_energy and (valley >= 4 or is_low_hum_tail) and cur_start >= 0:
                cut = min(len(a), (cur_start + 1) * hop)
                if not trailing_candidates or cut - trailing_candidates[-1] >= min_spacing:
                    trailing_candidates.append(cut)
        elif saw_main and v >= 0.015 and valley > 0:
            valley = 0
            cur_start = -1

    return {
        "leading_cut_sample": leading_candidates[0] if leading_candidates else None,
        "trailing_cut_sample": trailing_candidates[0] if trailing_candidates else None,
        "leading_cut_candidates": leading_candidates,
        "trailing_cut_candidates": trailing_candidates,
    }


def find_tail_anomaly(a: np.ndarray, sr: int) -> dict:
    """Detect trailing hallucinations, long breath/growl tails, or masked pre-fade bursts.

    Unlike `<40ms` click detection, this inspects 50 ms RMS windows over the last 4.5 s:
      - `tail_gap_burst`: a >=250 ms quiet drop (<0.012 RMS) followed by a >=300 ms
        active tail island (>=0.020 RMS) or loud burst (>=0.080 RMS for >=150 ms).
      - `tail_sustained_noise`: >=700 ms of audible breath/hum (>0.012 RMS, <=0.14 max)
        continuing to within 300 ms of EOF after speech has finished.
      - `masked_pre_fade`: final 20 ms zeroed (<0.002) right after rising un-decayed energy.
    """
    hop = int(0.050 * sr)
    dur = len(a) / sr if sr > 0 else 0.0
    if dur < 3.5 or len(a) < hop * 20:
        return {
            "has_anomaly": False,
            "kind": None,
            "tail_gap_burst": False,
            "tail_sustained_noise": False,
            "masked_pre_fade": False,
            "gap_at_s": None,
            "gap_duration_ms": 0,
            "burst_duration_ms": 0,
            "burst_peak_rms": 0.0,
        }

    frames = np.array([
        float(np.sqrt(np.mean(a[i:i + hop] ** 2)))
        for i in range(0, len(a) - hop + 1, hop)
    ])

    # Only scan after the clip has established clear main speech energy.
    overall_peak = float(np.max(frames)) if len(frames) else 0.0
    if overall_peak < 0.05:
        return {
            "has_anomaly": False,
            "kind": None,
            "tail_gap_burst": False,
            "tail_sustained_noise": False,
            "masked_pre_fade": False,
            "gap_at_s": None,
            "gap_duration_ms": 0,
            "burst_duration_ms": 0,
            "burst_peak_rms": 0.0,
        }

    scan_len = min(len(frames), 90)  # last 4.5 s
    tail_start_idx = len(frames) - scan_len
    tail = frames[tail_start_idx:]

    # Require speech activity BEFORE any gap inside the tail window.
    silent_run = 0
    best_gap_end = -1
    best_gap_len = 0
    saw_speech_before = any(v >= 0.04 for v in frames[:tail_start_idx])
    for idx, v in enumerate(tail):
        if v >= 0.04 and silent_run < 5:
            saw_speech_before = True
        if saw_speech_before and v < 0.012:
            silent_run += 1
            if silent_run >= 5 and idx < len(tail) - 3:  # >= 250 ms quiet gap
                best_gap_end = idx
                best_gap_len = silent_run
        elif v >= 0.012:
            silent_run = 0

    tail_gap_burst = False
    gap_at_s = None
    gap_duration_ms = 0
    burst_ms = 0
    burst_peak = 0.0
    if best_gap_end >= 0:
        after = tail[best_gap_end + 1:]
        active = [v for v in after if v >= 0.020]
        burst_ms = len(active) * 50
        burst_peak = float(np.max(after)) if len(after) else 0.0
        if burst_ms >= 300 or (burst_peak >= 0.080 and len(after) >= 3 and sum(v >= 0.025 for v in after) >= 3):
            tail_gap_burst = True
            gap_at_s = round((tail_start_idx + best_gap_end) * 0.050, 2)
            gap_duration_ms = int(best_gap_len * 50)

    # Sustained low-level breath/rumble (>= 700 ms between 0.012 and 0.14) touching EOF after speech peak.
    speech_frames = [i for i, v in enumerate(frames) if v >= 0.08]
    tail_sustained_noise = False
    if speech_frames:
        last_strong = speech_frames[-1]
        post = frames[last_strong + 1:]
        if len(post) >= 14:  # >= 700 ms after last full speech peak
            audible_post = [v for v in post if v >= 0.012]
            if len(audible_post) >= 12 and sum(v < 0.08 for v in audible_post) >= 10:
                # Touches within 300 ms of EOF (not an early natural trailing tail)
                if len(frames) - (last_strong + 1 + max(k for k, v in enumerate(post) if v >= 0.012)) <= 6:
                    tail_sustained_noise = True
                    burst_peak = max(burst_peak, float(np.max(post)))
                    burst_ms = max(burst_ms, len(audible_post) * 50)

    # Masked pre-fade: final 20 ms muted to ~0 right after rising low-level breath noise (0.015..0.11).
    tail_20 = int(0.020 * sr)
    tail_20_rms = float(np.sqrt(np.mean(a[-tail_20:] ** 2))) if len(a) > tail_20 else 0.0
    masked_pre_fade = False
    if tail_20_rms < 0.002 and len(tail) >= 12:
        last_4 = tail[-4:-1]  # [-200ms .. -50ms]
        prev_4 = tail[-8:-4]  # [-400ms .. -200ms]
        if len(last_4) and len(prev_4):
            mean_last = float(np.mean(last_4))
            if 0.015 <= mean_last <= 0.11 and mean_last > float(np.mean(prev_4)) * 1.4:
                masked_pre_fade = True

    kind = None
    if tail_gap_burst:
        kind = "tail_gap_burst"
    elif tail_sustained_noise:
        kind = "tail_sustained_noise"
    elif masked_pre_fade:
        kind = "masked_pre_fade"

    return {
        "has_anomaly": bool(kind),
        "kind": kind,
        "tail_gap_burst": tail_gap_burst,
        "tail_sustained_noise": tail_sustained_noise,
        "masked_pre_fade": masked_pre_fade,
        "gap_at_s": gap_at_s,
        "gap_duration_ms": gap_duration_ms,
        "burst_duration_ms": burst_ms,
        "burst_peak_rms": round(burst_peak, 4),
    }


def _can_import_whisper_in_process() -> bool:
    try:
        import librosa  # noqa: F401
        import torch  # noqa: F401
        import transformers  # noqa: F401
        return True
    except ImportError:
        return False


def discover_stt_python(explicit: str | None = None) -> str | None:
    """Locate a Python interpreter capable of running local Whisper transcription."""
    if explicit:
        p = Path(explicit)
        return str(p) if p.exists() else None

    for env_var in ("IDU_STT_PYTHON", "VOICEBOX_PYTHON"):
        val = os.environ.get(env_var, "").strip()
        if val and Path(val).exists():
            return val

    if _can_import_whisper_in_process():
        return sys.executable

    candidate_roots: list[Path] = []
    if os.environ.get("VOICEBOX_DIR"):
        candidate_roots.append(Path(os.environ["VOICEBOX_DIR"]))

    home = Path.home()
    candidate_roots.extend([
        home / "voicebox",
        home / "Desktop" / "voicebox",
        home / "Escritorio" / "voicebox",
    ])
    for onedrive in home.glob("OneDrive*"):
        for desktop in onedrive.glob("*"):
            if desktop.is_dir():
                candidate_roots.append(desktop / "voicebox")
                for sub in desktop.glob("*"):
                    if sub.is_dir() and sub.name.lower().endswith("proyectos"):
                        candidate_roots.append(sub / "voicebox")

    py_rel = Path(".venv/Scripts/python.exe") if os.name == "nt" else Path(".venv/bin/python")
    for root in candidate_roots:
        exe = root / py_rel
        if exe.exists():
            return str(exe)
    return None


def _voicebox_health_url() -> str | None:
    base = os.environ.get("VOICEBOX_URL", "http://127.0.0.1:17493").rstrip("/")
    try:
        with urllib.request.urlopen(f"{base}/health", timeout=1.5) as resp:
            if resp.status == 200:
                return base
    except Exception:
        return None
    return None


def transcribe_via_voicebox_http(wav_paths: list[Path], base_url: str, language: str = "es") -> dict[str, str]:
    """Transcribe WAV files through a running local Voicebox HTTP server."""
    boundary = "----IduVoiceValidatorBoundary7f9a2"
    results: dict[str, str] = {}
    for path in wav_paths:
        data = path.read_bytes()
        parts = [
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\n{language}\r\n".encode(),
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{path.name}\"\r\nContent-Type: audio/wav\r\n\r\n".encode(),
            data,
            f"\r\n--{boundary}--\r\n".encode(),
        ]
        body = b"".join(parts)
        req = urllib.request.Request(
            f"{base_url}/transcribe",
            data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        results[str(path)] = str(payload.get("text", "")).strip()
    return results


def transcribe_batch_in_process(
    wav_paths: list[Path],
    model_name: str = DEFAULT_WHISPER_MODEL,
    language: str = "es",
    allow_download: bool = False,
) -> dict[str, str]:
    """Transcribe all WAV files in a single Whisper load."""
    import librosa
    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor

    if not allow_download:
        os.environ.setdefault("HF_HUB_OFFLINE", "1")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    processor = WhisperProcessor.from_pretrained(model_name, local_files_only=not allow_download)
    model = WhisperForConditionalGeneration.from_pretrained(
        model_name,
        local_files_only=not allow_download,
    ).to(device)
    model.eval()

    out: dict[str, str] = {}
    for path in wav_paths:
        audio, _ = librosa.load(str(path), sr=WHISPER_SAMPLE_RATE, mono=True)
        is_long = len(audio) > WHISPER_SAMPLE_RATE * 30
        proc_kw = {"truncation": False, "padding": "longest", "return_attention_mask": True} if is_long else {}
        inputs = processor(audio, sampling_rate=WHISPER_SAMPLE_RATE, return_tensors="pt", **proc_kw).to(device)
        gen_kw = {"language": language, "task": "transcribe", "return_timestamps": True}
        if is_long:
            gen_kw["attention_mask"] = inputs["attention_mask"]
        with torch.no_grad():
            pred_ids = model.generate(inputs["input_features"], **gen_kw)
        out[str(path)] = processor.batch_decode(pred_ids, skip_special_tokens=True)[0].strip()
    return out


def transcribe_clips(
    wav_paths: list[Path],
    stt_python: str | None = None,
    model_name: str = DEFAULT_WHISPER_MODEL,
    language: str = "es",
    allow_download: bool = False,
) -> tuple[dict[str, str], str]:
    """Transcribe WAV clips via local Whisper (in-process, discovered venv, or Voicebox HTTP)."""
    if not wav_paths:
        return {}, "none"

    exe = discover_stt_python(stt_python)
    if exe and Path(exe).resolve() == Path(sys.executable).resolve():
        return (
            transcribe_batch_in_process(wav_paths, model_name=model_name, language=language, allow_download=allow_download),
            f"whisper:{model_name} (in-process)",
        )

    if exe:
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
            json.dump(
                {
                    "paths": [str(p) for p in wav_paths],
                    "model": model_name,
                    "language": language,
                    "allow_download": allow_download,
                },
                tmp,
            )
            manifest_path = tmp.name
        try:
            proc = subprocess.run(
                [exe, str(Path(__file__).resolve()), "--worker-manifest", manifest_path],
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
            )
            if proc.returncode != 0:
                raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or f"exit {proc.returncode}")
            return json.loads(proc.stdout), f"whisper:{model_name} ({exe})"
        finally:
            try:
                Path(manifest_path).unlink(missing_ok=True)
            except OSError:
                pass

    vb_url = _voicebox_health_url()
    if vb_url:
        return transcribe_via_voicebox_http(wav_paths, vb_url, language=language), f"voicebox-http:{vb_url}"

    raise RuntimeError(
        "No local STT runtime available (install transformers+torch or set IDU_STT_PYTHON / run Voicebox)."
    )


def evaluate_clip_speech(
    ref_text: str | None,
    hyp_text: str | None,
    tail_info: dict | None,
    wer_warn: float = DEFAULT_WER_WARN,
    wer_error: float = DEFAULT_WER_ERROR,
    has_click: bool = False,
) -> dict:
    """Combine acoustic tail checks and STT alignment into a deterministic clip verdict."""
    errors: list[str] = []
    warnings: list[str] = []
    alignment = None

    if has_click:
        errors.append("closing click detected in the tail")

    if hyp_text is not None and ref_text:
        alignment = align_transcript(ref_text, hyp_text)
        tail_extra = alignment["tail_insertions"]
        if len(tail_extra) >= MAX_TAIL_INSERT_WORDS:
            errors.append(
                f"hallucinated tail words after script ended: \"{' '.join(tail_extra)}\""
            )
        elif tail_extra and tail_info and tail_info.get("tail_gap_burst"):
            errors.append(
                f"hallucinated tail after silence gap: \"{' '.join(tail_extra)}\""
            )

        if alignment["wer"] >= wer_error:
            errors.append(
                f"WER {alignment['wer']:.3f} exceeds limit {wer_error:.2f} (garbled speech)"
            )
        elif alignment["wer"] >= wer_warn:
            warnings.append(
                f"WER {alignment['wer']:.3f} above warning threshold {wer_warn:.2f}"
            )

        if alignment["missing_anchors"]:
            tokens = ", ".join(m["token"] for m in alignment["missing_anchors"][:6])
            errors.append(f"missing/garbled technical terms: {tokens}")

        if alignment["severe_mismatches"]:
            sample = "; ".join(
                f"'{m['ref']}'->'{m['hyp']}'" for m in alignment["severe_mismatches"][:3]
            )
            if alignment["wer"] < wer_error:
                warnings.append(f"severe mispronunciation span(s): {sample}")

    has_stt = alignment is not None
    if tail_info and tail_info.get("has_anomaly"):
        kind = tail_info["kind"]
        detail = f"{kind} ({tail_info['burst_duration_ms']}ms, peak RMS {tail_info['burst_peak_rms']:.4f})"
        if kind == "tail_gap_burst":
            if alignment and alignment["tail_insertions"]:
                errors.append(f"trailing speech/noise burst after pause: {detail}")
            elif not has_stt and tail_info["burst_peak_rms"] >= 0.08:
                errors.append(f"trailing speech/noise burst after pause: {detail}")
            elif has_stt and tail_info.get("gap_duration_ms", 0) >= 480 and tail_info["burst_duration_ms"] <= 1200:
                # Prolonged silence (>0.48s) followed by an isolated trailing outburst (<1.2s) is a generation glitch.
                errors.append(f"isolated trailing outburst after {tail_info['gap_duration_ms']}ms gap: {detail}")
            elif has_stt and tail_info["burst_peak_rms"] < 0.14 and tail_info["burst_duration_ms"] >= 1000:
                # Non-speech growl/noise island where Whisper produced no trailing words (e.g. rumble tail).
                errors.append(f"non-speech noise/growl tail after pause: {detail}")
            elif has_stt and tail_info["burst_peak_rms"] < 0.065 and tail_info["burst_duration_ms"] >= 300:
                # Low-energy audible breath/hum tail after quiet pause (<0.065 RMS is never normal final speech).
                errors.append(f"non-speech breath/hum tail after pause: {detail}")
            elif has_stt and tail_info["burst_peak_rms"] < 0.14:
                warnings.append(f"trailing acoustic anomaly: {detail}")
        elif kind == "tail_sustained_noise":
            warnings.append(f"long non-speech breath/noise tail: {detail}")
        else:
            warnings.append(f"trailing acoustic anomaly: {detail}")

    verdict = "block" if errors else ("revise" if warnings else "pass")
    return {
        "verdict": verdict,
        "errors": errors,
        "warnings": warnings,
        "alignment": alignment,
    }


def _worker_main() -> int:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--worker-manifest", required=True)
    args = ap.parse_args()
    manifest = json.loads(Path(args.worker_manifest).read_text(encoding="utf-8"))
    paths = [Path(p) for p in manifest["paths"]]
    result = transcribe_batch_in_process(
        paths,
        model_name=manifest.get("model", DEFAULT_WHISPER_MODEL),
        language=manifest.get("language", "es"),
        allow_download=bool(manifest.get("allow_download", False)),
    )
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(_worker_main())

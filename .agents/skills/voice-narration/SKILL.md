---
name: voice-narration
description: Generate Spanish narration audio from a script using the local voicebox server (Kokoro / Chatterbox). Use when a presentation, video, or demo needs voiceover tracks — one WAV per scene, timed for a HyperFrames composition.
---

# Voice narration (voicebox)

Turns a written script into narration WAVs, locally, without cloud APIs.

## Prerequisites

The backend must be listening on `127.0.0.1:17493`. Start it from the voicebox
checkout (see the `voice-narration` setup notes, or run `arrancar-backend.bat`
if you already have one):

```bash
python -m backend.main --port 17493 --data-dir "$VOICEBOX_DATA"
```

Health check: `GET http://127.0.0.1:17493/health` → `{"status":"healthy", ...}`

If it answers `model_loaded: false`, that is normal: models load on first generation.

Path conventions used in this skill. Set them in your environment; never hardcode
one person's absolute path into a committed file:

| Variable | Points to |
| -------- | --------- |
| `$IDU_VOICE` | the folder with the script helper `generar_guion.py` (not shipped in this repo) |
| `$VOICEBOX_DATA` | the voicebox data dir passed as `--data-dir` |

If a variable is unset, stop and ask for the path instead of guessing one.

## Voices available in Spanish

| voice_id   | Name  | Gender |
| ---------- | ----- | ------ |
| `em_alex`  | Alex  | male   |
| `ef_dora`  | Dora  | female |
| `em_santa` | Santa | male   |

`GET /profiles/presets/kokoro` lists all 50 presets across 8 languages.

**Engine ↔ profile type is a hard constraint:**

| Profile `voice_type` | Allowed `engine` | Precondition before `/generate` |
| -------------------- | ---------------- | ------------------------------- |
| `preset`             | `kokoro` only    | `preset_voice_id` set           |
| `cloned`             | `chatterbox`     | at least one sample uploaded    |

Chatterbox supports 23 languages, including `es`.

## Workflow

### 1. Ensure a profile exists

```bash
curl -X POST http://127.0.0.1:17493/profiles \
  -H "Content-Type: application/json" \
  -d '{"name":"Narrador ES","language":"es","voice_type":"preset","preset_engine":"kokoro","preset_voice_id":"em_alex","default_engine":"kokoro"}'
```

Save the returned `id`. `GET /profiles` lists existing ones — reuse instead of duplicating.

#### 1b. Chatterbox requires a cloned profile

- Never send `"engine":"chatterbox"` with a preset profile. It is rejected with
  `only supports engine 'kokoro'`.
- Create a separate profile with `"voice_type":"cloned"`.
- Upload a reference sample before the first generation:
  `POST /profiles/{id}/samples`.
- Do not call `/generate` until the upload has succeeded. A cloned profile
  without samples fails with `No samples found`.
- If you cannot upload a sample, call the model directly from Python. Do not
  retry `/generate` on a profile that has no samples.

### 2. Generate one clip per scene

```bash
curl -X POST http://127.0.0.1:17493/generate \
  -H "Content-Type: application/json" \
  -d '{"profile_id":"<id>","text":"...","language":"es","engine":"chatterbox"}'
```

Returns immediately with a generation `id` and `status: "generating"`.

### 3. Poll until done

```bash
curl http://127.0.0.1:17493/generate/<generation_id>/status
```

Responses are SSE-shaped: read the line starting with `data: ` and parse it.
`status` goes `generating` → `completed` (or `failed` with an `error`).
A short sentence takes 5-45 s on CPU, ~10 s per scene on a GPU.

### 4. Collect the file

The WAV lands at `$VOICEBOX_DATA/generations/<generation_id>.wav` (the `--data-dir` you
started the backend with).
Copy it next to the video project, one file per scene.

### 5. Clean tail clicks (only this method)

Clips may end with a noise tail and a closing click. Naive trimming deletes
real speech — one attempt cost **2.38 s of voice across 12 of 13 clips**.

1. **Back up first.** Copy every WAV to a `voice-*-prefade/` sibling folder.
   No backup, no processing.
2. **Detect by temporal signature, never by voicing.** Measure the RMS
   envelope in **10 ms frames**. A frame is a click only if both hold:
   - it rises and falls within **< 40 ms**, and
   - its peak RMS is **≥ 5×** the median RMS of neighbouring frames,
     excluding a **±2 frame** band around the peak itself.
3. **Silence from click onset to EOF** with a **30 ms fade**. Touch nothing
   before that point.
4. **Never change the file duration.** Frame count after processing must equal
   the frame count before.

Periodicity is not a valid criterion. A real click measured RMS **0.31** in the
last 20 ms with periodicity **~0.37** — high enough to look like speech, which
is why a periodicity threshold deleted real voice.

## Validation gate (before mixing)

Do not hand-check. Run the gate:

`validar_video_audio.py` ships next to this SKILL.md and needs `numpy`. From the
repo root:

```bash
python skills-bundle/voice-narration/validar_video_audio.py --proyecto "/path/to/video-project"
```

Exit code 1 means **do not render**. It reads the project's `index.html`: each
narration clip as a tag with `id="voN"`, `src`, `data-start` and `data-duration`
(in any order, among any other attributes, as HyperFrames writes them) and the
music as `id="bgm"` with the same three attributes. It checks, per clip: declared vs real duration, overlap with the next
clip, closing clicks (temporal signature, not voicing), and tail audibility. It
also verifies the music lasts its `data-duration` and that a `partitura.json`
beside it proves the AI composed it. Its tests:
`cd skills-bundle/voice-narration && python -m unittest test_validar_video_audio`.

Every clip must pass every check:

| Check              | Pass criterion                                                          | Checked by |
| ------------------ | ----------------------------------------------------------------------- | ---------- |
| Duration preserved | `frames(processed) == frames(.orig.wav)`                                | the cleaning step, against its backup |
| Speech preserved   | samples before click onset are identical to the backup                  | the cleaning step, against its backup |
| Tail clean         | a burst ≥ 5× its neighbours that rises from and falls back to 1/5 of its peak in < 40 ms: 0 hits. A final "s" fades slower and passes | the gate (error) |
| Tail RMS           | last 20 ms silent                                                       | the gate (warning) |
| Declared ≤ real    | `data-duration ≤ frames / sample_rate` of the final file                | the gate (error) |
| No overlap         | `data-start + real duration < next clip's data-start`                   | the gate (error) |

Measure the real duration from the final file, never from the script or from
the generation response. A long-form script with no overlap check is how a
video ends up with two voices talking at once.

## Timing rules for video

- Speech runs ~2.5-3 words/second in Spanish at speed 1.0.
- Give every clip **at least 1.2 s of air** before the next scene starts.
- Never let two narration clips overlap: compute `start + duration` per clip and
  assert it is `<` the next clip's start. This is the single most common defect.
- `data-duration` MUST be ≤ the real file duration (`frames / sample_rate`),
  measured after post-processing. A declared duration longer than the file
  desyncs the video.

## Anti-patterns

- Do **not** send `engine: chatterbox` with a preset profile.
  Symptom: `only supports engine 'kokoro'`.
- Do **not** generate with a cloned profile that has no samples.
  Symptom: `No samples found`.
- Do **not** trim endings by periodicity (`>= 0.50`) with a minimum region of
  150 ms. Symptom: up to **2.38 s of real speech deleted in 12 of 13 clips**.
- Do **not** change file duration while cleaning. Symptom: declared timings no
  longer match the audio and the video desyncs.
- Do **not** declare `data-duration` longer than the real file.
  Symptom: the video desyncs.
- Do **not** post-process without backups. Symptom: the loss cannot be undone.
  The 2.38 s regression was only recovered because a backup existed.
- Do **not** install `kokoro-onnx` and call it Kokoro. Voicebox uses the PyPI
  `kokoro` package; they are different and only the latter is used by the backend.
- Do **not** edit `transformers` to 5.x: Kokoro breaks with
  `module 'transformers.utils.hub' has no attribute '_is_offline_mode'`.
- Do **not** try the official MSI without an elevated shell: it fails with 1925 → 1603.

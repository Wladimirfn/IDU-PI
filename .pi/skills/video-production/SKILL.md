---
name: video-production
description: Produce code-rendered explainer videos with HyperFrames Studio, a deterministic frame renderer, and motion/audio gates. Trigger: video explainer, render MP4, Studio preview, keyframes, motion gate, HyperFrames.
---

# Video production

Pipeline for explainers built as a single HTML composition, with the Studio as
the live editing surface and a deterministic frame renderer for delivery.

## Golden rules

- The Studio stays up. Editing is the default; an MP4 is an explicit request.
- A delivery MP4 is produced by `render_frames.mjs`, not by `hyperframes render`.
- Never publish a video when the motion or audio gate exits 1.
- `keyframes/eNN.png` are the approved oracle. The renderer never regenerates them.
- Every new scene or presentation is audited at creation with its `guion.md`
  lines, timeline beats, keyframe, and motion. The audit is part of creation, not
  an optional review.
- One variable at a time: if a scene fails, first look at the diff image, then
  change a threshold. Never "fix" a gate by raising the bitrate.

## Scene design audits

Every new scene or presentation must pass this audit before it is accepted; an
audit is part of creation, not an optional review.

When auditing or redesigning a scene, the brief MUST include:

- the scene's narration lines from `guion.md`, verbatim;
- the beat timings from `timeline.json`;
- the current keyframe `keyframes/eNN.png`;
- the current motion description: what moves at each beat.

Never audit a scene from the keyframe alone. An element that looks redundant may
be required by the narration. In E06 the risk indicator is the preflight beat and
the three locks are the `PERFIL / SESIÓN / LOCK` guards; an audit without the
script cut narrated content. If a proposal removes an element the script names,
keep the element and adapt its form instead.

## Pipeline

1. **Audio gate (before rendering).**
   `python skills-bundle/voice-narration/validar_video_audio.py --proyecto <project>`
   Checks clip durations, overlaps, clicks, and music length/score.
2. **Edit in the Studio.**
   `idu-pi video studio --project <project>` serves the live preview.
3. **Approve keyframes.**
   `keyframes/eNN.png` is the final, still state of each scene. It is the
   contract the motion gate compares against.
4. **Render the delivery video.**
   `idu-pi video render --project <project>`
   Resolves the duration from `data-duration`/`timeline.json`, picks the
   approved `*-hq.mp4` audio, finds Playwright, renders with
   `render_frames.mjs`, and runs the motion gate. Options: `--out <mp4>`,
   `--audio <file>`, `--end <s>`, `--no-validate`.
5. **Motion gate.**
   Runs automatically after a full render. To validate an existing MP4:
   `idu-pi video validate --project <project> --video <mp4>`
6. **Publish only if both gates exit 0.**

## Commands

| Step | Command |
| --- | --- |
| Studio | `idu-pi video studio --project <dir>` |
| Status | `idu-pi video status` |
| HyperFrames status | `idu-pi video measure --project <dir>` |
| **Delivery render** | `idu-pi video render --project <dir>` |
| Partial render | add `--end <s>` (gate skipped) |
| Render + custom audio | add `--audio <file>` (default: newest `*-hq.mp4`) |
| Render to a path | add `--out <mp4>` |
| Lower-level renderer | `node skills-bundle/video-production/render_frames.mjs ...` |
| Motion gate | `idu-pi video validate --project <dir> --video <mp4>` |
| Motion gate + diffs | add `--debug <dir>` |
| Audio gate | `python skills-bundle/voice-narration/validar_video_audio.py --proyecto <dir>` |

## Why `hyperframes render` is not the delivery path

Measured on `idupi-explainer-v2` with the same gate and the same composition:

| Render path | e01 changed px | e12 changed px | Audio |
| --- | ---: | ---: | --- |
| HyperFrames 0.9.21, full render | 11,187 | 7,372 | yes |
| HyperFrames 0.9.25, full render | 11,180 | 7,372 | yes |
| HyperFrames 0.9.25, 10 s clip | 0 | — | yes |
| `render_frames.mjs` (approved HQ) | 16 | 0 | video only; mux with `--audio` |

`idu-pi video render` uses `render_frames.mjs`; it never calls
`hyperframes render`. The HyperFrames renderer remains available only as a
lower-level tool for Studio/preview experiments.

The full HyperFrames render introduces a periodic text flicker in windows that
should be static. The diff image shows clean letter outlines, max per-pixel
differences of 116-143, and a period of about 0.3 s. It is not codec noise and
not a CSS animation: the composition has no `@keyframes` or CSS `animation`.

**The 10 s clip is not a regression test.** It is clean in every version; the
defect only appears in the full render path. When bumping the HyperFrames pin,
run a full render and the gate.

## `render_frames.mjs`

`idu-pi video render` uses this script. Call it directly only for CI or a
custom range; the CLI resolves duration, audio, and Playwright.

Requires the composition to expose `window.seek(t)`: a function that moves the
global timeline to time `t` and returns when the DOM is ready to capture. A
composition served through the Studio URL does not expose `window.seek` on the
top window; load the composition directly as `file://.../index.html`.

Prerequisites: Playwright (`npm i playwright`, or `--playwright <path>`), a
Chrome/Chromium binary (`--chrome <path>`, or Playwright's bundled Chromium),
and `ffmpeg` in `PATH`.

The CLI auto-picks the newest `*-hq.mp4` in the project as the audio source;
`--audio` overrides it. The renderer itself is video-only unless `--audio` is
passed.

The script captures one PNG per frame with Playwright, pipes it to ffmpeg
(`libx264`, `-preset medium`, `-crf 16`, `yuv420p`), and optionally muxes audio.
Same inputs produce the same frames; there is no random seed and no wall-clock
dependence.

## Motion gate (`validar_motion.py`)

Measures, per scene:

1. **Alignment**: the frame at the end of the scene against its approved
   keyframe (shift, edge correlation, residual, ink overlap).
2. **Flicker**: consecutive-frame difference in the quiet window at native
   resolution. A static headline that flickers produces a peak; a well-rendered
   one is near zero.
3. **Frozen**: a run with no change at all. Static scenes with narration are
   legitimate; the threshold is 8 s, calibrated against the approved HQ (5.8 s
   of intentional stillness).
4. **Black**: near-zero luminance. Warning only; final fades can be legitimate.

Errors block; warnings do not. `--debug <dir>` writes one diff PNG per scene,
which is the evidence to inspect before changing any threshold.

## Troubleshooting

| Symptom | Cause | Action |
| --- | --- | --- |
| `window.seek is not a function` | Loaded the Studio URL, not the composition | Use `file://.../index.html` |
| Playwright not found | Not installed in the project | `npm i playwright` or `--playwright <path>` |
| Chrome not found | No system Chrome | `--chrome <path>` or install Chromium |
| `bitrate ... is low` | Normal for flat vector content | Ignore unless you see banding or dirty edges |
| Frozen run > 8 s | Real dead animation or an intentional static scene | Inspect frames; if intentional, document it |
| Flicker error in e01/e12 | Full HyperFrames render, not the frame renderer | Re-render with `render_frames.mjs` |

## Version policy

HyperFrames is pinned and reviewed, never `npm update`-ed blindly. The Studio
and `measure` use the pinned version; delivery uses `render_frames.mjs`. Every
pin bump requires a full render and both gates before it is accepted.

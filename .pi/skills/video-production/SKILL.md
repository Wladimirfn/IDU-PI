---
name: video-production
description: "Trigger: video production, art direction, style brief, e00, storyboard, render MP4, keyframes, motion gate, HyperFrames. Capability-first production: determine what the piece must produce, probe that the harness can produce it, write an art-direction contract, approve an e00 styleboard, then render and pass the artistic, motion and audio verdicts."
metadata:
  author: Wladimirfn / cross-cli skills-bundle
  tags: [video, hyperframes, art-direction, style-brief, e00, storyboard, render, motion-gate, visual-qa, lanes]
  version: 1.2.0
  updated: 2026-11-09
  sources: local pipeline (idupi-explainer-v2), artokun/comfyui-mcp lane notes, remotion-dev/skills lane notes
---

# Video production

Pipeline for code-rendered videos built as a single HTML composition, with the
Studio as the live editing surface and a deterministic frame renderer for
delivery. The capability router, art-direction contract and style brief keep the
pipeline style-agnostic: the lane selects what the harness must be able to
produce, never a house aesthetic.

## Golden rules

- The Studio stays up. Editing is the default; an MP4 is an explicit request.
- A delivery MP4 is produced by `render_frames.mjs`, not by `hyperframes render`.
- Never publish a video when the motion or audio gate exits 1.
- `keyframes/eNN.png` are the approved oracle. The renderer never regenerates them.
- Intent precedes lane: decide whether the piece is a presentation, a story or
  an experience before choosing a technique. A piece with no declared intent
  becomes a narrated slide deck by default.
- Art direction precedes HTML: write `art-direction.md` before the first
  composition line for any multi-shot piece.
- A named aesthetic preset is opt-in. `kanagawa-html` is one style, not the
  house look; in any other style it is loaded in craft-only mode.
- Every new scene or presentation is audited at creation with its narration
  lines (or the beat's intent line when the piece has no narration), timeline beats, keyframe, and motion. The audit is part of creation, not
  an optional review.
- The artistic audit and the technical gates are two separate verdicts. Neither
  substitutes for the other.
- The author never approves its own scenes. `idu-pi video audit` sends the
  keyframes to a model on another harness, and a full render is refused without
  its verdict. Your own audit while building is how you get there, not the
  approval.
- One variable at a time: if a scene fails, first look at the diff image, then
  change a threshold. Never "fix" a gate by raising the bitrate.
- No full render before the art direction, the style brief and
  `keyframes/e00-styleboard.png` are approved. One primary engine per project.
  `idu-pi video render` enforces the style gate on full renders.

## Intent first

The same subject makes three different pieces. Decide which one this is before
anything else, and record it as the first line of `style-brief.md`:

| Intent | The viewer leaves | Time is driven by | A beat is | It fails as |
| --- | --- | --- | --- | --- |
| `presentation` | able to restate something | the voice | one claim | a narrated slide deck |
| `story` | having followed someone through a change | the performance | one change in the protagonist's situation | an explainer with a mascot |
| `experience` | having felt a mood, rhythm or scale | the music | one shift of energy or mood | an explainer without words |

- Infer the intent from the request. "Explain", "teach", "show what we built"
  is a presentation. "Tell", a named character, a conflict is a story. "Trailer",
  "mood", "visualizer", "intro", "make it feel" is an experience. Ask only when
  two intents would produce different pieces.
- The intent changes the structure, not the decoration. A story is not a
  presentation plus a character; it has no claims to list. An experience has no
  narrator and no on-screen text unless the request asks for them.
- The intent is independent of the lane. A pixel story, a 3D presentation and a
  vector experience are all valid. Never pick the intent from the technique.
- A presentation beat that asserts the behaviour of something real and existing
  (a command, a test run, a UI, a file) is shown as a demonstration of that
  thing: a capture of it, or its real output or content reproduced verbatim in
  code. Run the command and show what it printed; open the file and show its
  lines. Diagrams are for what is abstract or invisible. An invented stand-in or
  a box with the artifact's name is not a demonstration; if the real thing
  cannot be obtained, record a capability gap.
- A request that pairs an experience format with content to explain ("a trailer
  that shows what we built") is not settled by its words. Ask.
- `references/video-lanes.json` holds the full defaults per intent under
  `intents`. `idu-pi video render` refuses a full render without a valid
  `Intent:` line.

## Capability-first routing

Video requests are capability-driven, not template-driven. Once the intent is
decided, and before loading a
visual skill, read `references/video-lanes.json` and determine **what the piece
must be able to produce**; the lane is only the label for that capability set.

- A lane is not a look. `vector-explainer` means code-rendered 2D diagrams; it
  does not mean dark cards with a gold accent. `pixel-retro` means sprites and a
  pixel grid, not "a dark theme with a retro font".
- Probe the lane's `capabilities` and `requires` before promising it: engine
  present, deterministic seek, sprite pipeline, 3D render, raster source, voice,
  music. Record the evidence in `art-direction.md`.
- A missing capability is a blocker or an explicitly approved downgrade. Never
  silently replace the missing shot with cards and text; that is how every lane
  collapses into the same explainer.
- If the request names a style, reference, or aspect ratio, use it. If any
  decision (intent, lane, style, audio) is missing or ambiguous, follow
  `references/style-brief.md` and ask one grouped question for the unsettled
  axes. Never default to the previous project's look.
- If no lane fits, use `custom` and define its capability set in the style brief;
  never force a lane that changes the request's intent.
- Start with the minimum useful set: one preproduction, one or two visual, one
  audio, and the render/QA skill. Add another skill only when the task requires
  it; `video-lanes.json` holds the conditional lane-to-skill map.
- One primary engine per project. HyperFrames owns HTML/2D and 3D scenes;
  Remotion owns React motion graphics; ComfyUI supplies raster or video assets.
  Do not run two composition timelines in one piece. This skill owns the
  HyperFrames engine only: for a Remotion-primary lane load `remotion-engine`,
  and for ComfyUI assets load `comfyui-8gb`.
- Do not promise a lane whose primary engine is `planned`. Load only `available`
  companion skills; omit `planned` ones and note them as follow-ups.
- Effects are opt-in. No shader, pixel or 3D layer is added unless the art
  direction names it and it survives legibility and the delivery renderer.

## Art direction before HTML

Style is a decision, not a template. Before the first line of HTML, write
`art-direction.md` from `references/art-direction.md`. It records:

- the intent of each beat and the reading order;
- the visual language on six axes — shape grammar, depth model, texture, color
  logic, typography role, motion language — each with what it **is** and **is
  not**;
- the shot/beat sheet: shot type, subject, composition, movement, transition,
  what must read, and the proof each beat needs;
- character performance when the piece has characters (linked to
  `story-continuity/references/character-continuity.md`);
- the asset strategy and the approved asset policy for this project;
- the capability check: what the harness must produce, what it can produce, and
  the approved fallback when something is missing;
- three to six artistic acceptance criteria the visual audit will test.

The Style Brief records the decisions (lane, palette, type, audio, aspect). The
art-direction contract records the language and the shots. Do not collapse one
into the other: a palette is not a composition.

A previous project's constraints do not carry over. If the last brief forbade
external assets or AI raster, that was a decision for that project; record the
new project's policy with its own reason, and surface the tradeoff when the
visual language needs an asset class the policy forbids.

## Style Brief & e00 gate

Read `references/style-brief.md` before the first edit. The short version:

1. Infer the intent, then the lane and its capability set; ask one grouped
   question only if a decision is missing. Axes: intent, lane/format,
   aesthetic/rhythm, audio.
2. Probe every required capability and record the evidence.
3. Write `art-direction.md` (visual language, shot sheet, asset policy,
   acceptance criteria) and `style-brief.md`.
4. Render `keyframes/e00-styleboard.png`: a real hero frame that proves the
   contract — palette, texture, depth, a motion cue, and what the intent says
   `e00` must prove (a real claim, the protagonist acting, or the mood at full
   quality); include a 5-second audio preview when relevant.
5. Stop for approval of the art direction, the brief and `e00` together. No full
   render before approval.
6. After approval, load the lane's minimum skill set and build.

`e00` is a gate artifact, not a scene: it does not belong in `timeline.json` and
the motion gate ignores it.

## Scene design audits

Every new scene or presentation must pass two separate audits before it is
accepted; both are part of creation, not an optional review.

**Artistic audit** (`references/visual-qa.md`), before the keyframe is accepted:
whether the beat reads for the declared intent, focal hierarchy, style fidelity, variety against the
neighbouring shots, asset appropriateness, typography, motion motivation,
composition, reference use, and proof. A `block` verdict stops the scene.

**Technical gates**, after the render: motion (`validar_motion.py`) and audio
(`validar_video_audio.py`). They measure alignment, flicker, frozen frames,
black frames, clipping, overlaps and duration. A passing gate never proves the
scene reads; an artistic pass never excuses a flicker.

### The independent audit

Run your own artistic audit while you build; it is how scenes get good. It is
not the approval. Before a full render:

1. Make sure `style-brief.md` has `- Author: <harness>/<model>` naming who built
   the composition (you). The auditor is chosen to be on a different harness.
2. Run `idu-pi video audit --project <project>`. It spends one model call. The
   auditor reads `references/visual-qa.md`, the brief, the art direction, the
   script and every `keyframes/eNN.png`, and its verdict is written to
   `audit/visual-qa.json`.
3. Read the verdict. A `block` scene, or a piece that "fell back" from its
   intent, stops the render: fix the scene, not the audit file. `revise` items
   are printed as warnings; fix them or tell the user which ones you left and
   why.
4. Changing a keyframe or `art-direction.md` makes the audit stale. Re-run it
   after the fixes; do not re-run it in a loop hoping for a different verdict.

Never write or edit `audit/visual-qa.json` by hand, and never pass
`--skip-style-gate` to get a delivery render past a verdict you disagree with.
If you think the auditor is wrong, show the user the verdict and the frame.

When auditing or redesigning a scene, the brief MUST include:

- the piece's intent, so the scene is judged as what it is;
- the scene's narration lines from `guion.md`, verbatim, when the piece has
  narration; otherwise the beat's line from the art-direction intent;
- the beat timings from `timeline.json`;
- the scene's row in the art-direction shot sheet;
- the current keyframe `keyframes/eNN.png`;
- the current motion description: what moves at each beat.

Never audit a scene from the keyframe alone. An element that looks redundant may
be required by the narration. Example: if the script names three security guards
on screen, an audit from the keyframe alone might delete them as visual clutter.
If a proposal removes an element the script names, keep the element and adapt its
form instead.

Never accept three or more consecutive scenes with the same card or grid
skeleton unless the art direction names the repetition as a deliberate motif.
The fix is a different shot type — a demonstration, a different diagram, a
close-up, a full-bleed frame, type-only — not more cards.

## Pipeline

1. **Intent, capability and style decisions.**
   Decide the intent, read `references/video-lanes.json`, infer the lane, probe
   its capabilities, write `style-brief.md`.
2. **Art direction.**
   Write `art-direction.md` from `references/art-direction.md`: intent, reading
   order, six language axes, shot sheet, asset policy, capability evidence, and
   acceptance criteria.
3. **`e00` approval.**
   Render `keyframes/e00-styleboard.png`, present it with the brief and the art
   direction, and stop. No full render before approval.
4. **Storyboard and audio gate (when voice or music is in the brief).**
   The shot sheet is the storyboard. Run
   `python skills-bundle/voice-narration/validar_video_audio.py --proyecto <project>`
   to check clip durations, overlaps, clicks, and music length/score.
5. **Edit in the Studio.**
   `idu-pi video studio --project <project>` serves the live preview. The
   composition must expose `window.seek(t)` and, for the Studio timeline, a GSAP
   bridge that forwards updates to it.
6. **Approve keyframes.**
   `keyframes/eNN.png` is the final, still state of each scene. Run the artistic
   audit before accepting it; it is the contract the motion gate compares against.
7. **Render the delivery video.**
   `idu-pi video render --project <project>`
   Run `idu-pi video audit --project <project>` first: a full render also
   enforces the audit gate (a fresh, independent `audit/visual-qa.json` with no
   blocked scene and the intent delivered).
   Enforces the style gate on full renders (valid intent, lane exists, `art-direction.md`
   present, `e00` approved and rendered), resolves the duration from
   `data-duration`/`timeline.json`, picks the approved `*-hq.mp4` audio, finds
   Playwright, renders with `render_frames.mjs`, and runs the motion gate.
   Options: `--out <mp4>`, `--audio <file>`, `--end <s>`, `--no-validate`,
   `--width`, `--height`, `--gpu`, `--angle`, `--skip-style-gate`.
8. **Motion gate.**
   Runs automatically after a full render. To validate an existing MP4:
   `idu-pi video validate --project <project> --video <mp4>`
9. **Publish only if the artistic audit and both gates hold.**

## Commands

| Step | Command |
| --- | --- |
| Studio | `idu-pi video studio --project <dir>` |
| Status | `idu-pi video status` |
| HyperFrames status | `idu-pi video measure --project <dir>` |
| Independent audit | `idu-pi video audit --project <dir>` (one model call) |
| Audit with a chosen profile | add `--profile <idu-pi profile>` (must not be the author's harness) |
| **Delivery render** | `idu-pi video render --project <dir>` |
| Partial render | add `--end <s>` (style and motion gates skipped) |
| Render + custom audio | add `--audio <file>` (default: newest `*-hq.mp4`) |
| Render to a path | add `--out <mp4>` |
| Vertical or square | add `--width 1080 --height 1920` (even dimensions only) |
| Hardware WebGL | add `--gpu` (opt-in; validate determinism with the motion gate) |
| Lower-level renderer | `node skills-bundle/video-production/render_frames.mjs ...` |
| Motion gate | `idu-pi video validate --project <dir> --video <mp4>` |
| Motion gate + diffs | add `--debug <dir>` |
| Audio gate | `python skills-bundle/voice-narration/validar_video_audio.py --proyecto <dir>` |

## Render profile

Resolution, aspect, fps and GPU mode are project decisions, not renderer
constants. `render_frames.mjs` reads `data-width` and `data-height` from the
composition root when the flags are absent, so a 9:16 piece renders at its own
size. Width and height must be even; `yuv420p` silently corrupts odd dimensions.

- Default: composition size, 30 fps, CRF 16, software rendering with
  `--disable-gpu`.
- `--gpu` switches to ANGLE and drops `--disable-gpu`. Use it for shader or 3D
  lanes after proving the frame is deterministic: render the same range twice
  and compare. Software rendering is slower but reproducible across machines.
- `--angle <backend>` selects the ANGLE backend when `--gpu` is on (`d3d11`,
  `gl`, `vulkan`). Leave it out unless the environment needs it.

The style gate runs only on a full render. A partial render is a review tool and
may run before approval; `--skip-style-gate` exists for tests and non-delivery
renders, and prints a warning. A full delivery render without an approved
`style-brief.md`, a valid intent, a valid lane, `art-direction.md`, and a rendered `e00` is
refused.

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
| `style gate: falta style-brief.md` | Project has no decisions recorded | Write the brief and approve `e00` |
| `style gate: ... no declara Intent` | Brief written before the intent existed, or the decision was skipped | Add `- Intent: presentation \| story \| experience` as the first line of the brief |
| `style gate: intent desconocido` | Typo, or a format name used as the intent | Use one of the ids under `intents` in `video-lanes.json` |
| `audit gate: falta audit/visual-qa.json` | Nobody but the author looked at the piece | Run `idu-pi video audit` |
| `audit gate: auditoría vencida` | A keyframe or `art-direction.md` changed after the audit | Re-run `idu-pi video audit` |
| `audit gate: auditoría no independiente` | The auditor profile shares the author's harness | Re-run with `--profile` on another harness |
| `audit gate: escena bloqueada` / `no cumple su intent` | The auditor's verdict | Fix the scene or the structure, then re-audit; never edit the audit file |
| `video audit: ... no declara Author` | The brief does not say who built the piece | Add `- Author: <harness>/<model>` to `style-brief.md` |
| `style gate: lane desconocida` | Lane typo or not in `video-lanes.json` | Fix the `Lane:` line or add the lane |
| `style gate: e00 no aprobado` | Brief still says `Approved e00: no` | Present `e00`, get approval, update the line |
| `style gate: falta art-direction.md` | HTML was written without the contract | Write it from the approved frames, then render |
| `bitrate ... is low` | Normal for flat vector content | Ignore unless you see banding or dirty edges |
| Frozen run > 8 s | Real dead animation or an intentional static scene | Inspect frames; if intentional, document it |
| Flicker error in e01/e12 | Full HyperFrames render, not the frame renderer | Re-render with `render_frames.mjs` |
| Output dimensions odd | `--width/--height` not even | Use even values; `yuv420p` requires them |

## Version policy

HyperFrames is pinned and reviewed, never `npm update`-ed blindly. The Studio
and `measure` use the pinned version; delivery uses `render_frames.mjs`. Every
pin bump requires a full render and both gates before it is accepted.

## References

- `references/art-direction.md` — the pre-HTML contract: intent, reading order,
  six visual-language axes, shot sheet, asset policy, capability check, artistic
  acceptance criteria.
- `references/visual-qa.md` — the artistic audit, separate from the motion and
  audio gates: beat legibility, hierarchy, fidelity, variety, the same-card test.
- `references/video-lanes.json` — intent defaults, capability-first lane map,
  conditional skills, engine status, and the style brief contract.
- `references/style-brief.md` — intent decision, grouped style question, `style-brief.md`
  template, asset policy, and the `e00` approval gate.

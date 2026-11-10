# Style Brief and e00 gate

Use this before any full video render. Its job is to record the decisions that
change the outcome, prove the lane's production capability, and approve one real
frame before production.

The Style Brief is the decision sheet. The **art direction contract**
(`references/art-direction.md`, `art-direction.md` in the project) is the visual
language and shot plan. For a multi-shot piece both are required; a Style Brief
alone describes a look without a composition.

## 0. Decide the intent

Before the lane, decide what kind of piece this is. The `intents` block of
`references/video-lanes.json` holds the defaults each one carries.

| Intent | Choose it when the request | Time driver | Narration and on-screen text |
| --- | --- | --- | --- |
| `presentation` | explains, teaches, reports, pitches | voice | expected |
| `story` | follows a character who wants something through a change | performance | optional |
| `experience` | asks for a mood, a trailer, an intro, a visualizer | music | none unless requested |

- The intent is not the lane. Any lane can serve any intent; do not derive one
  from the other.
- A mixed request has one dominant intent. A product story that ends on a claim
  is a story; a talk with one anecdote is a presentation. Record the dominant
  one and note the exception in the art direction. A request that pairs an
  experience format with content to explain ("a trailer that shows what we
  built") is not settled by its words: ask.
- If two intents would produce different pieces and the request does not settle
  it, this is the first axis of the grouped question.
- For a presentation, mark each beat that asserts the behaviour of something
  real and existing. Those beats need a demonstration of that thing; a labelled
  box is not evidence. A capture of the artifact, or its real output or content
  reproduced verbatim in code, is. If neither can be obtained, record the
  capability gap.

## 1. Infer, do not assume

Read the request and `references/video-lanes.json`. With the intent decided,
determine the **production capability**, then the lane label that carries it.

- If the request names a style, reference, or format, use it and drop that axis
  from the question. Naming a style does not settle the intent.
- If the request is style-ambiguous, propose one lane plus its capability set as
  the recommendation.
- If no lane fits, use `custom` and define its capability set in the brief; never
  force the request into a lane that changes its intent.
- Never default to the style of the previous project.
- A lane name is not a look. `vector-explainer` means code-rendered 2D diagrams;
  it does not mean dark cards with a gold accent. The aesthetic comes from the
  art direction.

## 2. Probe the capability before promising the lane

For the inferred lane, read its `capabilities` and `requires` in
`references/video-lanes.json` and check the harness:

| Capability | Evidence required |
| --- | --- |
| `code-2d`, `vector-diagram`, `kinetic-type`, `ui-mock` | HyperFrames composition + a rendered test frame |
| `character-rig`, `sprite-animation` | rig/sprite format + one pose or frame test |
| `3d-render`, `camera-3d` | engine present + one deterministic test frame |
| `raster-generation`, `footage-montage` | approved source + one sample |
| `shader-fx` | deterministic effect verified under `render_frames.mjs` |
| `voice`, `music` | local engine + one generated sample |

A missing capability is a **blocker** or an **explicitly approved downgrade**.
Never silently replace the missing shot with cards and text. Record the decision
in `art-direction.md` under `## Capability check`.

## 3. Ask one grouped question, only when needed

Use one interaction with four axes. Each axis carries a recommended default and
one or two alternatives. Do not ask a separate question per field, and drop any
axis the request already settles.

| Axis | What to ask | Default |
| --- | --- | --- |
| Intent | "A presentation, a story, or an experience?" | Inferred from the request |
| Lane and format | "Which visual lane and aspect ratio?" | Inferred lane; 16:9 unless the destination says otherwise |
| Aesthetic and rhythm | "Palette, typography, and motion rhythm?" | From the art direction; rhythm follows the intent's time driver |
| Audio | "Voice, music, and SFX?" | From the intent: voice and music for a presentation, music and SFX for an experience, what the performance needs for a story. Local engines; no paid service without approval |

If the user says "surprise me", choose a lane and state the reason in one line.
If the user already approved equivalent references, reuse them instead of asking.

## 4. Write the style brief

Create `style-brief.md` in the project root. Keep it short and machine-readable:

```markdown
# Style Brief

- Intent: <presentation | story | experience>; <one line: why this and not the others>
- Lane: <lane id from video-lanes.json>
- Capabilities: <the lane capabilities this project actually uses>
- Art direction: art-direction.md (approved: no)
- References: <URLs, files, or "none">
- Palette: <hex values or tokens>
- Typography: <families and roles>
- Motion: <calm | beat-driven | camera-led | i2v | progressive-draw | stepped>
- Aspect / resolution: <16:9 | 9:16 | 1:1> / <1920x1080 | ...>
- FPS: <24 | 30 | 60>
- Duration / pacing: <seconds; cuts per minute>
- Voice: <local voice | ElevenLabs | none>
- Music / SFX: <local library | generated | none>
- Asset policy: <external assets allowed/forbidden (reason)>; <AI raster allowed/forbidden (reason)>
- Constraints: <brand, legibility, licensing, deadline>
- Approved e00: no
```

The `Intent` line starts with the intent id as a single word; the gate reads
that word and ignores the rest of the line. `Voice: none` is the normal value
for an experience, not an omission.

The `Asset policy` line is a project decision, not a house rule. Record the
reason. When the visual language needs an asset class the policy forbids, surface
the tradeoff and ask; never inherit the previous project's ban by default.

## 5. Generate e00

Render `keyframes/e00-styleboard.png` as a real hero frame at the project's
aspect and resolution:

- the actual subject, shot type, and composition from the art direction, not a
  collage of unrelated references;
- the palette applied to background, subject, and accents;
- what the intent says `e00` must prove: for a presentation, one real claim
  with the typography in scene and a legible text sample; for a story, the
  protagonist in its world in a pose that acts; for an experience, the mood at
  full quality, with no text unless the brief asks for it;
- the intended texture and depth model, visible in the frame;
- a motion cue: one still frame that shows the intended camera, parallax, or
  effect layer;
- a 5-second audio preview as a separate file next to the project (for example
  `e00-preview.wav`), if voice or music is part of the brief.

`e00` proves the contract. It is not a mood board and it is not a scene: it does
not belong in `timeline.json` and the motion gate ignores it.

## 6. Approve, then load the lane

- Present `e00`, the style brief, and the art direction together. Ask for
  approval or concrete changes.
- If the user changes one decision, update that field, regenerate `e00`, and
  leave the approved decisions untouched.
- Only after approval, load the lane's minimum skills: one preproduction skill,
  one or two visual skills, one audio skill, and the render/QA skill. Add
  another only when the request needs it; never load the whole catalog.

## Hard rules

- No lane before the intent. `idu-pi video render` refuses a full render whose
  brief has no valid `Intent:` line.
- No full render before `e00` approval; `idu-pi video render` enforces this gate.
- No multi-shot HTML before `art-direction.md` exists.
- One primary engine per project. Other engines provide assets or effects, not a
  second timeline.
- A style preset is opt-in. `kanagawa-html` contributes preset tokens, ambient
  blur, particles, and its typography only when the brief selects that aesthetic;
  otherwise it is used in craft-only mode (motion, determinism, export).
- Do not put shaders or texture behind text without verifying contrast and
  legibility.
- Do not use AI raster for UI, charts, or text that must stay exact.
- Do not promise a lane whose primary engine is `planned`. Load only `available`
  companion skills; omit `planned` ones and note them as follow-ups.
- The artistic audit (`references/visual-qa.md`) is a separate verdict from the
  motion and audio gates. Neither replaces the other.

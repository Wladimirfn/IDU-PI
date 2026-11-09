# Style Brief and e00 gate

Use this before any full video render. The goal is to infer a style lane, confirm
only what changes the outcome, and approve one real frame before production.

## 1. Infer, do not assume

Read the request and `references/video-lanes.json`. Pick the closest lane from
the user's words, references, or prior approved work.

- If the request names a style, reference, or format, use it and skip the question.
- If the request is style-ambiguous, propose one lane as the recommendation.
- If no lane fits, use `custom` and define the lane in `style-brief.md`; never
  force the request into a lane that changes its intent.
- Never default to the style of the previous project.

## 2. Ask one grouped question, only when needed

Use one interaction with three axes. Each axis carries a recommended default and
one or two alternatives. Do not ask a separate question per field.

| Axis | What to ask | Default |
| --- | --- | --- |
| Lane and format | "Which visual lane and aspect ratio?" | Inferred lane; 16:9 unless the destination says otherwise |
| Aesthetic and rhythm | "Palette, typography, and motion rhythm?" | Lane defaults; calm or beat-driven according to the lane |
| Audio | "Voice, music, and SFX?" | Local voice and local music; no paid service without approval |

If the user says "surprise me", choose a lane and state the reason in one line.
If the user already approved equivalent references, reuse them instead of asking.

## 3. Write the style brief

Create `style-brief.md` in the project root. Keep it short and machine-readable:

```markdown
# Style Brief

- Lane: <lane id from video-lanes.json>
- References: <URLs, files, or "none">
- Palette: <hex values or tokens>
- Typography: <families and roles>
- Motion: <calm | beat-driven | camera-led | i2v | progressive-draw | stepped>
- Aspect / resolution: <16:9 | 9:16 | 1:1> / <1920x1080 | ...>
- Duration / pacing: <seconds; cuts per minute>
- Voice: <local voice | ElevenLabs | none>
- Music / SFX: <local library | generated | none>
- Constraints: <brand, legibility, licensing, deadline>
- Approved e00: no
```

## 4. Generate e00

Render `keyframes/e00-styleboard.png` as a real 1920x1080 hero frame:

- the actual subject and composition, not a collage of unrelated references;
- the palette applied to background, subject, and accents;
- the chosen typography in scene, including one legible text sample;
- a motion cue: one still frame that shows the intended camera, parallax, or
  effect layer;
- a 5-second audio preview, if voice or music is part of the brief.

`e00` is a gate artifact. It is not a scene in `timeline.json` and it is not
graded by the motion gate. Use the Studio or a one-frame render; keep it out of
the delivery timeline.

## 5. Approve, then load the lane

- Present `e00` and the style brief together. Ask for approval or concrete
  changes.
- If the user changes one decision, update that field, regenerate `e00`, and
  leave the approved decisions untouched.
- Only after approval, load the lane's minimum skills: one preproduction skill,
  one or two visual skills, one audio skill, and the render/QA skill. Add
  another only when the request needs it; never load the whole catalog.

## Hard rules

- No full render before `e00` approval.
- One primary engine per project. Other engines provide assets or effects, not a
  second timeline.
- Do not put shaders behind text without verifying contrast and legibility.
- Do not use AI raster for UI, charts, or text that must stay exact.
- Do not promise a lane whose primary engine is `planned`. Load only `available`
  companion skills; omit `planned` ones and note them as follow-ups.

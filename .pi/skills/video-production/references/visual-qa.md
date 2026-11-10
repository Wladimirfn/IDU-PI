# Visual QA: artistic audit

Two verdicts, never merged. `validar_motion.py` and `validar_video_audio.py` are
technical gates: alignment, flicker, frozen frames, clipping, duration. This
audit is artistic: does the piece read, does it belong to the declared language,
and is it saying the same thing the same way over and over.

A passing gate does not make a good scene. A good scene does not excuse a
flickering render.

## When it runs

1. **Before `e00` approval**: does the visual language exist at all?
2. **Per scene, before the keyframe is accepted**: does the still carry its beat?
3. **Once over the full piece**: variety and rhythm across scenes.

## Inputs

- The piece intent from `style-brief.md`. It decides how check 1 is read.
- `art-direction.md` (intent, reading order, language, shot sheet, acceptance
  criteria).
- `guion.md` lines for the scene, verbatim, when the piece has narration.
- `timeline.json` beats.
- `keyframes/eNN.png` and, when available, a short capture of the motion.
- The previous and next scene, for variety.

Never audit from the keyframe alone. An element that looks redundant may be
required by the narration; an element that looks fine may contradict the beat.

## Checks

| # | Check | Question | Fails when |
| --- | --- | --- | --- |
| 1 | Beat reads | Does the frame carry the beat in the unit of the piece intent? See below | The frame shows the topic but not the beat |
| 2 | Focal hierarchy | Does the eye hit the contract's first, second, third? | Everything has equal weight, or the wrong element wins |
| 3 | Style fidelity | Do the six language axes hold, with evidence? | Any axis drifted, especially shape and texture |
| 4 | Variety | Does this shot differ from its neighbours? | Consecutive shots share the layout skeleton |
| 5 | Asset appropriateness | Does each asset type match the strategy? | Placeholder art, generated UI, raster text |
| 6 | Typography | Is the declared role respected? | Display type used for data, text over busy texture |
| 7 | Motion motivation | Does each movement express the beat? | Decorative loops, idle float, motion for motion |
| 8 | Composition | Safe areas, aspect framings, tangents, collisions | Subject clipped, accidental tangents, dead thirds |
| 9 | Reference use | Borrowed what was named, copied nothing forbidden | A layout or brand was reproduced |
| 10 | Proof | Does every beat that asserts the behaviour of a real command, test run, UI or file show that artifact or its real output, whatever its `Proof` cell says? | The artifact is drawn as a labelled box, invented, or relabelled `diagram` to avoid showing it |

### Check 1 by intent

| Intent | The frame passes when | Typical failure |
| --- | --- | --- |
| `presentation` | a viewer who only sees it can state the claim | a headline and cards that name the topic |
| `story` | a viewer can say who wants what and what just changed | a character standing next to an explanation |
| `experience` | it carries the declared mood with no caption | text or a diagram doing the work the image should do |

Judge the piece as what it declares. A wordless frame is not a legibility
failure in an experience, and a clear diagram is not a pass in a story.

### The intent test

Once over the full piece: does it deliver its declared intent, or did it fall
back to a narrated slide deck? Signs of the fallback, whatever the intent says:
every scene opens with a headline, the voice carries all the meaning while the
image waits, the protagonist never causes anything, the cut ignores the music.
A piece that fails this test is a `block`, because every scene was built on the
wrong structure.

### The same-card test

Three or more scenes that share the same card/grid skeleton is a defect, not a
style. It reads as a template even when each card has different content.

Legitimate exceptions: the repetition is named in `art-direction.md` as a motif
(a control room, a recurring dashboard), or the format is a deliberate series
where consistency is the point. Name it; do not let it happen by default.

The fix is not "add more cards". It is a different shot type: a demonstration, a
diagram with a different axis, a close-up, a full-bleed image, a type-only frame.
If the lane cannot produce a different shot type, that is the capability gap the
art-direction contract must record.

### Style fidelity evidence

Do not answer "yes, it looks Kanagawa". State the evidence per axis:

```
Shape: geometric, 12px radii, no brush strokes -> is
Depth: layered 2.5D, three planes -> is
Texture: clean vector, no grain -> is
Color: one accent, two appearances max -> is
Type: Archivo Black display only, mono for labels -> is
Motion: camera-led dolly, no decorative loops -> is
```

If an axis cannot be evidenced, it drifted.

## Verdict

- **pass**: every check holds; note the evidence for the axes.
- **revise**: one or more checks fail and the fix is local (move a focal point,
  change a shot type, drop an effect, fix contrast).
- **block**: the scene misreads the beat, violates the declared language, or is a
  recoloured duplicate of a neighbour. Blocking is reserved for comprehension and
  contract violations, never taste.

## Output contract

Per scene:

```
eNN | pass | revise | block
failed: <check numbers>
evidence: <what is on screen, not what was intended>
fix: <one concrete change>
```

Full piece:

```
intent: <declared intent> | delivered | fell back to <what it became>
variety: pass | revise
rhythm: <one paragraph: where the piece breathes, where it repeats>
capability gaps: <none | list>
```

## Relationship to the technical gates

| Verdict | Owner | Blocks delivery |
| --- | --- | --- |
| Artistic audit | `references/visual-qa.md` | Yes, on `block` |
| Motion gate | `validar_motion.py` | Yes, on error |
| Audio gate | `validar_video_audio.py` | Yes, on error |
| Lint | `hyperframes lint` | Yes, on error; warnings advisory |

A scene cannot ship with any verdict blocked. Revise locally and re-audit only
the affected checks; do not re-run the whole audit as a loop.

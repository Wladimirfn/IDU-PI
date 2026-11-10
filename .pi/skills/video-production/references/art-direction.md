# Art direction contract

The Style Brief records decisions: lane, palette, type, audio, aspect. This
contract records the **visual language and the shot plan**. Two projects can
share `Lane: vector-explainer`, `#e0c15a`, and `motion: calm` and still need
completely different compositions. Without this artifact the renderer reproduces
a look, not an intention.

## When it is required

- Every video with more than one shot, a recurring subject, characters, or a beat
  that must read as a shot: narrative, 3D, documentary, hybrid, explainer with
  distinct scenes.
- A single-frame or single-loop piece may fold this into `style-brief.md`, but
  keep the same fields so the artistic audit has something to test.
- Required **before the first line of HTML**. If the project already has HTML,
  write it from the approved frames and record the gap in `## Log`.
- `e00` must prove this contract, not just the palette. A hero frame that
  ignores the shot plan is not an approval artifact.

## The artifact: `art-direction.md`

Create it in the project root. Keep it short enough to read before every scene
and specific enough to fail.

```markdown
# Art Direction

- Approved: no
- Contract version: 2
- Piece intent: <presentation | story | experience, copied from style-brief.md>

## Intent
One sentence per beat, in the unit the piece intent defines: the claim the
viewer can restate (presentation), the change in the protagonist's situation
(story), or the shift of energy or mood (experience).

## Reading order
Per shot: what the eye hits first, second, third.

## Visual language
| Axis | Is | Is not |
| --- | --- | --- |
| Shape grammar | | |
| Depth model | | |
| Texture | | |
| Color logic | | |
| Typography role | | |
| Motion language | | |

## Shot / beat sheet
| Beat | Time | Shot type | Subject | Composition | Movement | Transition | Must read | Proof |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |

## Character performance
Required for a story; otherwise only when characters act. Pose, expression, gaze, hand interaction per beat.
Point to `performance-sheet.md` from story-continuity.

## Asset strategy
Per element: code-native (CSS/SVG/canvas), generated raster, stock/footage, 3D
render. Include the asset policy decision and its approval.

## Capability check
| Capability | Required by | Available | Evidence | Approved fallback |
| --- | --- | --- | --- | --- |

## Acceptance criteria
3-6 testable artistic statements.

## References
Each reference says what to borrow and what not to copy.
```

## How to fill each field

### Piece intent

Copy the intent from `style-brief.md`. It decides what a beat is and what the
shot sheet must contain, so the rest of the contract is read through it:

- **presentation**: each beat is a claim. The sheet needs a `Proof` value per
  beat and the type system is part of the language.
- **story**: each beat is a change for the protagonist. `## Character
  performance` is required, and the sheet reads as cause and effect: a beat
  exists because of the one before it. If a headline, a card or the voice
  carries the point while the character only illustrates it, the beat is a
  presentation beat.
- **experience**: each beat is a shift of energy. Time comes from the music, so
  the `Time` column follows its sections; narration and text are absent unless
  the brief asks for them.

If the beats cannot be written in the unit of the declared intent, the intent is
wrong or the piece is still a presentation in disguise. Fix that before the
shot sheet.

### Intent and reading order

One takeaway per beat. "Show the ten lanes" is a topic, not an intent. "The ten
lanes are ten different ways of seeing; the viewer must feel range, not a list"
is an intent, and it changes the composition.

Reading order is not optional. A frame with three equal-weight elements has no
composition; it has inventory. State what wins.

### Visual language: six axes

Each axis has an `is` and an `is not`. The `is not` is what prevents drift back
to the previous project's look.

- **Shape grammar**: geometric, organic, brush, pixel, modular, anatomical.
  Decide the primitives and the corner language.
- **Depth model**: flat, layered 2.5D, true 3D, collage, miniaturist. This is a
  narrative decision: depth tells the viewer what is near and what is context.
- **Texture**: clean vector, grain, paper, halftone, pixel, photographic,
  painterly. Texture is the fastest way to make two "same palette" pieces read
  as different styles.
- **Color logic**: what color *means*, not only which hex. Hierarchy, accent
  budget, temperature, saturation ceiling, allowed gradients.
- **Typography role**: display, narration, data, caption. State where type is
  allowed and what never carries text.
- **Motion language**: what moves and why. Subject-led, camera-led, type-led,
  stepped, continuous. Motion that does not express a beat is decoration.

A palette swap does not change the style. If the brief asks for cartoon, pixel
art, or 3D, the shapes, composition, texture, and motion must change too; the
tokens are the smallest part of the decision.

### Shot / beat sheet

This is the storyboard in text form. It is not a list of scenes: each row is a
shot with a shot type, a subject, a composition, a movement, and a transition.

- Shot type: wide, medium, close, detail, insert, overhead, POV.
- Composition: where the subject sits, what carries the eye, negative space.
- Movement: what moves between the start and end of the shot, and why.
- Transition: cut, match cut, whip, dissolve, hard replace, hold.
- Must read: what must survive a pause and a small screen. A fact for a
  presentation; who wants what and what changed for a story; the mood for an
  experience.
- Proof: `demo`, `diagram` or `none`. In a presentation, a beat that asserts the
  behaviour of a real, existing artifact is `demo`: a capture of the artifact
  working, or its real output or content reproduced verbatim in code, never an
  invented stand-in. `diagram` is for what is abstract or invisible, not for a
  real artifact that is easier to draw than to show. Story and experience beats
  are normally `none`.

If two consecutive rows have the same shot type, composition, and movement, the
piece will feel like one card repeated. That is a directing decision, not a
rendering bug.

### Character performance

Required for a story; otherwise only when the piece has characters. The performance sheet from
`story-continuity/references/character-continuity.md` supplies poses,
expressions, gaze, hand interaction, and rig constraints per shot. Link it here;
do not duplicate the locks.

### Asset strategy and asset policy

Per element, choose the cheapest type that can carry the intent:

| Asset type | Use for | Avoid |
| --- | --- | --- |
| Code-native (CSS/SVG/canvas) | diagrams, UI, type, exact geometry, deterministic loops | organic realism, complex lighting |
| Generated raster | painted backgrounds, characters, textures, stills | exact text, UI, charts, brand marks |
| Stock / footage | observed reality, documentary, B-roll | anything presented as a product's real UI |
| 3D render | spatial products, environments, camera moves | text inside 3D, unproven headless determinism |

Record the **asset policy** as a project decision with a reason:
`external assets: allowed | forbidden (reason)`, `AI raster: allowed | forbidden
(reason)`. A previous project's constraint is not a house rule. When the visual
language needs an asset class that the current policy forbids, surface the
tradeoff and ask; do not silently downgrade the scene.

### Capability check

The lane names a capability set. The harness must actually be able to produce
it. Fill the table with evidence, not intentions:

- `3d-render` -> engine present and a test frame rendered.
- `character-rig` -> rig format and a pose test.
- `sprite-animation` -> sprite sheet or per-frame pipeline.
- `raster-generation` -> local model or approved service, with a sample.
- `footage-montage` -> licensed source and an edit path.
- `shader-fx` -> deterministic effect verified under the delivery renderer.
- `voice` / `music` -> local engine and a generated sample.

A missing capability is a **blocker** or an **explicitly approved downgrade**.
Never replace the shot with cards and text and call it the same lane. Report the
gap with the evidence.

### Acceptance criteria

Three to six statements an auditor can fail. Examples:

- Each lane shows a distinct visual sample, not a recolored card.
- No two consecutive beats share the same layout skeleton.
- The accent color appears at most twice per frame.
- Every shot's first read matches the reading order.
- No text sits over a texture that reduces contrast below 4.5:1.

Taste is not a criterion. "Looks premium" cannot be verified; "no two consecutive
beats share a skeleton" can.

### References

For each reference, write two lines: **borrow** and **do not copy**. A reference
that is only a URL is a mood, not a direction. Borrowing composition, color
logic, or texture is legitimate; copying a layout, a brand, or a living artist's
signature is not.

## Approval and change control

- Present `art-direction.md` with `e00`. Approve both together.
- A change to the visual language updates the affected axis, the shot sheet, the
  acceptance criteria, and `e00`; it does not silently change one scene.
- A change to one shot updates that row and its scene; it does not reopen the
  whole contract.
- The artistic audit (`references/visual-qa.md`) tests this contract. The motion
  and audio gates never substitute for it.

## Hard rules

- The beats are written in the unit of the piece intent. A story or an
  experience whose beats are claims is a presentation and is built as one or
  rewritten.
- A presentation beat that asserts the behaviour of a real artifact shows that
  artifact or its real output, whatever its `Proof` cell says. If neither can be
  obtained, that is a capability gap to report, not a diagram to draw.
- No HTML before the contract for a multi-shot piece.
- No `e00` approval without the contract; no full render without `e00` approval.
- A missing capability is reported, never papered over.
- The asset policy is per project and approved; never inherited by default.
- No two consecutive beats may share the same composition skeleton unless the
  contract names the repetition as a deliberate motif.

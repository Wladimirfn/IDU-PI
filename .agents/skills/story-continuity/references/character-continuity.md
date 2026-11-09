# Character continuity: performance, poses, and 2D rigs

Identity continuity keeps the same person. Performance continuity keeps the same
person **acting coherently**. A character can have a perfect identity lock and
still feel like a different actor in every shot because the pose, eyeline, and
hands do not carry over.

Use this reference when a character performs an action, changes expression,
interacts with a prop, or appears in more than one shot. It extends the
continuity bible; it does not replace it.

## 1. Identity is a lock, performance is a state

| Class | Examples | Rule |
| --- | --- | --- |
| Lock | face, body proportions, hair, wardrobe base, palette, voice | byte-identical in every prompt and every code constant |
| State | pose, expression, gaze, hand position, dirt, wetness, damage | tracked per shot; never copy the previous shot's state by default |

Do not lock a pose into the character bible. A pose that repeats in every shot
reads as a mannequin. Track it in the performance sheet.

## 2. IDs

Add these to the stable-ID set when the piece has acting:

- `POSE-*` — one named body configuration. Reuse a pose by ID, never by
  paraphrase. A new pose gets a new ID.
- `EXPR-*` — one named facial expression, with the muscle cues that produce it.
- `RIG-*` — one separable body part with a pivot, z-order, and motion range.

A shot references `CHAR-*`, `POSE-*`, `EXPR-*`, and the `RIG-*` parts it uses.
Renaming is forbidden; a changed pose is a new `POSE-*`, not an edit of the old
one.

## 3. The performance sheet: `performance-sheet.md`

One row per shot, written before the keyframe prompts:

```markdown
| Shot | Character | Pose | Expression | Gaze | Hands / prop | Weight | Changes from previous |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SHOT-01 | CHAR-01 | POSE-01 | EXPR-02 | to PROP-01 | right hand on latch | front foot | — |
| SHOT-02 | CHAR-01 | POSE-03 | EXPR-02 | to CHAR-02 | both hands empty | back foot | released latch, weight shifts back |
```

The "changes from previous" column is the continuity check. If it is empty for
two consecutive shots, the character is frozen; if it contradicts the action, the
shot is wrong.

### Pose rules

- **Silhouette first.** Fill the pose black. If the action is not readable in
  silhouette, the pose is not readable at video speed.
- **One action per shot.** The same rule as one motion per shot: a pose change
  plus a walk plus a turn is three shots, not one.
- **Weight and line of action.** State where the weight rests and the single
  curve that runs through the body. A pose without weight floats.
- **Hands are continuity.** Note which hand holds what and whether it is empty
  before and after. Handedness drift is the most common performance break.
- **Eyeline is a target.** `to CHAR-02`, `to PROP-01`, `to camera`, `off-screen
  left`. "Looking somewhere" is not a target.

### Expression rules

- Name the expression and its cues: brow, lid, mouth, jaw, breath.
- Expression changes are states: a shot may start in `EXPR-01` and end in
  `EXPR-02` only if the motion prompt says so.
- Do not stack micro-expressions in one shot. One readable change beats three
  subtle ones.

## 4. Two-dimensional rigs

When the character is drawn in code (SVG, canvas, CSS), the rig is a contract.

### Rig spec

| Field | What to record |
| --- | --- |
| Parts | `RIG-head`, `RIG-torso`, `RIG-upper-arm-L`, ... one entry per movable piece |
| Pivot | local coordinates of the joint, not the part's center |
| Z-order | explicit stack, back to front; hair and hands often need overrides |
| Range | min/max rotation or translation per joint; where the part may not go |
| Deformation | none, squash/stretch limits, or a named mesh |
| Attach points | where props and garments bind |
| Never moves | parts that must stay rigid to preserve identity |

### Code mapping

- Each part is a group with a stable `id`; the rig spec is the source of truth.
- The pose is a function of `t`: joint transforms are computed from `POSE-*`
  constants, never from CSS transitions or wall-clock timers.
- Interpolation between poses uses the same spring/ease language as the rest of
  the piece; do not mix a linear rig with spring UI motion.
- Locks become constants (proportions, palette, costume base), not magic numbers
  repeated per scene.
- A rig test frame is part of `e00` or the first keyframe of the character lane.

### Generated characters

When the character comes from an image or video model, the rig is implicit. The
performance sheet becomes prompt data: pose, expression, gaze, hands, and the
change from the previous shot, each with its locks verbatim. Attach the reference
images per `REF-*`/`PLAN-*`; never let the model invent a new costume state.

## 5. Blocking and continuity checks

Before accepting a character shot:

- Same height and proportions against the previous shot.
- Same handedness and same prop hand.
- Costume state matches the story state (torn, wet, open) and does not regress.
- Gaze target resolves to an existing entity or a declared off-screen direction.
- Silhouette reads at the delivery size.
- The pose's line of action and weight match the action, not the previous frame.
- The rig has no part outside its declared range; no accidental z-order flip.

## 6. Output

Add `performance-sheet.md` to the continuity chain when characters act. Return it
with the shot list, one row per `SHOT-*`, plus the `RIG-*` spec when the character
is drawn in code. The review checklist gains the performance and rig checks.

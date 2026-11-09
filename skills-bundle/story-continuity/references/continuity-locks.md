# Continuity locks

A continuity lock is an exact, paste-ready string that pins a fact which must
hold across multiple shots. Write each lock once in `continuity-bible.md`, then
copy it verbatim into every keyframe prompt, motion prompt, and reference-image
prompt it governs. A lock differs from a state: a lock never changes during the
story; a state (wet, open, damaged, spent) is tracked per shot in the shot list.

## Lock templates

### Identity lock (`CHAR-*`)

One noun phrase, 30–50 words, fully re-specifying the character to a model with
no memory. Build in this order and count the words once:

1. One age as a number (never a range); demographic anchor only where it is a
   fact about the face.
2. Two or three face-structure facts (jaw, eye set, brow, nose, cheekbones).
3. Exactly one checkable landmark — a mole with its side, a scar with a length,
   a chipped tooth. This is the QC handle: without it, drift cannot be proven.
4. One hair spec: length, cut, parting or tie-up side.
5. One wardrobe anchor, last: garment, colour, material, one distance-checkable
   detail.

Never put in the identity string: mood or judgment adjectives ("beautiful"),
camera or lighting words ("cinematic", "close-up"), celebrity comparisons, age
ranges, era words doing wardrobe's work, negative instructions ("do not change
the face"), progressive states, or a second character.

Example (audits clean):

```text
NORA, 34, a woman with a square face, thick arched eyebrows, a small scar
through the left eyebrow, dark brown hair in a low bun, a brass compass on a
leather cord, in a charcoal wool field jacket with a storm flap
```

### Wardrobe lock

For garments beyond the identity string's single anchor, or for costume changes
between scenes: one line per garment with colour, material, closure state, and
which side it is worn on. Garment = lock; its condition (dusty, torn, wet) =
state, tracked per shot.

### Location lock (`SCENE-*`)

The fixed facts of a place: wall colours and their height lines, floor material,
door/window positions relative to each other, permanent fixtures, era-defining
objects. Never include camera-relative words ("frame-left"): one location is
seen from both sides, and those words flip.

```text
third-floor landing of a 1937 apartment block, peeling dark-green wainscot to
waist height, cracked cream plaster above, worn red floor tile, dark-stained
door with a brass knob and a chipped lower-left corner, stairwell window at the
head of the stairs opposite the door
```

### Light lock

World-space only: the source, its height, its quality (hard/soft), the lit:shadow
ratio, what the fill actually is, and what stays underexposed. The per-shot,
camera-relative sentence ("key reads high camera-left 45°") is written in each
prompt from the shot list — never into the lock itself.

```text
a single bare filament bulb hanging over the stairhead, warm, hard, above head
height, 5:1 lit side to shadow side with no fill but plaster bounce
```

### Palette lock

One line: dominant colour, accent colour, saturation level, in plain colour
words. Used when multi-session generation risks a grade shift between shots.

### Negative lock

The standing exclusions every prompt carries, naming instances, never
categories ("no plastic buttons and no printed logos" beats "no modern
objects"). Six classes is the working ceiling so it stays pasteable:

```text
no rendered text, signage or numerals; no watermark; no extra people; no face
or costume change; no printed logos; the door never opens
```

### Voice lock

When a character speaks or narrates: one line fixing voice quality in
describable terms (pitch, pace, texture — e.g. "low, slow, gravelly male voice,
mid-30s"), plus the language. Used so TTS or dialogue-capable video models stay
consistent; never a named person's voice.

## Reusing locks

- Copy, never retype. Retyping is how paraphrase gets in.
- Revise in the bible first, then propagate by copy to every affected prompt.
- A lock that appears in a prompt under a different wording is a defect even if
  the meaning looks the same.
- When a target tool splits wardrobe into its own slot, split the identity
  string's anchor into that slot — a split of one string, not a second string.
- If the target tool takes prompts in another language, freeze one lock in that
  language too, at authoring time; translating per shot is paraphrase by another
  route.

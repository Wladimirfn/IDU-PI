# Artifact chain

The five documents form a chain. Each one is the single source of truth for its
layer; each downstream document consumes the upstream ones by ID and by verbatim
lock strings. Read this file before writing or revising any document in the
chain.

## The chain

| # | Document | Produced by | Consumes | Consumed by |
|---|---|---|---|---|
| 1 | `continuity-bible.md` | Step 2 (bible) | the brief/script, entity list | shot list, keyframe prompts, video prompts, review |
| 2 | `shot-list.md` | Step 3 (shot list) | bible, brief/script | keyframe prompts, video prompts, review |
| 3 | `keyframe-prompts.md` | Step 4 (keyframes) | bible, shot list | video prompts (start frames), image generation, review |
| 4 | `video-prompts.md` | Step 5 (video prompts) | bible, shot list, keyframe prompts | AI video generation, review |
| 5 | `review-checklist.md` | Step 6 (review) | all four above | the creator's go/no-go before generation or render |

`brief-notes.md` (optional, Step 1) feeds document 1 and is consumed by nothing
else. When no AI video generation is involved, document 4 is optional; the rest
of the chain still applies.

## Inputs and outputs per document

### 1. `continuity-bible.md`

- **Input:** the brief or script, read once, in full.
- **Output:** every `CHAR-*`, `SCENE-*`, `PROP-*` with its verbatim lock
  string; the light lock; the negative lock; the voice lock (when narration or
  dialogue exists); every `PLAN-*` slot still pending; optional `IMG-*`
  reference-sheet prompts (character turnaround, location plate, prop sheet) at
  the end of this document, under their owning entity.
- **Rule:** if a visible fact must hold across more than one shot and a viewer
  could notice it changing, it is a lock. If it changes during the story (wet
  hair, opened door, spent prop), it is a state, tracked per shot in the shot
  list, not a lock.

### 2. `shot-list.md`

- **Input:** the bible; the brief's events.
- **Output:** one row per `SHOT-*`: in/out timing, start state, one action, end
  state named explicitly, framing, and the continuity anchors (which IDs and
  locks this shot must hold).
- **Rule:** the end state of `SHOT-n` is the start state of `SHOT-n+1` unless a
  deliberate cut covers the difference. If the end state cannot be phrased as
  something photographable, the shot has two actions in it and must be split.

### 3. `keyframe-prompts.md`

- **Input:** the bible (locks verbatim); the shot list (start states, framing).
- **Output:** one prompt per `SHOT-*` describing the start frame only: who is
  visible, wardrobe, pose, light direction, composition, aspect ratio. The
  visual basis lists every `CHAR-*`/`SCENE-*`/`PROP-*` the frame shows, each
  with its lock pasted verbatim.
- **Rule:** nothing that appears only at the end of the shot enters this prompt.
  `IMG-*` reference sheets are generated from the bible, not from a shot; never
  assign them a `SHOT-*`.

### 4. `video-prompts.md`

- **Input:** the bible; the shot list; the keyframe prompts (as the fixed start
  images).
- **Output:** one `MOTION-*` per `SHOT-*`, duration equal to the shot's.
  Describes only what moves between start and end: the action with pace and
  direction, one camera move or `locked`, an explicit end state, the locks
  verbatim, 2–4 shot-specific negatives, and the reference attachments.
- **Rule:** do not re-describe what the keyframe already proves; describe the
  bridge. Attach `REF-*` files (real) or specify `PLAN-*` slots (pending) per
  shot with attach order and what each governs.

### 5. `review-checklist.md`

- **Input:** all four documents, read together, not in isolation.
- **Output:** a pass/fail verdict per section with the failing item quoted.
- **Rule:** a broken linkage (an ID used but never defined, a lock that differs
  by one word between two files) is a defect even when every individual
  document reads fine.

## Linkage rules

- Every ID used in documents 2–5 must be defined in document 1 (entities) or
  document 2 (shots). An undefined ID is an error.
- Every `SHOT-*` appears exactly once in document 2, once in document 3, and —
  when present — once in document 4 as its paired `MOTION-*`. Counts must
  reconcile: `count(SHOT-*) == count(MOTION-*)`.
- Lock strings are byte-identical everywhere they appear. When revising a lock,
  change it in the bible first, then propagate by copy to every affected
  prompt; never edit it per prompt.
- Splitting a shot (`SHOT-04a`, `SHOT-04b`) keeps the parent's anchors; each
  half gets its own keyframe and motion prompt with the split's timing.
- States that progress across shots (injury, dirt, wetness, door open) are
  written in the shot list per shot and carried into that shot's prompts; they
  never enter the bible's locks.

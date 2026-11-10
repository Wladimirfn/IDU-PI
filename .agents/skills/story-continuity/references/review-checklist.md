# Review checklist

Run this before any generation, render, or hand-off. Read all five documents
together; most defects are cross-file and invisible in any single file. Record
pass/fail per section and quote the failing item.

## 1. Structure

- [ ] Every entity mentioned anywhere has an ID (`CHAR-*`, `SCENE-*`, `PROP-*`)
      defined in the continuity bible.
- [ ] Every `SHOT-*` in the shot list appears exactly once in
      `keyframe-prompts.md` and (when present) once in `video-prompts.md` as
      its `MOTION-*`.
- [ ] `count(SHOT-*) == count(MOTION-*)` when video prompts exist.
- [ ] Shot numbers follow story order, stay stable, and splits use `04a`/`04b`
      style suffixes — no renumbering.
- [ ] No genre imports: no episode-length rules, hook formulas, or default
      aspect ratios the brief did not state.

## 2. Continuity

- [ ] The end state of `SHOT-n` equals the start state of `SHOT-n+1`, or the
      cut covering the difference is deliberate and written down.
- [ ] Every shot's continuity anchors are copied from the bible, not invented
      per row.
- [ ] Progressive states (injury, dirt, wetness, open/closed, held props) are
      tracked per shot and appear in that shot's prompts — not in any lock.
- [ ] Light direction does not flip between shots of the same moment unless a
      world source changed; every such change is justified in the shot list.
- [ ] Screen direction, eyeline match, and camera height/focal feel are
      consistent across the sequence, or the change is a written decision.

## 3. Prompt consistency

- [ ] Every lock string is byte-identical in the bible, keyframe prompts,
      motion prompts, and reference-image prompts. A one-word difference is a
      defect.
- [ ] Keyframe prompts describe the start frame only; end-of-shot content is
      absent.
- [ ] Each keyframe's visual basis names every visible entity ID; an entity
      named in the keyframe text but missing from its visual basis is an error.
- [ ] Motion prompts describe only the bridge between start and end — they do
      not re-describe what the keyframe proves.
- [ ] Negatives name instances, not categories; each shot carries 2–4
      shot-specific negatives plus the negative lock, not a copied wall.
- [ ] Each identity string is 30–50 words with exactly one checkable landmark.

## 4. Duration

- [ ] Each `MOTION-*` duration equals its `SHOT-*` duration exactly.
- [ ] Dialogue-bearing shots state their spoken length estimate and the shot
      length fits it (roughly 2.5–3 words/second in Spanish, ~4 syllables/second
      in Chinese for TTS pacing) — lengthen or split the shot when it does not.
- [ ] Total shot duration reconciles with the brief's target, if one was given.

## 5. Legibility

- [ ] Every prompt is paste-ready: complete, self-contained, ordered.
- [ ] Multi-paragraph model formats are delivered as one body submitted once,
      and the review says so explicitly.
- [ ] No judgment adjectives, camera words, or celebrity comparisons inside
      identity or location locks.
- [ ] Aspect ratio appears verbatim from the brief in each prompt's
      constraints — or appears nowhere, if the brief did not set one.

## 6. References

- [ ] Every `REF-*` points to a real file in the project that was inspected.
- [ ] Every planned external image is a `PLAN-*` slot stating which image, the
      attach order, and what each governs.
- [ ] No missing reference was silently downgraded to text-to-video: name the
      model, list the missing `PLAN-*` slots instead.
- [ ] `IMG-*` entries are labeled as prompts, not as existing images.

## 7. Licensing

- [ ] No text was copied verbatim from non-MIT sources; conceptual-only sources
      contributed no strings.
- [ ] Adapted material names its source in the project's attribution (see this
      skill's SKILL.md Attribution section and `shader-fx`'s
      `references/attribution.md` pattern).
- [ ] Characters, logos, and specific game/film assets are original or
      authorized; generic motifs only.

## Verdict format

```text
Section N: PASS | FAIL — <quoted failing item, file and shot ID>
Overall: READY | NOT READY — <blockers>
```

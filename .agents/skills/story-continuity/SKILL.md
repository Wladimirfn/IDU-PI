---
name: story-continuity
description: "Trigger: character continuity, shot continuity, storyboard chain, scene bible, shot list, motion prompt linkage, continuity bible. Genre-neutral continuity wrapper for multi-shot videos: stable IDs, exact locks, linked prompts. No drama tropes."
license: MIT
metadata:
  author: Wladimirfn / cross-cli skills-bundle
  version: 1.0.0
  updated: 2026-11-09
  sources: zenstory-ai/drama-skills (MIT), wuwangzhang1216/DirectorSKILL (cinematic-director, MIT), seedance2-storyboard (conceptual reference only, no text copied)
---

# Story continuity

Pre-production and continuity layer for any AI or code-rendered video with
characters, scenes, or more than one shot — explainer, horror, anime,
documentary, 3D, pixel. It produces five linked documents so a generation model
with no memory keeps the same people, rooms and light across every shot. It
carries no genre: no hooks, cliffhangers, 15 s episodes, default 9:16, or drama
formulas live here.

## Activation Contract

Load when the request involves recurring characters, locations or props across
two or more shots; a storyboard chain, shot list, or continuity bible; keyframe
prompts feeding motion prompts; or "keep the character consistent between
shots". Do not load for a single scene with no recurring entity, pure UI/data
explanations, or editing existing clips with no pre-production. No characters →
skip the character bible (locations/props still apply). No AI video generation
→ the video-prompt document becomes optional.

## Hard Rules

- **Stable IDs.** `CHAR-*`, `SCENE-*`, `PROP-*`, `SHOT-*`, `MOTION-*`, `REF-*`,
  `PLAN-*`, `IMG-*`, assigned at first mention, never renamed. Shot splits add
  a suffix (`SHOT-04a`), never renumber.
- **One shot, one motion.** Every `SHOT-*` pairs one-to-one with exactly one
  `MOTION-*`, and the motion prompt's duration equals the shot's. A second
  action inside one clip is two shots, not one longer prompt.
- **Locks are exact strings.** A continuity lock is a paste-ready noun phrase,
  byte-identical in every prompt it enters. Never paraphrase, shorten, or
  re-translate it per shot; rewording is how identity drifts. Write once, copy
  everywhere; revise in the bible first, then propagate.
- **Reference classes never mix.** `REF-*` = a real, inspected image file in the
  project. `PLAN-*` = a picture the creator will supply (which image, attach
  order, what it governs). `IMG-*` = a prompt entry, not proof of an existing
  image. A missing reference is listed as `PLAN-*`; never silently fall back to
  text-to-video.
- **Keyframes = start frame only.** The keyframe prompt shows the shot's start
  instant; end-of-shot content is deleted. After writing it, back-fill the
  visual basis: every visible entity ID, each with its locks verbatim.
- **States vs locks.** Facts that must not change across shots are locks
  (identity, wardrobe, location, light, palette, negative, voice). Facts that
  progress during the story (wet, open, damaged) are states, tracked per shot,
  never locked.
- **No genre imports.** Aspect ratio, duration and structure come from the
  user's brief only.

## Decision Gates

| Question | If yes | If no |
| --- | --- | --- |
| Named characters? | Build character bible with identity strings | Omit character section; keep locations/props |
| Any AI-video generated shot? | Keyframe + motion prompts per shot | Motion prompts optional; keyframes may still anchor code scenes |
| Keyframes generated images vs code-drawn stills? | Bind locks into prompt text | Bind locks into the code scene's constants/styles |
| Aspect ratio set by the brief? | Use it verbatim in every prompt's constraints | Leave it out; never default |

## Execution Steps

1. **Brief/script intake.** Extract entities and every fact that must not
   change. (`brief-notes.md`, optional.)
2. **Continuity bible** (`continuity-bible.md`). Identity strings, location and
   prop locks, light/palette/negative/voice locks, pending `PLAN-*`. Follow
   `references/continuity-locks.md`.
3. **Shot list** (`shot-list.md`). One row per `SHOT-*`: timing, start → action
   → end (end state named explicitly), framing, continuity anchors.
4. **Keyframe prompts** (`keyframe-prompts.md`). One prompt per shot, start
   frame only, locks verbatim, visual basis listing entity IDs.
5. **Video prompts** (`video-prompts.md`). One `MOTION-*` per `SHOT-*`: only
   what moves between start and end, same duration, locks verbatim,
   `REF-*`/`PLAN-*` attachments per shot.
6. **Review.** Run `references/review-checklist.md` across all five files
   before any generation or render.

Write each file before starting the next. Linkage rules:
`references/artifact-chain.md`.

## Output Contract

Return `continuity-bible.md`, `shot-list.md`, `keyframe-prompts.md`,
`video-prompts.md` (optional without AI video), and `review-checklist.md` with
a per-section verdict, plus a short summary: entity count, shot count, total
duration, and open `PLAN-*` slots the user must supply.

## References

- `references/artifact-chain.md` — the five-document chain: inputs, outputs,
  consumers, linkage rules.
- `references/continuity-locks.md` — lock templates and reuse rules.
- `references/review-checklist.md` — structure, continuity, prompt consistency,
  duration, legibility, references, licensing checks.
- `references/attribution.md` — sources, licenses, and what was rewritten.

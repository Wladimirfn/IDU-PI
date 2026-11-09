# Attribution

This skill is a distilled, rewritten work. It copies no source file wholesale;
the artifact chain, lock rules, and checklist were re-authored for this repo's
conventions.

## Sources

| Source | License | What was used |
| --- | --- | --- |
| [zenstory-ai/drama-skills](https://github.com/zenstory-ai/drama-skills) (`skills/short-drama-*`, `docs/`, `DESIGN.md`) | MIT | Continuity locks as exact paste-ready strings, the `IMG-*` / `PLAN-*` / `REF-*` reference classes, frozen keyframes with a visual-basis back-fill, shot-to-motion duration equality, and the five-document artifact chain idea. |
| [wuwangzhang1216/DirectorSKILL](https://github.com/wuwangzhang1216/DirectorSKILL) (`cinematic-director`) | MIT | Continuity axes, the identity-string contract, end-state naming per shot, and the review discipline. |
| [liangdabiao/Seedance2-Storyboard-Generator](https://github.com/liangdabiao/Seedance2-Storyboard-Generator) | No formal license | Conceptual storyboard-continuity reference only. No text, prompt, or table was copied. |

## What was rewritten

- The five-document chain (`continuity-bible.md`, `shot-list.md`,
  `keyframe-prompts.md`, `video-prompts.md`, `review-checklist.md`) was written
  as a genre-neutral contract, not as a short-drama workflow.
- The ID scheme (`CHAR-*`, `SCENE-*`, `PROP-*`, `SHOT-*`, `MOTION-*`, `REF-*`,
  `PLAN-*`, `IMG-*`) and the linkage rules were normalized for this repository.
- The review checklist was re-authored around structure, continuity, prompt
  consistency, duration, legibility, references, and licensing.

## Out of scope

Drama hooks, cliffhangers, 15-second episodes, default 9:16, the 12
short-drama sub-skills, Python validators, model-specific prompt dialects, and
director-style lenses. Those belong to a genre lane, not to this wrapper.

Downstream users of this skill should preserve this attribution when
redistributing. The MIT sources require keeping their copyright and permission
notice; see each repository's `LICENSE` for the canonical text.

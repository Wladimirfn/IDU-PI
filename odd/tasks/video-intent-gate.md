# video-intent-gate

- Locator: `odd/tasks/video-intent-gate.md`
- Engram mirror: `odd/video-intent-gate/tasks` (project `idu-pi`)
- Branch: `feat/style-first-video`
- Delivery strategy: `ask-on-risk`; forecast about 250 authored changed lines, under the budget.
- TDD: not configured in this repository (no project or session setting found). The gate is covered by tests that drive the shipped binary; they are written before the gate change.
- Test runner: `corepack pnpm test` (full check: `corepack pnpm verify`).
- Receipt-driven development: off (clone-local), so no native review is started.

## Objective

Make the video system decide what kind of piece it is producing before it
chooses a technique, and refuse a full render that never made that decision.

## Problem

The lane router classifies production technique (vector, 3D, pixel). Nothing
classifies the piece: a presentation, an animated story and a visual experience
all inherit the narrated-explainer structure. Evidence: in
`skills-system-explainer`, five of seven scenes share the same
headline-plus-cards skeleton even though its `art-direction.md` forbids it.

## Why

Every later quality fix (independent auditor, timeline driver, demonstration
capture, character pipeline) needs to know the intent to judge against. Without
it they keep measuring every piece as an explainer.

## Scope

- `Intent: presentation | story | experience` as the first decision of the
  style brief, with structural defaults per intent in `video-lanes.json`.
- `idu-pi video render` refuses a full render whose brief has no valid intent.
- The style brief, art-direction and visual-QA references and the skill body
  read their explainer-shaped requirements through the intent.

Out of scope, each a later feature: timeline driver in the motion gate,
independent auditor, live demonstration capture, character pipeline, capability
evidence in the gate.

## Constraints

- Skill sources live in `skills-bundle/`; `.agents/skills` and `.pi/skills` are
  mirrors written by `scripts/install-protocol-skill.mjs`.
- CLI messages stay in the existing Spanish register; skill text stays English.
- Existing projects without an `Intent:` line are refused on a full render
  until the line is added. Partial renders are unaffected.

## Tasks

- [x] T1. Intent contract and gate. `intents` block and `intent` axis in
  `video-lanes.json`; `readStyleBrief` and `checkStyleGate` in `src/cli.ts`;
  tests in `test/video-style-gate.test.ts`.
  - Acceptance: missing intent refused; unknown intent refused with the valid
    values listed; markdown-formatted intent line parses; existing refusals
    unchanged.
  - Checks: `corepack pnpm test`.
  - Evidence: RED observed on the two new tests (missing and unknown intent)
    before the gate change; then `corepack pnpm test` 188 pass / 0 fail /
    1 skip. Commit `db122fb`.
  - Review: receipt-driven development off, no native review.
- [x] T2. Intent-conditional skill text. `SKILL.md`, `references/style-brief.md`,
  `references/art-direction.md`, `references/visual-qa.md`; mirrors synced.
  - Acceptance: the brief template carries `Intent:`; the question has four
    axes; beat legibility, on-screen text, narration inputs and the e00 text
    sample depend on the intent; mirrors byte-identical.
  - Checks: `corepack pnpm verify`.
  - Evidence: `corepack pnpm verify` exit 0 (188 pass / 0 fail / 1 skip; the
    install check reports the mirrors in sync). Commit `4fc5c4b`.
  - Review: receipt-driven development off, no native review.
- [x] T3. Accepted audit findings. Added after the independent audit; the
  reason is that two of them were false passes of the gate.
  - Gate (`audit-gemini`): an empty `Intent:` took its value from the next
    line; a fenced template counted as a decision; a backticked or accented
    value was truncated or reported as missing. Fixed in `readStyleBrief`.
  - Contract (`consult-gemini38`): the demonstration rule had no reachable
    path, so `demo` now means a capture or the real output reproduced
    verbatim; the proof check no longer depends on the `Proof` cell; naming a
    style no longer skips the intent question; the e00 rule no longer demands
    typography for an experience; the skill summary matches the renamed
    columns and checks; a story whose point is carried by text is a
    presentation beat.
  - Not accepted: restricting the brief parse to its first section (the lane
    field has the same behaviour and no report of harm); unit tests for the
    fallback intent list and the success branch (they need the gate exported
    or a real render; left as a follow-up).
  - Checks: `corepack pnpm verify`.
  - Evidence: RED observed on four cases, two of them real false passes; then
    `corepack pnpm verify` exit 0, 191 pass / 0 fail / 1 skip. Commits
    `e650b95` (gate) and `0390784` (contract).
  - Review: receipt-driven development off, no native review.

## Progress

- 2026-11-10: document created, T1 and T2 pending.
- 2026-11-10: T1 and T2 committed. Authored change, mirrors excluded: 277
  insertions, 49 deletions across 7 files.
- 2026-11-10: independent audit dispatched through idu-pi (`audit-gemini` on the
  gate, `consult-gemini38` on the contract). `audit-deepseek` and `audit-mimo`
  failed at start with `400 Provider not available`: the cmdc global provider is
  `codex`, which does not serve the gateway model ids those profiles use.

- 2026-11-10: both audits returned; T3 added and closed.

## Known consequences

- A full render of a project whose brief predates this change is refused until
  `- Intent: ...` is added. `skills-system-explainer` and `idupi-explainer-v2`
  are in that state; they were not edited.
- The intent is a declared word. Nothing executable yet checks that the piece
  delivers it; that belongs to the independent auditor.

## Next step

Feature complete on the branch; push and pull request are the owner's call.
Follow-ups, in the order recommended: independent auditor with vision wired
into the gate, timeline driver per intent in the motion gate, live
demonstration capture, character pipeline.

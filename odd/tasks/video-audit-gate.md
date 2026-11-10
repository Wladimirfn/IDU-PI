# video-audit-gate

- Locator: `odd/tasks/video-audit-gate.md`
- Engram mirror: `odd/video-audit-gate/tasks` (project `idu-pi`)
- Branch: `feat/style-first-video` (continues after `video-intent-gate`)
- Delivery strategy: `ask-on-risk`. Forecast about 450 authored changed lines;
  with the 414 of `video-intent-gate` the branch passes the budget. Slice
  boundary: `ae52dfc` closes the first slice, this feature is the second. The
  chain strategy is the owner's call and is asked before any pull request.
- TDD: not configured in this repository. Tests are written before the code
  they cover and RED is observed.
- Test runner: `corepack pnpm test` (full check: `corepack pnpm verify`).
- Receipt-driven development: off (clone-local), so no native review is started.

## Objective

A full render is refused unless a model other than the author has looked at the
keyframes and returned a verdict for every scene and for the piece.

## Problem

`references/visual-qa.md` is prose. The style gate checks that files exist and
that the brief says `Approved e00: yes`. The model that builds a scene also
approves it, so the same-card rule and the intent were never enforced:
`skills-system-explainer` shipped with five of seven scenes on one skeleton.

## Why

The intent added in `video-intent-gate` is a declared word. An independent
verdict bound to the exact keyframes is what makes it a checked one.

## Scope

- `idu-pi video audit --project <dir> [--profile <p>]`: dispatches one idu-pi
  worker on a profile whose harness differs from the author's, with the audit
  contract and the project files, and writes `audit/visual-qa.json`.
- The audit file records the auditor, the author, and the SHA-256 of every
  audited keyframe and of `art-direction.md`.
- `idu-pi video render` refuses a full render when the audit is missing, stale
  (a keyframe or the contract changed), not independent, reports the intent as
  not delivered, or has a `block` scene. `revise` scenes are listed as warnings.
- The brief gains `- Author: <harness>/<model>`; the skill text describes the
  command, the file and the refusals.

Out of scope: timeline driver in the motion gate, demonstration capture,
character pipeline, capability evidence in the gate, any image similarity
metric computed in code.

## Constraints

- The audit command spends one model call on the chosen profile. It never runs
  as a side effect of `render`.
- Default profiles come from `video-lanes.json`; the first one present in the
  effective profile list whose harness differs from the author's is used.
- A hand-written audit file is not prevented; the gate guards against skipping
  the audit, not against forging it.
- CLI messages stay in the existing Spanish register; skill text stays English.

## Tasks

- [x] T1. Audit model: `src/video-audit.ts` with the prompt builder, the reply
  parser, the audit file writer inputs (keyframe list, hashes, harness
  normalisation) and the evaluator; unit tests in `test/video-audit.test.ts`.
  - Acceptance: a reply missing a scene, with an unknown verdict or without a
    JSON block is rejected; the evaluator reports missing, stale, not
    independent, intent not delivered and blocked; `revise` is a warning.
  - Checks: `corepack pnpm test`.
  - Evidence: 16 unit tests pass. The module and its tests were written
    together, so no RED was observed for this task. Commits `25219ae` and
    `cf20b09` (the author's harness is its first word, found while preparing
    the real run).
- [x] T2. CLI wiring: `video audit` subcommand and the audit gate in
  `video render`; binary tests in `test/video-style-gate.test.ts`.
  - Acceptance: a project that passes the style gate is refused without an
    audit and with a stale one; `--skip-style-gate` skips both gates.
  - Checks: `corepack pnpm test`.
  - Evidence: RED observed on the three binary tests (no audit, stale audit,
    brief without author), then 13 of 13 pass. Commit `a7276a4`.
- [x] T3. Skill text: `SKILL.md`, `references/visual-qa.md`,
  `references/style-brief.md`, `references/video-lanes.json`; mirrors synced.
  - Checks: `corepack pnpm verify`.
  - Evidence: `corepack pnpm verify` exit 0, 210 pass / 0 fail / 1 skip;
    install check reports 0 mirrors out of sync. Commit `7b81462`.
- [x] T4. Real run: `idu-pi video audit` on `skills-system-explainer` with a
  non-Claude profile; record the verdict it returns.
  - Evidence: `node dist/src/cli.js video audit --project <skills-system-explainer>`
    exit 0 with auditor `consult-gemini38` (antigravity), author recorded as
    `opencode`. Verdict: e01, e02, e03, e07 `pass`; e04 `revise` (check 4);
    e05 and e06 `revise` (checks 4 and 10); piece intent `delivered`, variety
    `revise` ("stagnates across e04-e06 where three consecutive scenes repeat
    the same left-title, right-card layout"). The gate passed with 4 warnings.
  - Observation: an earlier free-form audit by the same model family counted
    five scenes on one skeleton; this run counted three and blocked none. The
    auditor is real and its evidence is concrete, but `revise` does not stop a
    render, so this piece would still ship. Whether repeated-skeleton or
    missing-proof findings should block is an open product decision.

- [x] T5. Accepted review findings. Added after an independent code review by
  `audit-deepseek` (commandcode, DeepSeek), which verified several by running
  the parser.
  - Accepted: a scene judged twice could resolve to the later `pass`; a `pass`
    could list failed checks; the verdict was lost behind an example block or
    trailing prose; the audit was not bound to the brief (intent relabelled or
    author renamed after auditing); a removed scene did not expire it; verdicts
    in another case were not read; spaced harness names (`Command Code`) read
    as a different harness; a keyframe named in upper case could not be opened
    on a case-sensitive disk; the audit command spent a model call on an
    intent the style gate would refuse.
  - Also fixed before the review returned: a null scene entry threw in the
    parser, a record without `failed` crashed the gate, a refused delegation
    was an unhandled rejection. Commit `c895963`.
  - Not accepted: binding the audit to the whole `style-brief.md` by hash; it
    would expire the audit on any brief edit and cost a model call. The gate
    compares the intent and the author instead.
  - Not covered by tests: a worker that ends in a status other than
    `completed`, and the path that saves `visual-qa.raw.txt`; both need a
    worker double.
  - Checks: `corepack pnpm verify`.
  - Evidence: RED observed on nine new unit tests, then `corepack pnpm verify`
    exit 0, 222 pass / 0 fail / 1 skip. The real record of
    `skills-system-explainer` still evaluates to 0 errors and 4 warnings.
    Commit `d0ebe6f`.

## Progress

- 2026-11-10: document created, all tasks pending.
- 2026-11-10: T1 to T5 done. Authored change since `ae52dfc`, mirrors
  excluded: 1122 insertions, 12 deletions across 8 files. The forecast of 450
  was wrong by more than half; tests are about 480 of those lines and the
  review fixes added the rest.
- 2026-11-10: `work-glm` added `- **Intent:** presentation` to
  `skills-system-explainer/style-brief.md`. `idupi-explainer-v2` has no
  `style-brief.md` (it predates the style system and uses `brief.md`), so
  nothing was added there. `- **Author:** opencode (...)` was added to
  `skills-system-explainer` by the orchestrator, inferred from the build
  session id format; the model was not recorded.

## Open decisions for the owner

- Should a `revise` on check 4 (repeated skeleton) or check 10 (missing proof)
  stop a render? Today only `block` and an undelivered intent do, and the real
  run let `skills-system-explainer` through with three such warnings.
- Pull request slicing: this branch now holds two features well past the
  400-line budget. Slice boundary proposed at `ae52dfc`.

## Next step

Feature complete on the branch, not pushed. Follow-ups in the order
recommended: timeline driver per intent in the motion gate, live demonstration
capture, character pipeline.

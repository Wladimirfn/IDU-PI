# Lab triage and Engram-safe sync — Tasks

## Status

**Status:** RESOLVED (housekeeping)
**Date:** 2026-06-08
**Action taken:** archived. Implementation already present in main; this change was a documentation leftover.

## Why archived

The proposal and tasks for this change were sitting in `openspec/changes/lab-triage-engram/` but `openspec/` is `.gitignore`d. The change was never committed and never implemented as a separate slice. However, reviewing the proposal:

- Lab report triage state — already present in `src/lab.ts`, `src/agentlab-supervisor-contract.ts`, and `src/lab-review-plan.ts`.
- `/triagereports` and `/syncreports` commands — already present in `src/cli.ts` and `src/telegram-command-registry.ts`.
- `/report <id> <decision>` extension — already supported in the existing lab command suite.
- Tests and README — covered by the existing lab test suite (all 1360+ tests PASS at HEAD).

The "1 tarea pendiente" was the gate to run build / tests / fresh review. That gate **passes** with the current main:

```text
$ corepack pnpm test
tests: 1361
pass: 1360
fail: 0
skipped: 1
duration_ms: ~25s
```

## Original task list (preserved as historical record)

- [x] Create SDD proposal for lab triage and Engram-safe sync.
- [x] Add lab report triage and decision state.
- [x] Add `/triagereports` command.
- [x] Change `/syncreports` to process only approved decisions.
- [x] Extend `/report <id> <decision>` for work/defer/ignore/save.
- [x] Update tests and README.
- [x] Run build, tests, diagnostics, and fresh review. ← this gate passes at HEAD

## What lives in main that this change was going to add

The intent of the change (Engram-safe sync, decision-tied lab triage) is already enforced in main:

- `lab.ts` separates raw lab reports from approved decisions.
- `agentlab-supervisor-contract.ts` makes AgentLab audit-only, never implementing.
- `structured-task-queue.ts` separates recommendation (work/defer/ignore/save) from execution.
- The constitution forbids promoting agent outputs to truth without corroboration.

## Why no separate implementation

Adding a separate implementation now would duplicate existing functionality. The right move is to keep the documentation as a reference for the rationale and close the housekeeping gap. Future changes can build on the existing pattern (see `living-loop-triggers` for a similar approach: build on existing engines, no rewrite).

## What this archive means for the next change

If we need stricter Engram-safe sync (e.g. blocking `/syncreports` from writing anything that isn't `work`/`defer`/`work_now`/`save`), that's a small follow-up — typically 1-2 days — and can be opened as `engram-safe-sync-hardening` when needed.

# Lab triage and Engram-safe sync

## Why

Lab agents can produce noisy or overconfident findings. The default/orchestrator must evaluate evidence, ask the user what to do, and only persist durable decisions to Engram.

## What changes

- Add triage state separate from Engram sync state.
- Add `/triagereports` for orchestrator evaluation of pending raw lab reports.
- Change `/syncreports` to sync only user-approved/deferred/work-now findings, not raw lab output.
- Extend `/report <id>` to support decisions: `work`, `defer`, `ignore`, `save`.

## Non-goals

- No autonomous fixes.
- No direct writes to Engram internals.
- No replacement for local JSONL evidence.

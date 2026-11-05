---
name: security-audit-practice
description: Decide whether a security audit needs the hunter and verifier prompt fragments, and inject them inline into the delegations that already exist. Use when auditing a codebase for vulnerabilities, delegating to an audit-* or read-only profile, triaging security findings from another model, or deciding how much audit process this change deserves.
---

# Security audit practice

A security audit is two different jobs done by two different minds: hunting and
refuting. Fusing them into one prompt degrades both. This skill decides **whether**
to separate them for the job at hand, and **what to inject** when the answer is yes.

Do not run a new agent for this. Inject into the delegation you were already going to
make.

## Step 1 — Is this audit crucial?

Crucial when **any** of these is true:

- the target touches authentication, authorization, credentials, tenant isolation, or
  money;
- a confirmed finding would block a release, a production migration, or a client
  delivery;
- the audit output is a deliverable someone will act on;
- the target is already in production or is about to be.

Not crucial: internal tooling, dev-only code, a bounded refactor, a "is this safe?"
question, or a review of a single file.

## Step 2 — Choose the injection

| Stakes | Hunt delegation | Verify delegation |
| --- | --- | --- |
| Crucial | `fragments/hunter.md` + one companion domain section | `fragments/verifier.md` |
| Normal | `fragments/hunter.md` only | Plain task, no fragment |
| Trivial / question | Nothing | Nothing |

Do not inject `verifier.md` into the hunter's delegation. Exploration and refutation
in one prompt is worse than either alone.

## Step 3 — Inject

1. Read the fragment file **in this skill directory**, extract only the block between
   `<!-- PASTE START -->` and `<!-- PASTE END -->`, and paste that text into the task.
2. Never pass a path instead of the text. `buildWorkerArgs` only appends a path list
   (`src/cmdline.ts:153-156`) and `idu_delegate_parallel` does not accept
   `context_files` at all (`src/mcp-server.ts:255-275`).
3. Add at most one companion domain section, `Core discipline` + `Validation rules`
   only, from the upstream `security-audit` skill when it is installed. Never paste a
   whole companion file. If it is not installed, use the target's row in the router
   table inside `fragments/hunter.md` as the scope hint and continue.
4. Budget: 45 lines of fragment + ~30 of companion. Past ~120 lines of method the
   auditor stops tracing code and starts grading a checklist.

## Step 4 — Confirm it took

A hunter that received the fragment closes with:

```
Surfaces examined: ...
Boundaries tested: ...
Not examined: ...
```

A verifier that received it returns one line per candidate as
`path:line — verdict — why`, plus a count of confirmed / needs_validation / rejected.

If those lines are missing, the fragment did not land. Do not accept prose in their
place.

## Rules that matter more than the process

- A `confirmed` finding needs a bounded observed result, not a plausible trace.
- `needs_validation` carries no severity. It names one exact missing fact.
- A defense-in-depth gap is not a vulnerability.
- A missing best practice with no affected principal or resource is hardening.
- Severity cannot exceed demonstrated impact.

## What this practice deliberately excludes

The upstream six-phase workflow, its coverage ledger, `findings.json`, the report
schema, and its validators. They need a writable parent and a sandboxed execution
environment, and they add agent invocations the current flow does not need. Take the
method; leave the machinery.

If a run genuinely needs deterministic coverage accounting or machine-readable
verdicts, load the upstream `security-audit` skill instead and accept its cost
explicitly — it needs a write-capable parent and at least six agent invocations in its
quickest profile.

## Provenance

Fragments distilled from `security-audit`: `HUNTING.md:37-63` and `:140-157`,
`ATTACK-CLASSES.md:64-109`, `VALIDATION-AND-REPORTING.md:11-40`, `SKILL.md:150-192`.
Re-diff both fragments whenever the upstream skill is updated.

Upstream is `cloudflare/security-audit-skill`, MIT licensed. This skill carries only a
distillation of its method, not its workflow, schema, validators, or companion files.
If a run needs any of those, install the upstream skill itself.

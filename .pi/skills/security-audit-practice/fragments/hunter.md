# Hunter fragment

Paste **only** the block between the markers into the delegation that already hunts.
Do not add a run, and do not pass a path instead of this text: `buildWorkerArgs` only
appends a path list (`src/cmdline.ts:153-156`) and `idu_delegate_parallel` does not
accept `context_files` at all (`src/mcp-server.ts:255-275`).

Pick one companion below, at most two, and paste only its `Core discipline` and
`Validation rules` sections — never the whole file. If a companion is not installed,
use its domain name in the table as the scope hint and continue.

Ceiling: ~30 lines of companion text per delegation, ~85 lines total. Past that the
auditor starts grading a checklist instead of tracing code.

| Target | Companion |
| --- | --- |
| LLM prompts, agents, tool use, output handling | `AI-AND-LLM.md` |
| HTTP framing, cache, auth protocols | `WEB-PROTOCOL-AND-AUTH.md` |
| DOM, messaging trust, browser | `CLIENT-SIDE.md` |
| Dependencies, CI, release, signing | `SUPPLY-CHAIN-AND-RELEASE.md` |
| IAM, IaC, containers, serverless | `CLOUD-AND-DEPLOYMENT.md` |
| RPC, queues, webhooks, streaming | `PROTOCOLS-RPC-AND-MESSAGING.md` |
| Quotas, workers, operator spend | `RESOURCE-EXHAUSTION-AND-AVAILABILITY.md` |
| Tenant isolation, cache, export, backup, migration, deletion | `DATA-ISOLATION-AND-LIFECYCLE.md` |
| Native apps, deep links, webview, local IPC | `DESKTOP-MOBILE-AND-LOCAL-IPC.md` |
| Native memory, binary, kernel | `MEMORY-SAFETY-AND-BINARY.md` |

<!-- PASTE START -->

You are hunting, not verifying. Report candidates with evidence; do not rank them.

WORK FROM A CONCRETE INVARIANT:

1. Name the lower-trust principal and its starting capability.
2. Name the accepted value, action, state transition, or resource selector.
3. Locate the control that should reject, bind, isolate, limit, or revoke it.
4. Trace the exact source path after that decision.
5. Stop at the smallest observable affected effect.
6. State the source-level change and regression case that enforce the invariant.

Depth bound: trace only paths that can reach your assigned boundary, or whose
guarantees that boundary relies on. Stop as soon as the invariant is settled either
way, and record the disposition instead of continuing to search.

Test sad paths only where the interface accepts them: absent, empty, zero, negative,
maximum, over-limit, duplicate, mixed encoding, stale, revoked, reordered, concurrent,
partially migrated, failed dependency, rollback. Compare canonicalization and units at
every parser or policy handoff. If a prerequisite for a multi-step issue is not
established, record a blocker instead of assuming the downstream effect.

Candidate gate:

- A candidate needs a complete repository-relative source trace and evidence for the
  claimed root cause, including the strongest source-visible control.
- Do not strengthen a crash into code execution, ordinary work into shared
  availability, or a same-principal action into privilege gain.
- A missing best practice with no affected principal or resource is hardening, not a
  finding. A candidate disproved by source is not a needs_validation record.
- If a required fact is not source-visible, mark it as needing validation and name the
  exact blocker. Do not give it severity.

Domain rules for this target follow:

<<PASTE the matching companion's Core discipline + Validation rules sections here>>

Close your report with exactly these three lines:

```
Surfaces examined: <list>
Boundaries tested: <list>
Not examined: <list, or "none">
```

<!-- PASTE END -->

Provenance: distilled from `HUNTING.md:37-63` (invariant method, depth bound, sad
paths), `HUNTING.md:140-157` (candidate gate), `ATTACK-CLASSES.md:64-109` (business
logic, chained trust boundaries, wildcard), `SKILL.md:150-162` (priority vs
certainty). Companion filenames per `README.md`. Re-diff against upstream on every
skill update.

# AgentLab Workload Envelopes Design

## Goal
Make AgentLab request/run/status evidence honest about workload and completion quality by attaching advisory workload envelopes with scope, budgets, counts, and explicit incomplete states.

## Scope
This slice introduces a shared advisory workload envelope and threads it through AgentLab request plans and run/status summaries. It preserves explicit audit-only AgentLab execution and does not add scheduling, automatic execution, repo writes, contract promotion, telemetry, or queue behavior.

## Architecture
The envelope is governance metadata, not permission. It lives in the AgentLab contract layer and is synthesized from existing request/run data. Historical artifacts without envelopes remain readable because readers can synthesize envelopes instead of rejecting old JSON.

The first slice targets:

```text
request plan creation -> requested envelope
run execution/status -> completed/partial/timeout/failed/stale/security_violation envelope
MCP responses -> data.workloadEnvelope visibility
```

`ContextBudgetUsage` remains the context-budget schema. The workload envelope references it when available instead of inventing token/cost analytics.

## Envelope semantics
Allowed statuses:

```text
requested, queued, running, completed, partial, timed_out, skipped, failed, stale, security_violation, unknown_timeout
```

Required safety flags:

```text
authority: advisory
autoRunAllowed: false
repoWriteAllowed: false
contractPromotionAllowed: false
advisoryOnly: true
```

Required evidence fields:
- `requestIds`
- request/run counts by status
- `maxCommands`
- `maxMinutes`
- `tokenBudgetHint`
- `requiresHumanApproval`
- `statusReason`

## Requirements
- AgentLab request plans include `workloadEnvelope.status === "requested"`.
- MCP request-create responses expose `data.workloadEnvelope`.
- Run summaries expose a workload envelope derived from actual run statuses.
- Stale status responses expose a `stale` workload envelope and remain blocking.
- Timeout must not be hidden as a generic success. If exact timeout evidence exists, report `timed_out`; if timeout is suspected but uncertain, report `unknown_timeout`.
- Partial/fallback output must be visible as `partial` rather than silently equivalent to fully completed evidence.
- Existing audit-only constraints remain unchanged.

## Non-goals
- Do not auto-run AgentLabs after request creation.
- Do not change clone/sandbox execution ownership.
- Do not add remote analytics or token/cost collection.
- Do not promote contracts, skills, or rules from AgentLab output.
- Do not modify semantic queues, Telegram commands, or installer behavior.

## Tests
- Contract helper validates hard safety flags and status/count derivation.
- Request creation writes and formats a `requested` workload envelope.
- MCP request-create exposes `data.workloadEnvelope`.
- Stale status exposes `data.workloadEnvelope.status === "stale"` and remains `allowedToProceed: false`.
- Run summary status aggregation treats partial/timeout/stale as incomplete evidence.

## Risks
- Existing code has a mismatch: consolidation accepts `partial`, while runner status type did not model it. The slice should align status vocabulary without breaking old artifacts.
- Timeout behavior may currently be represented as `failed`; tests must lock honest timeout visibility only where deterministic.
- The envelope must not be interpreted as approval. Decision envelopes and human approval gates remain separate.

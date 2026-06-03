# Parallel Specialist Audit Plan Design

## Goal
Allow the orchestrator to request an advisory-only AgentLab plan that splits a large audit into explicit specialist requests, each with its own workload envelope, without running AgentLabs automatically.

## Scope
This slice reuses `idu_agentlab_request_create`. It adds a new source alias for specialist audit planning and extends request plans with per-specialty workload envelopes and an explicit run requirement. It does not add a new MCP tool, does not execute AgentLabs, and does not modify semantic queues, Telegram, installer behavior, or runner scheduling.

## Architecture
Request creation remains the planning seam:

```text
idu_agentlab_request_create(source: "specialist-audit-plan", specialties: [...])
→ writes stateRoot agentlabs/requests/current.json
→ returns aggregate workloadEnvelope + per-specialty workload envelopes
→ tells orchestrator to explicitly call idu_agentlab_review_run if it chooses to audit
```

The runner remains the only execution path. Specialist plans are advisory governance artifacts, not permission to run or promote findings.

## Requirements
- MCP `idu_agentlab_request_create` accepts `source: "specialist-audit-plan"`.
- The caller can provide explicit `specialties` and optional bounded audit context fields.
- The request plan creates one AgentLab review request per valid specialty.
- The plan exposes `specialtyWorkloadEnvelopes` with one `requested` envelope per specialty.
- The plan exposes `explicitRunRequirement` stating that `idu_agentlab_review_run` is required for execution.
- Requests include source-specific forbidden actions for no telemetry, no repo writes, no auto-run, and no promotion.
- Existing aggregate `workloadEnvelope` remains advisory and no-auto-run.
- Invalid specialties must not silently become `general`.

## Non-goals
- Do not infer specialties from free text in this slice.
- Do not auto-run AgentLabs.
- Do not change AgentLab runner concurrency.
- Do not change contract/skill promotion behavior.
- Do not add remote analytics or token/cost telemetry.

## Tests
- Request creation with `specialist_audit_plan` creates one request per specialty and per-specialty requested envelopes.
- MCP request-create accepts hyphenated `specialist-audit-plan` and exposes specialty workload envelopes.
- Invalid specialty input returns an error instead of silently creating a generic request.
- Safe notes and decision envelope still require explicit orchestrator decision and explicit review-run.

## Risks
- Internal source names use underscores while MCP names often use hyphens. Add explicit normalization and tests.
- Per-specialty envelope output should be stable for clients; use an array sorted by request order rather than relying on object key ordering.
- This is planning only; docs must avoid implying parallel execution exists in the runner.

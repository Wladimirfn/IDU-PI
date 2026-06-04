# Supervisor Visibility Design

## Goal
Make Idu-pi supervisor consultation visible to the orchestrator and user-facing summaries. The supervisor should not feel hidden: outputs must show the Plan Maestro objective, recommendation, risks, gates, contracts, evidence, and proceed/stop rationale.

## Scope
Add a compact `supervisorConsultation` object to orchestrator-facing MCP outputs. Keep it advisory-only and JSON-first.

## Shape

```ts
type SupervisorConsultation = {
  version: 1;
  authority: "advisory";
  source: string;
  planObjective?: string;
  supervisorRecommendation: string;
  severity: string;
  confidence: number;
  risks: string[];
  gates: string[];
  contracts: string[];
  evidenceRefs: string[];
  proceed: boolean;
  proceedRationale: string;
  stopRationale: string[];
  requiresHuman: boolean;
  agentLabs: { mode: "audit_only"; autoRun: false; suggested: string[] };
};
```

## Safety
- Advisory-only.
- No raw prompts/docs/README bodies.
- No AgentLab auto-run.
- No contract promotion.
- No new implementation/apply tool.
- Keep outputs compact.

## Initial Surfaces
- `idu_supervisor_context_pack`
- `idu_task_context`
- `idu_preflight` / `idu_advisory` where practical
- `idu_postflight`

## Acceptance
- Context pack exposes `supervisorConsultation` with Plan Maestro objective and gates.
- High-risk advisory exposes stop rationale or human requirement.
- Postflight exposes proceed/stop rationale from task trace and decision envelope.
- Tests prove raw prompt marker is not redistributed through `supervisorConsultation`.

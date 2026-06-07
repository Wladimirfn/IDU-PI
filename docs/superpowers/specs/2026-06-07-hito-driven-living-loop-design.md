# Hito-Driven Living Loop Design

## Purpose

Idu-pi must become a living project supervisor, not a passive advisory surface. When Idu-pi is active, the project should continuously observe, audit, propose, execute bounded work through the orchestrator, verify evidence, close milestones, and create the next improvement loop without losing the north: Project Core, Master Plan, contracts, flows, and approved scope.

The loop is not uncontrolled autonomy. It is continuous governed renewal.

## Current Problem

Current Idu-pi can evaluate readiness, task trees, self-maintenance, Bibliotecario evidence, AgentLabs requests, usage events, and supervisor activity. But most engines are passive: they only run when the orchestrator calls MCP/CLI. The project can sit idle even while there are stale sources, new security/news signals, learning opportunities, or unclosed supervisor pressure.

Current tasks also lack a mandatory lifecycle binding. A task may have text, category, and priority, but not always where it belongs in the project: hito, spec, flow, contract, and evidence path. Without that binding, the supervisor cannot reliably audit whether work advances the project or just creates motion.

## Target Model

```text
Project Core
  ↓
Master Plan
  ↓
Hitos
  ↓
Specs
  ↓
Tasks / Subtasks
  ↓
Evidence
  ↓
Supervisor Review
  ↓
Closure / Follow-up / Next Hito
  ↓
Continuous Improvement Loop
```

## Definitions

### Hito

A hito is a closable subobjective under the Master Plan. It defines a meaningful project capability or improvement area.

Example:

```text
Hito: Bibliotecario Continuous Intelligence
```

### Spec

A spec is a verifiable characteristic required to complete a hito. Specs define behavior, non-goals, contracts, acceptance criteria, and validation evidence.

Example specs for Bibliotecario:

```text
- Registered source freshness
- Allowlisted security/news monitor
- Change classification
- Flow-bound proposal generation
- Skill opportunity detection
```

### Task

A task is a bounded unit of implementation/review/audit work that completes part of a spec. Every task must include lifecycle binding.

Required binding:

```json
{
  "hitoId": "hito-bibliotecario-continuous-intelligence",
  "specId": "spec-flow-bound-proposals",
  "flowId": "dependency-governance",
  "contractIds": ["security", "agent"],
  "evidenceRequired": ["tests", "postflight", "supervisor-review"]
}
```

### Supervisor Review

The supervisor is a strict counterparty, not a rubber stamp and not an extremist. It checks work against the hito, spec, Master Plan, contracts, flow binding, and evidence.

Possible review outcomes:

```text
- pass
- pass_with_followup
- needs_evidence
- needs_rework
- contract_blocked
- needs_human
```

## Living Loop

```text
Trigger
  ↓
Supervisor Snapshot
  ↓
Flow/Hito/Spec Resolver
  ↓
Audit Engines
  ↓
Proposal Outbox
  ↓
Policy Engine
  ↓
Execution Queue
  ↓
Orchestrator / Worker / Reviewer
  ↓
Postflight + Evidence
  ↓
Supervisor Review
  ↓
Progress Update / Hito Closure / Next Proposal
```

## Triggers

When Idu-pi is active, the loop always has triggers. The distinction is not multiple autonomy modes; the system is active and every proposed action is classified by policy.

Triggers:

```text
- scheduled heartbeat
- project/session start
- task completed
- postflight completed
- tests failed
- source freshness interval
- Bibliotecario/news/security interval
- AgentLab audit interval
- skill learning interval
- semantic audit threshold
- queue empty with unresolved signals
- Master Plan/hito/spec drift
```

## Audit Engines

### Bibliotecario

Bibliotecario is a hito-capable engine inside the loop. It monitors registered or allowlisted sources, never uncontrolled web search.

```text
Bibliotecario heartbeat
  ↓
revisa fuentes registradas / allowlist / cambios relevantes
  ↓
clasifica:
  - seguridad
  - breaking change
  - mejora
  - nueva práctica
  - deprecated API
  - oportunidad de skill
  ↓
crea propuesta ligada a flujo/hito/spec
```

Example:

```json
{
  "sourceEngine": "bibliotecario",
  "classification": "security_fix",
  "flowId": "dependency-governance",
  "hitoId": "hito-continuous-security",
  "contractIds": ["security", "data"],
  "policy": "ask_human",
  "proposal": "Review dependency upgrade because source reports a security fix."
}
```

### AgentLabs

AgentLabs may run automatically when Idu-pi is active, but only as audit-only engines.

Allowed:

```text
- read project evidence
- inspect repo/stateRoot in sandboxed/audit mode
- generate findings
- raise doubts
- create proposals
- recommend tasks
```

Forbidden:

```text
- edit repo real
- commit/push
- install dependencies
- modify production data
- promote contracts
- apply skills directly without policy
```

AgentLab outputs must pass Supervisor Review before they become tasks.

### Skill Learning

Skills can adapt to the project as part of the global loop, not only when manually requested.

Policy:

```text
- project-local low-risk skill patch: auto allowed with evidence
- support file/reference update: auto allowed when tied to hito/spec/task evidence
- global skill change: ask_human
- security/db/auth/contract-affecting skill: ask_human
- delete/archive skill: ask_human or curator policy with recoverable archive
```

Skills should be class-level or umbrella skills, not one-off bug narratives.

## Proposal Outbox

The proposal outbox is the living inbox of Idu-pi. Engines do not directly implement. They write proposals with evidence and lifecycle binding.

Proposal shape:

```ts
type FlowBoundProposal = {
  id: string;
  sourceTrigger: string;
  sourceEngine: "supervisor" | "bibliotecario" | "agentlab" | "skill-learning" | "postflight" | "semantic-audit";
  title: string;
  summary: string;
  hitoId: string;
  specId: string;
  flowId: string;
  contractIds: string[];
  evidenceRefs: string[];
  risk: "low" | "medium" | "high" | "blocker";
  policyDecision: "auto" | "ask_human" | "block" | "archive";
  recommendedAction: "create_task" | "run_review" | "refresh_context" | "update_skill" | "ask_human" | "noop";
  status: "proposed" | "accepted" | "rejected" | "converted_to_task" | "archived";
};
```

## Policy Engine

The policy engine decides what can happen automatically.

### Auto

Allowed when all are true:

```text
- Project Core confirmed
- Constitution active
- Master Plan/task tree ready
- flow/hito/spec binding exists
- risk is low
- evidence is sufficient
- action is reversible or stateRoot-only
```

Examples:

```text
- create low-risk bounded task
- create source freshness proposal
- patch project-local skill pitfall
- run audit-only AgentLab
- write proposal/report under stateRoot
```

### Ask Human

Required for:

```text
- security/auth/db/dependencies
- contract changes
- global skill changes
- ambiguous flow binding
- push/merge/release
- irreversible actions
- policy changes
```

### Block

Required for:

```text
- missing Project Core / Constitution / Master Plan
- missing flow/hito/spec binding
- failed tests without diagnosis
- contradictory contract evidence
- AgentLab trying to implement
- uncontrolled source/news search
```

## Supervisor Review Contract

The supervisor reviews completed work before closure.

Inputs:

```text
- hito
- spec
- task/subtask
- changed files
- test/build evidence
- postflight
- reviewer report
- contract impacts
```

Output:

```ts
type SupervisorReview = {
  status: "pass" | "pass_with_followup" | "needs_evidence" | "needs_rework" | "contract_blocked" | "needs_human";
  hitoId: string;
  specId: string;
  taskId: string;
  evidenceRefs: string[];
  findings: string[];
  followUpTasks: string[];
};
```

The supervisor is demanding:

```text
- no closure without evidence
- no closure without lifecycle binding
- no closure if contracts are violated
- warnings become follow-up tasks when not blocking
```

But not extremist:

```text
- accepts pass_with_followup for non-critical gaps
- separates blockers from improvements
- archives/noops noisy signals with evidence
```

## Hito Closure

A hito closes only when:

```text
- all required specs are pass or pass_with_followup
- blocking follow-ups are closed
- evidence is recorded
- supervisor review passes
- postflight has no blocking issue
```

Closing a hito does not end the project. It triggers a new loop:

```text
closed hito
  ↓
scan for remaining signals
  ↓
create next hito/proposal or noop evidence
```

## First Implementation Slices

### Slice 1 — Lifecycle Binding Model

Add types and validation for:

```text
- HitoNode
- SpecNode
- FlowBoundProposal
- FlowBoundTask
- SupervisorReview
```

Acceptance:

```text
- proposal/task without hitoId/specId/flowId is blocked_missing_lifecycle_binding
- existing Master Plan task tree can map to hito/spec/task paths
```

### Slice 2 — Proposal Outbox

Add stateRoot proposal storage.

Acceptance:

```text
- engines write proposals, not implementation
- proposals are listable/detailable
- proposal includes lifecycle binding and evidence refs
```

### Slice 3 — Execution Director Tick

Add manual tick first, scheduled later.

Acceptance:

```text
- tick reads supervisor/Bibliotecario/AgentLab/skill signals
- tick creates at most one next proposal per category
- tick does not implement code
- tick records noop when nothing actionable exists
```

### Slice 4 — AgentLabs Auto Audit Policy

Acceptance:

```text
- AgentLabs can run audit-only automatically
- findings become proposals
- unsafe AgentLab outputs are rejected
```

### Slice 5 — Bibliotecario Continuous Intelligence Hito

Acceptance:

```text
- registered/allowlisted source freshness is checked
- relevant changes are classified
- proposals are flow-bound
- no uncontrolled search
```

### Slice 6 — Skill Adaptation Loop

Acceptance:

```text
- project-local low-risk skill patches can be proposed/applied by policy
- global/high-risk skill changes ask human
- curator consolidates/archives only recoverably
```

## Non-Goals

```text
- no uncontrolled daemon implementation
- no AgentLab repo writes
- no hidden skill mutation
- no broad web/news crawling
- no bypass of Master Plan/contracts
- no task without lifecycle binding
```

## Open Decisions

1. Where should canonical hito/spec state live: OpenSpec-style docs, stateRoot JSON, or both?
2. What is the default heartbeat interval when Idu-pi is active?
3. Which AgentLabs run automatically first: security, DB, architecture, code quality, or all with cooldowns?
4. Which project-local skill changes are low-risk enough for auto-apply?
5. How should closed hitos be archived and summarized for future supervisors?

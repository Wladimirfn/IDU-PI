# Birth Pipeline Universal Design

## Purpose

Idu-pi needs a mandatory birth workflow for new and existing projects. The supervisor must not let the orchestrator jump from user intent directly to implementation, repo creation, push, or deployment before the project has a confirmed core, approved Master Plan, Bibliotecario evidence posture, approved Master Prototype / Pilot House, and General Spec.

The pipeline turns project birth into an auditable sequence:

```text
understand → investigate → define base → approve → build → verify
```

## Core Decision

Birth Pipeline Universal is a gate layer above implementation readiness. It is advisory and supervisory, not an implementer. It writes only to project `stateRoot` artifacts, exposes MCP/CLI status, and blocks autonomous/repo-write readiness when mandatory birth artifacts are missing.

## Canonical Sequences

### New Project

```text
Project Core
  → Master Plan
  → Bibliotecario Discovery
  → Master Prototype / Pilot House
  → General Spec
  → SDD / implementation planning
  → implementation
```

### Existing Project

```text
Existing Project Scan
  → detected base specs
  → human approval of detected facts
  → Project Core reconciliation / confirmation
  → Master Plan approval or approved update
  → Bibliotecario Discovery
  → Master Prototype / Pilot House
  → General Spec
  → SDD / implementation planning
  → implementation
```

Existing projects do not skip Project Core or Master Plan. The scan only supplies evidence for confirming or correcting them.

## Terminology

| Term | Meaning |
| --- | --- |
| Project Core | The confirmed identity, purpose, owner intent, and non-goals of the project. |
| Master Plan | The normative parent plan: what to build, why, risks, contracts, and hitos. |
| Bibliotecario | Evidence/discovery engine. It acquires local or approved external references and returns ideas, not automatic decisions. |
| Master Prototype / Pilot House | The first living base that defines how the product should feel, look, scale, and behave. |
| General Spec | Global rules derived from Project Core, Master Plan, Bibliotecario, and Master Prototype. |
| Hito | A zero-duration checkpoint/control point. |
| Task | Executable work under a hito/spec. |
| Gate | A rule that allows, blocks, or asks the human before proceeding. |

## Existing Evidence Contracts

Birth readiness must consume existing Idu-pi status sources instead of inventing parallel truth.

| Gate | Source of evidence | Ready value | Blocking values |
| --- | --- | --- | --- |
| Project Core | `config/project-core.json` loaded through `loadProjectCore()` / `ProjectCoreStatus` | `confirmed` | `missing`, `draft`, `proposed`, `stale`, `unknown` |
| Master Plan | `<stateRoot>/master-plan.json` loaded through Master Plan runtime | `status === "approved"` | missing, draft, rejected, approval required |
| Master Plan task tree | `buildMasterPlanTaskTree(plan)` | `ready` | `missing_plan`, `plan_not_approved`, `empty` |
| Constitution | existing execution readiness source | `active` | missing, inactive, unknown |

The birth state machine may summarize these gates, but it must not duplicate or override them. If existing modules report non-ready, `birth/status.json` must keep `allowedToImplement=false` and explain the upstream reason.

## Birth Status Model

```ts
export type BirthProjectMode = "new_project" | "existing_project";

export type BirthPipelineState =
  | "not_started"
  | "intake_ready"
  | "core_confirmed"
  | "master_plan_approved"
  | "bibliotecario_ready"
  | "prototype_approved"
  | "general_spec_approved"
  | "implementation_ready"
  | "repo_ready"
  | "postflight_passed";
```

State is monotonic for mandatory gates, but artifacts can be invalidated by later drift. When drift appears, status keeps the latest achieved phase and emits blocking reasons such as `project_core_stale`, `master_plan_not_approved`, `prototype_stale`, `general_spec_missing`, or `external_discovery_required`.

## StateRoot Artifacts

All birth artifacts live under the project state root. No repo writes are required to reach birth readiness.

```text
<stateRoot>/birth/status.json
<stateRoot>/birth/intake.json
<stateRoot>/birth/existing-scan.json
<stateRoot>/birth/detected-specs.json
<stateRoot>/birth/bibliotecario-discovery.json
<stateRoot>/birth/prototype-master.json
<stateRoot>/birth/general-spec.json
<stateRoot>/birth/repo-plan.json
<stateRoot>/birth/validation-report.json
```

### `birth/status.json`

```json
{
  "version": 1,
  "projectId": "idu-pi",
  "mode": "existing_project",
  "state": "prototype_approved",
  "allowedToImplement": false,
  "repoWritesAllowed": false,
  "nextRequiredAction": "idu_birth_general_spec",
  "blockingReasons": ["General Spec is not approved."],
  "updatedAt": "2026-06-07T00:00:00.000Z"
}
```

### `birth/existing-scan.json`

Captures observed project facts only:

```json
{
  "version": 1,
  "projectId": "idu-pi",
  "scanId": "birth-scan-001",
  "observed": {
    "packageManager": "pnpm",
    "languages": ["TypeScript"],
    "frameworks": ["MCP", "Pi slash commands", "Telegram adapter"],
    "tests": ["node --test dist/test/*.js"],
    "docs": ["README.md", "docs/superpowers/specs", "docs/superpowers/plans"]
  },
  "risks": ["Project already has runtime integrations; birth scan must be read-only."],
  "approval": { "status": "draft" }
}
```

### `birth/detected-specs.json`

Detected specs are a draft bridge from scan evidence to approved governance. They cannot unlock implementation until a human approves them and the Project Core / Master Plan gates are reconciled.

```json
{
  "version": 1,
  "projectId": "idu-pi",
  "status": "draft",
  "derivedFromScanId": "birth-scan-001",
  "detected": {
    "stack": ["TypeScript", "Node"],
    "architecturePatterns": ["stateRoot artifacts", "MCP advisory tools"],
    "visualPatterns": [],
    "testPatterns": ["node --test dist/test/*.js"]
  },
  "contradictions": [],
  "approval": {
    "status": "draft",
    "approvedBy": null,
    "approvedAt": null
  }
}
```

Approval criteria:

```text
scan evidence reviewed
contradictions listed or resolved
Project Core reconciliation action chosen
Master Plan reconciliation action chosen
no repo writes performed
```

### `birth/bibliotecario-discovery.json`

```json
{
  "version": 1,
  "projectId": "idu-pi",
  "status": "ideas_ready_for_orchestrator",
  "localSources": [{ "path": "README.md", "quality": "primary" }],
  "externalPermission": "not_requested",
  "externalSources": [],
  "ideas": [
    {
      "id": "idea-001",
      "summary": "Use a gated lifecycle before implementation.",
      "sourceIds": ["README.md"],
      "compatibility": "compatible_with_master_plan",
      "decisionStatus": "idea_only"
    }
  ]
}
```

### `birth/prototype-master.json`

```json
{
  "version": 1,
  "projectId": "idu-pi",
  "status": "approved",
  "productIntent": "Define the first scalable product base before feature/page work.",
  "visualStyle": "Project-specific, approved by user.",
  "layoutBase": "Project-specific shell or architecture base.",
  "stackRecommendation": { "packageManager": "pnpm", "runtime": "Node/TypeScript" },
  "dependencies": { "allowed": [], "risky": [] },
  "motionRules": [],
  "uiPatterns": [],
  "forbiddenPatterns": [],
  "bibliotecarioReferences": [],
  "scalingRules": []
}
```

### `birth/general-spec.json`

```json
{
  "version": 1,
  "projectId": "idu-pi",
  "status": "approved",
  "navigation": [],
  "baseComponents": [],
  "pageStructureRules": [],
  "dataRules": [],
  "interactionRules": [],
  "motionRules": [],
  "accessibilityCriteria": [],
  "performanceCriteria": [],
  "derivedFrom": ["project-core", "master-plan", "prototype-master"]
}
```

## Gates

| Gate | Blocks | Reason |
| --- | --- | --- |
| Missing Project Core | Master Plan approval and implementation readiness | The system does not know what it is protecting. |
| Missing approved Master Plan | Implementation, repo plan, remote push | No normative parent plan. |
| Missing Bibliotecario minimum | Strong stack/design decisions | No evidence posture. |
| Missing Master Prototype | UI/product-visible work | No pilot house to preserve visual/product consistency. |
| Missing General Spec | Page/feature specs and implementation readiness | Future work would be born loose. |
| Missing human approval | Git remote, push, deploy, destructive repo actions | Git is consequence, not birth. |

## Existing Project Scan

Existing projects must be observed before being governed. The scan is read-only and infers specs from reality.

Observed categories:

```text
package.json, package manager, framework, routes, components, dependencies,
tests, docs, styles, assets, runtime integrations, stateRoot conventions,
current Master Plan/contracts, contradiction risks, missing evidence
```

Output:

```text
Detected Specs Draft → human approval → Prototype Master Detected v0.1
```

## Bibliotecario Acquisition Protocol

Bibliotecario states:

```ts
export type BibliotecarioAcquisitionState =
  | "local_sources_found"
  | "local_sources_empty"
  | "external_fetch_needed"
  | "external_fetch_blocked"
  | "external_sources_found"
  | "ideas_extracted"
  | "ideas_ready_for_orchestrator";
```

Rules:

- Search local sources first.
- If local is empty, declare the limitation.
- External fetch requires explicit permission or an allowlisted policy.
- External source quality must be classified.
- Ideas must be contrasted against the Master Plan.
- Inspiration is not a decision.
- External source is not a contract.
- Fresh idea is not automatic implementation.

## MCP Tools

Minimal MCP tool set:

```text
idu_birth_status
idu_birth_intake
idu_birth_existing_scan
idu_birth_bibliotecario_discovery
idu_birth_prototype_master
idu_birth_general_spec
idu_birth_validate
idu_birth_repo_plan
```

`idu_birth_status` is the status authority. `automaticov1` should query it before allowing autonomous progress.

## Repo / Git Gate

If the user asks for Git/repo creation, Idu-pi must first verify:

```text
Project Core confirmed
Master Plan approved
Prototype Master approved when product/UI-visible work exists
General Spec approved when implementation is requested
Human repo decision captured
```

Required repo-plan inputs:

```text
repo name, public/private, account/org, license, initial README scope,
remote provider, push approval, branch policy, CI expectation
```

Forbidden path:

```text
git init → push → then decide what the project is
```

## Non-Visual Implementation Rule

The default rule is strict: General Spec requires an approved Master Prototype. Therefore normal implementation readiness is unreachable until the prototype is approved.

A narrow exception may allow advisory planning or non-visual maintenance only when all of these are true:

```text
Project Core confirmed
Master Plan approved
Master Plan task tree ready
Bibliotecario minimum satisfied or explicitly not relevant
requested work is classified non_visual_maintenance
work does not create pages, UI, product behavior, stack decisions, dependencies, repo/remote actions, or public docs that define product behavior
human or orchestrator explicitly accepts the narrowed scope
```

This exception sets `scopeLimit="non_visual_maintenance_only"`, keeps `repoWritesAllowed=false`, and cannot create or approve General Spec.

## Automaticov1 Integration

`automaticov1_cycle` must include birth readiness in its advisory envelope.

When birth is incomplete:

```json
{
  "allowedToProceed": false,
  "repoWritesAllowed": false,
  "requiredActions": ["birth_next_step"],
  "reasons": ["Master Prototype is not approved."]
}
```

When birth permits non-visual implementation:

```json
{
  "allowedToProceed": true,
  "repoWritesAllowed": false,
  "scopeLimit": "non_visual_maintenance_only",
  "reasons": ["Prototype Master is missing, but a narrowed non-visual maintenance exception was explicitly accepted."]
}
```

## Non-Goals

- Do not implement project features in the birth pipeline.
- Do not let Bibliotecario decide the stack automatically.
- Do not create/push repos automatically.
- Do not turn MCP advisory tools into repo-writing authority.
- Do not let AgentLabs implement; AgentLabs remain audit-only.

## Acceptance Criteria

- Idu-pi can answer: `This project is in phase X. Y is required before building.`
- Existing project scan can infer base specs without editing the repo.
- Existing project flow reconciles and confirms Project Core and Master Plan before Bibliotecario/Prototype/Spec readiness.
- Detected specs have a draft/review/approved lifecycle and cannot bypass Project Core or Master Plan gates.
- Bibliotecario can report local limitations and request external categories instead of saying only `no tengo`.
- Prototype Master can be drafted, reviewed, and approved.
- General Spec can be derived from Prototype Master.
- MCP birth tools expose status and gated next actions.
- Repo/Git requests produce a repo plan and require human confirmation before any push.
- `automaticov1_cycle` blocks or narrows autonomous readiness when birth gates are missing.

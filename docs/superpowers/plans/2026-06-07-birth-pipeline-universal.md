# Birth Pipeline Universal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Birth Pipeline Universal gate so new and existing projects must pass Project Core, Master Plan, Bibliotecario, Master Prototype, General Spec, and repo approval gates before implementation/repo write readiness.

**Architecture:** Add pure state/artifact modules first, then read-only scan/discovery engines, then CLI/MCP wiring, then automaticov1 gate integration. All birth artifacts write only under project `stateRoot`; MCP remains advisory-only and repo writes remain blocked unless human approval is explicit.

**Tech Stack:** TypeScript, Node test runner, existing stateRoot project registry, MCP server, CLI command catalog, `automaticov1-cycle`, Project Core/Master Plan modules, existing source/Bibliotecario modules.

---

## Scope

Implements the supervisory birth pipeline, not project feature implementation.

Included:

1. Birth status model and artifact repository.
2. Existing project scan and detected specs draft.
3. Bibliotecario acquisition protocol.
4. Master Prototype artifact lifecycle.
5. General Spec artifact lifecycle.
6. MCP/CLI birth tools.
7. Repo/Git gate plan.
8. `automaticov1` birth readiness integration.
9. Tests and docs.

Deferred:

- Actual repo creation/push execution.
- Unattended external web search.
- AgentLab implementation behavior.
- Full SDD flow integration beyond readiness flags.

## File Structure

- Create: `src/birth-pipeline.ts`
  - Types, state machine, readiness calculation, next required action.
  - Consumes existing Project Core / Master Plan evidence instead of duplicating those systems.

- Create: `src/birth-artifacts.ts`
  - StateRoot JSON read/write helpers for birth artifacts.

- Create: `src/birth-existing-scan.ts`
  - Read-only scanner for package/docs/tests/styles/assets/runtime facts.
  - Produces `detected-specs.json` draft evidence for human approval.

- Create: `src/birth-bibliotecario.ts`
  - Local-first discovery protocol and external-permission status.

- Create: `src/birth-prototype-master.ts`
  - Master Prototype / Pilot House artifact draft/review/approval helpers.

- Create: `src/birth-general-spec.ts`
  - General Spec derivation and validation helpers.

- Create: `src/birth-repo-gate.ts`
  - Repo plan validation and Git/push approval gate.

- Modify: `src/automaticov1-cycle.ts`
  - Include birth readiness in `allowedToProceed`, `repoWritesAllowed`, and `requiredActions`.

- Modify: `src/cli.ts`
  - Add CLI commands for birth status/intake/scan/discovery/prototype/spec/validate/repo-plan.

- Modify: `src/mcp-server.ts`
  - Add MCP tools for birth status/intake/scan/discovery/prototype/spec/validate/repo-plan.

- Modify: `src/command-catalog.ts`
  - Add command metadata.

- Modify as needed: `.pi/extensions/idu-pi-commands.ts`
  - Add slash command aliases only if the CLI command set needs Pi TUI entrypoints.

- Test: `test/birth-pipeline.test.ts`
- Test: `test/birth-artifacts.test.ts`
- Test: `test/birth-existing-scan.test.ts`
- Test: `test/birth-bibliotecario.test.ts`
- Test: `test/birth-prototype-master.test.ts`
- Test: `test/birth-general-spec.test.ts`
- Test: `test/birth-repo-gate.test.ts`
- Modify: `test/automaticov1-cycle.test.ts`
- Modify: `test/idu-command-wiring.test.ts`
- Modify: `test/mcp-server.test.ts`

---

## Task 0: Map existing Project Core and Master Plan readiness contracts

**Files:**
- Modify: `docs/superpowers/specs/2026-06-07-birth-pipeline-universal-design.md` if implementation discovers contract drift.
- Test support only as needed in later tasks.

- [ ] **Step 1: Confirm existing evidence sources**

Inspect these modules before implementing `birth-pipeline.ts`:

```text
src/project-core.ts
src/master-plan.ts
src/master-plan-task-tree.ts
src/idu-execution-readiness.ts
src/project-constitution.ts
```

Required contract to preserve:

```text
Project Core ready: ProjectCoreStatus === "confirmed"
Master Plan ready: plan.status === "approved"
Task tree ready: MasterPlanTaskTreeStatus === "ready"
Constitution ready: ProjectConstitutionStatus === "active"
```

- [ ] **Step 2: Do not create parallel truth**

Birth readiness may summarize these values, but it must read or receive them from existing modules. Do not introduce a second `coreApproved` or `masterPlanApproved` source that can drift from current Idu-pi behavior.

---

## Task 1: Add birth status model

**Files:**
- Create: `src/birth-pipeline.ts`
- Test: `test/birth-pipeline.test.ts`

- [ ] **Step 1: Write failing tests**

Create tests for:

```text
- not_started reports next action idu_birth_intake
- new_project without core blocks implementation
- approved Master Plan without Bibliotecario blocks strong stack/design decisions
- missing prototype blocks UI/product-visible implementation
- approved general spec enables implementation readiness
- repo_ready requires human repo approval
```

Exact command:

```bash
corepack pnpm build && node --test dist/test/birth-pipeline.test.js
```

Expected RED: module does not exist.

- [ ] **Step 2: Implement types and pure readiness calculation**

Create `BirthProjectMode`, `BirthPipelineState`, `BirthStatus`, `BirthReadinessInput`, and `evaluateBirthReadiness(input)`.

Required inputs include existing readiness contracts:

```ts
{
  mode: BirthProjectMode;
  coreStatus: ProjectCoreStatus | "missing" | "unknown";
  masterPlanTaskTreeStatus: MasterPlanTaskTreeStatus | "unknown";
  constitutionStatus: ProjectConstitutionStatus | "missing" | "unknown";
  bibliotecarioStatus?: BibliotecarioAcquisitionState;
  prototypeStatus?: "missing" | "draft" | "reviewed" | "approved" | "stale";
  generalSpecStatus?: "missing" | "draft" | "reviewed" | "approved" | "stale";
  requestedWorkKind?: "visual_product" | "non_visual_maintenance" | "repo_git" | "unknown";
  narrowedScopeAccepted?: boolean;
}
```

Required outputs:

```ts
{
  state: BirthPipelineState;
  allowedToImplement: boolean;
  repoWritesAllowed: boolean;
  nextRequiredAction: string;
  blockingReasons: string[];
  scopeLimit?: "non_visual_maintenance_only" | "implementation_ready";
}
```

- [ ] **Step 3: Verify GREEN**

Run:

```bash
corepack pnpm build && node --test dist/test/birth-pipeline.test.js
```

Expected: PASS.

---

## Task 2: Add stateRoot birth artifact repository

**Files:**
- Create: `src/birth-artifacts.ts`
- Test: `test/birth-artifacts.test.ts`

- [ ] **Step 1: Write failing tests**

Test writing/reading these paths under a temporary state root:

```text
birth/status.json
birth/intake.json
birth/existing-scan.json
birth/detected-specs.json
birth/bibliotecario-discovery.json
birth/prototype-master.json
birth/general-spec.json
birth/repo-plan.json
birth/validation-report.json
```

Also test missing artifacts return `undefined`, not crash.

- [ ] **Step 2: Implement repository helpers**

Add functions:

```ts
resolveBirthArtifactPath(stateRoot, artifactName)
readBirthArtifact(stateRoot, artifactName)
writeBirthArtifact(stateRoot, artifactName, value)
readBirthStatus(stateRoot)
writeBirthStatus(stateRoot, status)
```

Only write under `stateRoot/birth`. Reject path traversal.

- [ ] **Step 3: Verify**

```bash
corepack pnpm build && node --test dist/test/birth-artifacts.test.js
```

---

## Task 3: Add Existing Project Scan

**Files:**
- Create: `src/birth-existing-scan.ts`
- Test: `test/birth-existing-scan.test.ts`

- [ ] **Step 1: Write failing tests**

Use temp fixture projects:

```text
fixture-a/package.json with pnpm + TypeScript
fixture-a/src/App.tsx
fixture-a/test/example.test.ts
fixture-a/docs/readme.md
fixture-a/assets/logo.svg
```

Assert scanner detects:

```text
packageManager, languages, frameworks/dependencies, tests, docs, styles/assets,
risks, detectedSpecs.status="draft", detectedSpecs.approval.status="draft"
```

Assert existing-project scan does not mark Project Core or Master Plan as approved by itself.

- [ ] **Step 2: Implement read-only scanner**

Add:

```ts
scanExistingProject({ projectPath, projectId }): { scan: BirthExistingScan; detectedSpecs: BirthDetectedSpecs }
approveDetectedSpecs(input): BirthDetectedSpecs
```

Rules:

- No writes.
- Ignore `node_modules`, `.git`, `dist`, `.next`, coverage, and stateRoot folders.
- Detect package manager by lockfile priority: `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`.
- Detect tests by `test/`, `*.test.ts`, `*.spec.ts`, package scripts.

- [ ] **Step 3: Verify**

```bash
corepack pnpm build && node --test dist/test/birth-existing-scan.test.js
```

---

## Task 4: Add Bibliotecario acquisition protocol

**Files:**
- Create: `src/birth-bibliotecario.ts`
- Test: `test/birth-bibliotecario.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:

```text
local sources found → local_sources_found
local empty + no permission → external_fetch_blocked
local empty + requested categories → external_fetch_needed
ideas are marked idea_only, never decision/contract
ideas can be compatible/incompatible/needs_review against Master Plan text
```

- [ ] **Step 2: Implement protocol**

Add:

```ts
evaluateBibliotecarioAcquisition(input): BirthBibliotecarioDiscovery
```

Inputs:

```ts
projectId, localSourceRefs, requestedExternalCategories, externalPermission,
masterPlanSummary
```

Outputs must include:

```text
status, localSources, externalPermission, externalCategoriesNeeded,
externalSources, ideas, limitations, nextRequiredAction
```

- [ ] **Step 3: Verify**

```bash
corepack pnpm build && node --test dist/test/birth-bibliotecario.test.js
```

---

## Task 5: Add Master Prototype / Pilot House artifact lifecycle

**Files:**
- Create: `src/birth-prototype-master.ts`
- Test: `test/birth-prototype-master.test.ts`

- [ ] **Step 1: Write failing tests**

Cover statuses:

```text
draft → reviewed → approved
approved requires productIntent + stackRecommendation + forbiddenPatterns + scalingRules
visual/product-visible task is blocked when prototype is not approved
```

- [ ] **Step 2: Implement artifact helpers**

Add:

```ts
createPrototypeMasterDraft(input)
reviewPrototypeMaster(input)
approvePrototypeMaster(input)
validatePrototypeMaster(input)
```

Prototype fields:

```text
productIntent, visualStyle, layoutBase, stackRecommendation,
alternativesDiscarded, dependencies.allowed, dependencies.risky,
motionRules, uiPatterns, forbiddenPatterns, bibliotecarioReferences, scalingRules
```

- [ ] **Step 3: Verify**

```bash
corepack pnpm build && node --test dist/test/birth-prototype-master.test.js
```

---

## Task 6: Add General Spec derivation

**Files:**
- Create: `src/birth-general-spec.ts`
- Test: `test/birth-general-spec.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:

```text
cannot derive without approved prototype
spec includes derivedFrom project-core/master-plan/prototype-master
future page specs can be checked against forbiddenPatterns
contradiction returns blocked_by_prototype_master
```

- [ ] **Step 2: Implement derivation and validation**

Add:

```ts
deriveGeneralSpec(input)
validateGeneralSpec(input)
checkSpecAgainstPrototype(input)
```

Global sections:

```text
navigation, baseComponents, pageStructureRules, dataRules,
interactionRules, motionRules, accessibilityCriteria, performanceCriteria
```

- [ ] **Step 3: Verify**

```bash
corepack pnpm build && node --test dist/test/birth-general-spec.test.js
```

---

## Task 7: Add Repo/Git gate

**Files:**
- Create: `src/birth-repo-gate.ts`
- Test: `test/birth-repo-gate.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:

```text
repo plan blocked without Project Core
repo plan blocked without approved Master Plan
repo plan asks human for repo name/public-private/account/license/README/push
repoWritesAllowed false until pushApproved=true
no function executes git commands
```

- [ ] **Step 2: Implement repo plan validator**

Add:

```ts
evaluateBirthRepoPlan(input): BirthRepoPlanDecision
```

Required fields:

```text
repoName, visibility, owner, license, initialReadmePolicy,
remoteProvider, pushApproved, branchPolicy, ciExpectation
```

- [ ] **Step 3: Verify**

```bash
corepack pnpm build && node --test dist/test/birth-repo-gate.test.js
```

---

## Task 8: Wire CLI and MCP birth tools

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/mcp-server.ts`
- Modify: `src/command-catalog.ts`
- Modify as needed: `.pi/extensions/idu-pi-commands.ts`
- Modify: `test/idu-command-wiring.test.ts`
- Modify: `test/mcp-server.test.ts`

- [ ] **Step 1: Write failing wiring tests**

Assert commands/tools exist:

```text
idu-birth-status
idu-birth-intake
idu-birth-existing-scan
idu-birth-bibliotecario-discovery
idu-birth-prototype-master
idu-birth-general-spec
idu-birth-validate
idu-birth-repo-plan
```

MCP names:

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

- [ ] **Step 2: Implement CLI handlers**

Handlers must:

- Resolve project and stateRoot using existing project registry conventions.
- Read/write only birth artifacts in stateRoot.
- Return structured JSON-compatible text summaries.
- Never run git.
- Never push/deploy.

- [ ] **Step 3: Implement MCP handlers**

MCP envelopes must include:

```text
tool, projectId, birthStatus, allowedToProceed, repoWritesAllowed,
nextRequiredAction, blockingReasons, artifacts
```

- [ ] **Step 4: Verify**

```bash
corepack pnpm build && node --test dist/test/idu-command-wiring.test.js dist/test/mcp-server.test.js
```

---

## Task 9: Integrate automaticov1 birth gate

**Files:**
- Modify: `src/automaticov1-cycle.ts`
- Modify: `test/automaticov1-cycle.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:

```text
missing birth status → allowedToProceed=false, repoWritesAllowed=false
missing prototype for visual task → requiredActions includes birth_next_step
non-visual maintenance may proceed only when Project Core confirmed + Master Plan task tree ready + narrowedScopeAccepted=true
non-visual maintenance exception cannot mark General Spec approved and keeps repoWritesAllowed=false
repoWritesAllowed remains false unless repo_ready + explicit human repo approval
```

- [ ] **Step 2: Implement advisory integration**

Read birth status from stateRoot. Merge birth reasons with existing readiness reasons.

Do not weaken existing gates:

```text
Core, Constitution, task tree, MCP freshness, AgentLabs audit-only,
repoWritesAllowed=false by default
```

- [ ] **Step 3: Verify**

```bash
corepack pnpm build && node --test dist/test/automaticov1-cycle.test.js
```

---

## Task 10: Full verification and postflight docs

**Files:**
- Modify: `docs/mcp-server.md` or nearest MCP docs if birth tools require docs.
- Modify: `docs/cli-commands.md` or nearest CLI docs if birth commands require docs.

- [ ] **Step 1: Run targeted tests**

```bash
corepack pnpm build && node --test \
  dist/test/birth-pipeline.test.js \
  dist/test/birth-artifacts.test.js \
  dist/test/birth-existing-scan.test.js \
  dist/test/birth-bibliotecario.test.js \
  dist/test/birth-prototype-master.test.js \
  dist/test/birth-general-spec.test.js \
  dist/test/birth-repo-gate.test.js \
  dist/test/automaticov1-cycle.test.js \
  dist/test/idu-command-wiring.test.js \
  dist/test/mcp-server.test.js
```

- [ ] **Step 2: Run full test suite**

```bash
corepack pnpm test
```

- [ ] **Step 3: Runtime reload and real MCP validation**

After implementation is merged into runtime source, run `/reload`, then validate:

```text
idu_birth_status
idu_birth_existing_scan
idu_birth_bibliotecario_discovery
idu_birth_validate
idu_automaticov1_cycle
```

Expected:

```text
repoWritesAllowed=false unless repo_ready and human push approval exist
allowedToProceed=false when required birth artifacts are missing
birth_next_step appears in requiredActions when pipeline is incomplete
```

---

## Review Workload Forecast

Expected change size: large enough to split if implemented fully in one PR.

Recommended implementation slices:

1. Birth status + artifact repository.
2. Existing scan + Bibliotecario protocol.
3. Prototype + General Spec artifacts.
4. MCP/CLI tools.
5. Repo gate + automaticov1 integration.
6. Docs + real MCP validation.

Use a fresh reviewer before any push/merge. AgentLabs remain audit-only. MCP remains advisory-only.

## Acceptance Checklist

- [ ] New projects cannot skip Project Core and Master Plan.
- [ ] Existing projects are scanned before specs are approved.
- [ ] Existing projects reconcile Project Core and Master Plan after scan approval; scan approval alone never unlocks implementation.
- [ ] Birth readiness consumes existing Project Core/Master Plan/task-tree statuses instead of creating parallel truth.
- [ ] Bibliotecario requests/uses evidence before strong decisions.
- [ ] Master Prototype can be approved and blocks visual/product drift.
- [ ] General Spec derives from approved prototype.
- [ ] Repo/Git requests require human repo plan approval.
- [ ] automaticov1 includes birth readiness and keeps `repoWritesAllowed=false` unless explicitly allowed.
- [ ] All birth MCP tools return evidence-first envelopes.
- [ ] Full tests pass.
- [ ] Real MCP validation passes after `/reload`.

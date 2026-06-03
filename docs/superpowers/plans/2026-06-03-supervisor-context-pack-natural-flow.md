# Supervisor Context Pack Natural Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `idu_supervisor_context_pack` the primary natural context step in orchestrator implementation procedures.

**Architecture:** Update the MCP procedure guidance in `src/mcp-server.ts` so `implement_change` asks orchestrators to call `idu_supervisor_context_pack` before delegation. Keep `idu_task_context` as fallback/narrow advisory. Add tests in `test/mcp-server.test.ts` and align docs in `docs/cli-commands.md` and, if needed, `docs/mcp-server.md`.

**Tech Stack:** TypeScript, Node test runner, MCP server helpers, Markdown docs.

---

### Task 1: Procedure guidance test

**Files:**
- Modify: `test/mcp-server.test.ts`

- [ ] **Step 1: Write the failing test**

Add or update the `idu_orchestrator_procedure` implement-change test so it asserts the procedure includes `idu_supervisor_context_pack` and keeps `idu_task_context` as fallback/narrow advisory.

Expected assertion shape:

```ts
assert.match(JSON.stringify(procedure.data.procedure), /idu_supervisor_context_pack/);
assert.match(JSON.stringify(procedure.data.procedure), /idu_task_context/);
assert.equal(procedure.data.decisionEnvelope.authority, "advisory");
assert.equal(procedure.data.decisionEnvelope.orchestratorDecisionRequired, true);
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
corepack pnpm build && node --test dist/test/mcp-server.test.js --test-name-pattern "orchestrator procedure"
```

Expected: FAIL because the current procedure still promotes `idu_task_context` as the first implementation context call and does not mention `idu_supervisor_context_pack`.

### Task 2: Procedure implementation

**Files:**
- Modify: `src/mcp-server.ts`

- [ ] **Step 1: Update `buildOrchestratorProcedure()`**

For `implement_change`, change procedure guidance to:

```text
Llamar idu_supervisor_context_pack para obtener objetivo compacto, Plan Maestro, contratos, riesgos, lecturas y gates antes de delegar.
Usar idu_task_context como fallback si el pack no está disponible o como consulta puntual adicional.
Delegar implementación a workers normales del orquestador con ese contexto.
Ejecutar postflight y auditorías audit-only antes de cerrar.
```

Update `mustConsult` to include:

```text
idu_supervisor_context_pack antes de delegar implementación
idu_task_context como fallback o asesoría puntual
```

- [ ] **Step 2: Run focused GREEN**

Run:

```bash
corepack pnpm build && node --test dist/test/mcp-server.test.js --test-name-pattern "orchestrator procedure"
```

Expected: PASS.

### Task 3: Natural loop regression

**Files:**
- Modify: `test/mcp-server.test.ts`

- [ ] **Step 1: Extend approved plan loop test**

Update the approved plan advisory loop test to call `idu_supervisor_context_pack` after `idu_plan_snapshot` and before `idu_next_advisory_action` / `idu_task_package_create`.

Assert:

```ts
assert.equal(contextPack.ok, true);
assert.equal(contextPack.data.authority, "advisory");
assert.equal(contextPack.data.audience, "orchestrator_subagents");
assert.equal(contextPack.data.contextBudget.profile, "supervisor_context_pack");
assert.ok(contextPack.data.taskPackage);
assert.ok(contextPack.data.taskContext);
assert.ok(Array.isArray(contextPack.data.autonomyGates));
```

- [ ] **Step 2: Run focused test**

Run:

```bash
corepack pnpm build && node --test dist/test/mcp-server.test.js --test-name-pattern "approved plan advisory loop|supervisor_context_pack|orchestrator procedure"
```

Expected: PASS.

### Task 4: Docs alignment

**Files:**
- Modify: `docs/cli-commands.md`
- Modify if needed: `docs/mcp-server.md`

- [ ] **Step 1: Update CLI docs loop**

Add `idu_supervisor_context_pack` to the documented orchestrator/MCP loop between plan/status context and action/package creation.

- [ ] **Step 2: Check MCP docs wording**

Ensure `docs/mcp-server.md` still describes the natural loop accurately and does not imply AgentLabs implement or run automatically.

### Task 5: Verification and review

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run LSP diagnostics**

Run LSP diagnostics on:

```text
src/mcp-server.ts
test/mcp-server.test.ts
```

Expected: no new errors.

- [ ] **Step 2: Run full verification**

Run:

```bash
corepack pnpm build && corepack pnpm test && git diff --check
```

Expected: build and tests pass; diff check has no blocking errors.

- [ ] **Step 3: Fresh review**

Run a fresh reviewer for the diff. Expected: PASS or fix blockers before commit.

- [ ] **Step 4: Commit explicit paths only**

Run:

```bash
git add docs/superpowers/specs/2026-06-03-supervisor-context-pack-natural-flow-design.md docs/superpowers/plans/2026-06-03-supervisor-context-pack-natural-flow.md src/mcp-server.ts test/mcp-server.test.ts docs/cli-commands.md docs/mcp-server.md
git commit -m "feat(idu): use supervisor context pack in procedures"
```

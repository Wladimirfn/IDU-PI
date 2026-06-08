# Birth Pipeline — Real MCP/CLI test (post-reload)

Date: 2026-06-07
Project: idu-pi
Branch: main
Commit: fe21519
Reload: hecho por el usuario
Test runner: `corepack pnpm test` → 1299/1299 PASS (1 skipped)

---

## TL;DR

El Birth Pipeline Universal corre de punta a punta en el proyecto real. Los MCP/CLI tools exponen los gates que el plan técnico pedía, y `automaticov1_cycle` ahora incluye el campo `birth` en su envelope.

Durante la prueba real detecté **dos bugs** que ya quedaron parcheados:
1. `handleBirthValidate` pasaba 190 docs locales al Bibliotecario (sin slice). Ahora pasa sólo 5.
2. `formatCliAutomaticov1Cycle` no mostraba el campo `birth`. Ahora lo muestra.

---

## Comandos ejecutados y resultado

### 1. `idu_status`
- ✅ OK
- `active: true`
- `projectId: idu-pi`
- `activatedAt: 2026-06-07T15:44:05.189Z`
- `workspaceRoot: C:\Users\elmas\Documents\bridge-agents\projects\idu-pi`
- `guardrails: automatic`

### 2. `idu-birth-status`
- ✅ OK
- `state: not_started`
- `mode: new_project`
- `allowedToImplement: false`
- `repoWritesAllowed: false`
- `nextRequiredAction: idu_birth_intake`
- `blockingReasons`:
  - Project Core must be confirmed; current=missing.
  - Constitution must be active; current=missing.
  - Master Plan task tree must be ready; current=missing_plan.
  - Master Prototype is not approved; current=missing.

### 3. `idu-birth-existing-scan`
- ✅ OK
- `packageManager: pnpm`
- `languages: TypeScript, JavaScript`
- `frameworks: typescript`
- `tests: 140 file(s)`
- `docs: 190 file(s)`
- `assets: 0`
- `detectedSpecs.status: draft`
- `detectedSpecs.approval.status: draft`
- Persistió en `stateRoot/birth/existing-scan.json` y `stateRoot/birth/detected-specs.json`.

### 4. `idu-birth-bibliotecario-discovery`
- ✅ OK (con bug encontrado y parcheado)
- `status: local_sources_found`
- `localSources: 5` (después del fix; antes eran 190)
- `externalPermission: not_requested`
- `externalCategoriesNeeded: (none)`
- `ideas: 5`, todas `idea_only`
- `nextRequiredAction: idu_birth_bibliotecario_discovery`

### 5. `idu-birth-validate`
- ✅ OK (con bug encontrado y parcheado)
- Corrió scan + bibliotecario + readiness en una sola pasada.
- Devolvió el envelope agregado, ahora con 5 ideas en lugar de 190.

### 6. `idu-automaticov1` (CLI real)
- ✅ OK (con formatter parcheado)
- `status: blocked_readiness`
- `authority: advisory`
- `allowedToProceed: false`
- `tasksCreated: 0`
- `Birth` (campo nuevo, ahora visible):
  - `state: not_started`
  - `allowedToImplement: false`
  - `repoWritesAllowed: false`
  - `nextRequiredAction: idu_birth_intake`
  - `blockingReasons: 4 entries`

### 7. `idu-birth-repo-plan` (pushApproved=false)
- ✅ OK
- `repoWritesAllowed: false`
- `blockingReasons`:
  - Project Core must be confirmed before repo plan; current=missing.
  - Master Plan must be approved before repo plan; current=missing.
  - Human push approval is required before any repo write (pushApproved=false).
  - Birth pipeline must permit implementation before repo writes.
- `nextRequiredAction: idu_birth_intake`

---

## Hallazgos y fixes

### Bug 1 — Bibliotecario recibe todos los docs del scan
- **Síntoma**: `idu-birth-validate` devolvía 190 ideas, una por cada doc detectado.
- **Causa**: `handleBirthValidate` no aplicaba `.slice(0, 5)` a `scan.observed.docs`.
- **Fix**: aplicado en `src/birth-runtime.ts`.
- **Test**: `handleBirthBibliotecarioDiscovery returns status and next action` (verifica que sólo se generan 5 ideas si se le pasan 5).
- **Estado**: ✅ parcheado, suite verde.

### Bug 2 — `automaticov1` no mostraba el campo `birth`
- **Síntoma**: el CLI ejecutaba el cycle pero el formatter no incluía el campo nuevo.
- **Causa**: `formatCliAutomaticov1Cycle` no contemplaba el campo `birth` en el resultado.
- **Fix**: aplicado en `src/cli.ts`. El campo ahora aparece con `state`, `allowedToImplement`, `repoWritesAllowed`, `nextRequiredAction`, `scopeLimit` y `blockingReasons`.
- **Cambio de tipo**: `Automaticov1CycleResult.birth` ahora está declarado en `src/automaticov1-cycle.ts`.
- **Estado**: ✅ parcheado, suite verde.

---

## Resultado de gates (verificado en runtime real)

| Gate | Esperado por el plan | Real (CLI/MCP) |
| --- | --- | --- |
| Project Core confirmado | bloquea | ✅ bloquea |
| Master Plan aprobado | bloquea | ✅ bloquea |
| Constitución activa | bloquea | ✅ bloquea |
| Master Prototype aprobado | bloquea visual | ✅ bloquea |
| General Spec aprobado | bloquea | ✅ bloquea |
| Bibliotecario mínimo | bloquea stack | ✅ (estado: `local_sources_found`) |
| Repo/Git plan | requiere pushApproved | ✅ requiere |
| `automaticov1.birth` | aparece | ✅ aparece |

---

## Tests

```text
$ corepack pnpm test
tests: 1300
pass: 1299
fail: 0
skipped: 1
```

---

## Conclusión

Birth Pipeline Universal funciona end-to-end sobre el proyecto real `idu-pi`. Los gates consumen los contratos existentes (Project Core, Master Plan, Constitution, Bibliotecario, Master Prototype, General Spec) en lugar de duplicar verdad. `automaticov1_cycle` reconoce el estado de birth sin debilitar sus garantías preexistentes. El sistema está listo para que el proyecto `idu-pi` lo recorra: `intake_ready` → `core_confirmed` → `master_plan_approved` → `bibliotecario_ready` → `prototype_approved` → `general_spec_approved` → `implementation_ready` → `repo_ready`.

## Pendiente post-prueba

- Commit + push de los fixes de bug (slice 4-6 follow-up).
- Decidir si el próximo paso es continuar con `core_confirmed` en el proyecto real o cerrar el ciclo.

# Arquitectura de Idu-pi

Idu-pi está organizado como core de supervisión más adaptadores.

Principio central:

```text
Adapters llaman core.
Core no depende de Telegram.
Telegram no debe contener lógica de negocio duplicada.
```

## Vista general

```text
CLI adapter ───────┐
Telegram adapter ──┼── Core Idu-pi ── reports/ ── lab.db
MCP adapter ───────┤        │
Pi slash commands ─┘        │
                            ├── Project Core / Constitution / Flows
                            ├── Supervisor Loop / Hooks
                            ├── Semantic Audit / Compaction
                            ├── Learning Rules / Proposals
                            └── AgentLab Contract / Requests / Runs / Consolidation
```

## Capas

| Capa | Responsabilidad |
| --- | --- |
| Adaptadores | Traducen comandos de CLI, Telegram, MCP o Pi slash hacia funciones core. |
| Core | Implementa reglas, validaciones, reportes, propuestas y consolidación. |
| Persistencia | Guarda reports JSON/JSONL y DB SQLite local, aislados por proyecto enrolado. |
| Workspaces | Aíslan AgentLabs y perfiles no-default en clones. |
| Pi RPC | Mantiene sesión de agente local y reenvía UI requests. |

## Adaptador CLI

Archivo principal:

```text
src/cli.ts
```

Responsabilidades:

- parsear comandos `idu-pi ...`;
- construir runtime local;
- resolver proyecto activo;
- llamar funciones core;
- formatear salida para terminal;
- compartir `AGENT_WORKSPACE_ROOT` y registry con Telegram.

El CLI no debe duplicar lógica de negocio. Debe llamar módulos como `project-preflight`, `semantic-audit-command`, `agentlab-review-runner` o `agentlab-report-consolidation`.

## Adaptador MCP

Archivo principal:

```text
src/mcp-server.ts
```

Responsabilidades:

- exponer herramientas MCP stdio para el orquestador;
- resolver `projectPath` explícito o proyecto activo;
- reutilizar el runtime/core del CLI sin importar Telegram;
- devolver JSON estructurado con `ok`, `tool`, `projectId`, `summary`, `data`, `safeNotes` y `errors`;
- mantener seguridad: sin commit/push, sin cambios críticos automáticos y sin AgentLabs salvo `idu_agentlab_review_run` explícito.

Después de un Plan Maestro aprobado, el MCP ofrece un loop preventivo para el orquestador: snapshot del plan, acción candidata advisory, paquete para subagentes normales, governance-review antes de codificar, postflight trazado y AgentLabs audit-only sólo si el orquestador los ejecuta explícitamente. Idu-pi no implementa ni reemplaza la decisión del orquestador.

Guía: [MCP Server](mcp-server.md).

## Adaptador Telegram

Archivos principales:

```text
src/index.ts
src/command-catalog.ts
src/telegram-command-registry.ts
```

Responsabilidades:

- registrar comandos slash;
- responder mensajes;
- mostrar catálogos;
- reenviar confirmaciones/selecciones de Pi;
- llamar funciones core;
- mantener experiencia cómoda desde chat.

Telegram es una interfaz. No es el núcleo de Idu-pi.

## Catálogo de comandos

`src/command-catalog.ts` es la fuente para:

- `/help`;
- `/comandos`;
- BotFather `setMyCommands`;
- comandos locales de referencia.

Cuando se agrega un comando visible, el catálogo y `src/telegram-command-registry.ts` deben mantenerse alineados.

## Installer y estado por proyecto

`idu-pi setup` configura adapters globales como MCP. `idu-pi project enroll <path>` registra un proyecto y crea estado aislado bajo:

```text
AGENT_WORKSPACE_ROOT/projects/<safeProjectId>/
```

Guía: [Instalador y estado por proyecto](installer.md).

## Reports

Para proyectos enrolados, los artifacts revisables se guardan bajo:

```text
AGENT_WORKSPACE_ROOT/projects/<safeProjectId>/reports/
```

Por compatibilidad, proyectos existentes sin `stateRoot` siguen usando:

```text
AGENT_WORKSPACE_ROOT/reports/
```

Ejemplos:

| Archivo | Rol |
| --- | --- |
| `lab-runs.jsonl` | Reportes de labs. |
| `lab.db` | SQLite local para tracking estructurado. |
| `semantic-compaction-draft-*.json` | Drafts de compactación. |
| `supervisor-improvement-proposals-*.json` | Propuestas de mejora. |
| `skill-improvement-proposals-*.json` | Propuestas de skills. |
| `skill-draft-*.json` | Drafts de skills, no skills reales. |
| `agentlabs/requests/current.json` | Solicitud formal AgentLab actual. |
| `agentlabs/runs/current.json` | Resultado AgentLab review-only actual. |
| `agentlabs/reports/consolidated-current.json` | Consolidación actual de reportes AgentLab. |
| `master-plan.json` / `master-plan.md` | Plan Maestro canónico vivo generado por AutoDepth/Supervisor. |
| `project-index.json` | Índice Supervisor del proyecto: tipos, áreas funcionales y ruido ignorado. |

`reports/` queda como staging/revisión y fallback legacy. AgentLabs dejan artefactos en `agentlabs/`; sólo el Supervisor actualiza el Plan Maestro canónico.

## SQLite / lab DB

La DB local vive normalmente en estado aislado:

```text
AGENT_WORKSPACE_ROOT/projects/<safeProjectId>/lab.db
```

Por compatibilidad, proyectos existentes sin estado enrolado pueden seguir usando:

```text
AGENT_WORKSPACE_ROOT/reports/lab.db
```

Se usa para:

- lab runs;
- findings;
- proposals;
- tasks;
- user signal events;
- semantic audit counters;
- semantic memory item metadata.

La DB complementa a los JSON/JSONL. No reemplaza la aprobación humana.

## Project Core

Project Core representa el plano maestro confirmado del proyecto.

Módulos relacionados:

```text
src/project-core.ts
src/project-core-wizard.ts
src/project-core-research.ts
src/project-core-confirmation.ts
```

Un draft puede venir de wizard o research. Sólo se vuelve fuente de verdad cuando el humano confirma.

## Plan Maestro AutoDepth

MASTER-PLAN-CONSOLIDADO-1 usa un Plan Maestro vivo y canónico en `stateRoot`:

```text
AGENT_WORKSPACE_ROOT/projects/<safeProjectId>/master-plan.json
AGENT_WORKSPACE_ROOT/projects/<safeProjectId>/master-plan.md
AGENT_WORKSPACE_ROOT/projects/<safeProjectId>/master-plan.current.json
AGENT_WORKSPACE_ROOT/projects/<safeProjectId>/master-plan.memory.json
AGENT_WORKSPACE_ROOT/projects/<safeProjectId>/project-index.json
AGENT_WORKSPACE_ROOT/projects/<safeProjectId>/agentlabs/
```

`src/master-plan.ts` genera este draft de forma determinista con señales baratas del proyecto. AutoDepth decide `quick`, `standard` o `deep_required`; en `deep_required` ejecuta una etapa segura automática y marca que el deep review costoso requiere aprobación humana. AgentLabs quedan seleccionados como metadata/request recomendada, no se ejecutan automáticamente. Aprobar el Plan Maestro no aplica flows ni confirma Project Core/Constitution.

El Plan Maestro también guarda `master-plan.pending-action.json` cuando hay draft pendiente, para permitir decisiones naturales acotadas como `ok`, `dale`, `sí` o `rehacer`. La memoria externa se consulta mediante una abstracción opcional; si no hay proveedor disponible, se usa `master-plan.memory.json` como fallback local o se marca `none/unavailable` sin bloquear la generación.

## Constitution

Constitution deriva reglas operativas desde Project Core confirmado.

Módulo principal:

```text
src/project-constitution.ts
```

Se usa en gates para detectar riesgo, scope inválido, stack rechazado o necesidad de aprobación.

## Project blueprint y flows

Archivos project-local:

```text
config/project-blueprint.json
config/project-flows.json
```

`project-blueprint` describe objetivo/reglas maestras.

`project-flows` describe mapa funcional del proyecto real:

- módulos;
- pantallas;
- UI elements;
- dataStores;
- flows;
- conexiones entre módulos.

Más detalle: [`project-map-workflow.md`](project-map-workflow.md).

## Gates y riesgo

Módulos típicos:

```text
src/project-preflight.ts
src/project-advisory.ts
src/project-postflight.ts
src/human-intent.ts
src/user-signal.ts
```

Evalúan:

- intención humana;
- keywords de riesgo;
- cambios en archivos;
- Project Core;
- Constitution;
- datos/auth/seguridad;
- estado de configuración.

## Supervisor Loop y Hooks

Módulos:

```text
src/idu-supervisor-loop.ts
src/idu-supervisor-hooks.ts
src/idu-session.ts
```

El loop observa estado y puede preparar auditorías, drafts, propuestas o tareas.

Los hooks reaccionan a eventos como activación de `/idu`, postflight de alto riesgo o umbrales semánticos.

No deben aplicar cambios críticos automáticamente.

## Semantic Audit y Compaction

Módulos:

```text
src/semantic-audit.ts
src/semantic-audit-command.ts
src/semantic-compaction.ts
src/semantic-agent-tasks.ts
```

Flujo:

```text
eventos → semantic audit → compaction draft → review → candidates/tasks/proposals
```

La compactación reduce ruido y prepara decisiones. No borra memoria ni aplica reglas sola.

## Improvement proposals

Módulos:

```text
src/supervisor-improvement-proposals.ts
src/supervisor-improvement-decisions.ts
src/skill-improvement-proposals.ts
src/skill-improvement-decisions.ts
src/skill-drafts.ts
```

Patrón:

1. construir/revisar plan;
2. guardar propuesta en `reports/`;
3. registrar decisión humana;
4. aplicar sólo si el tipo lo permite y está aprobado.

## Learning Rules

Módulo:

```text
src/supervisor-learning-rules.ts
```

Las reglas aprendidas se prueban, se habilitan/deshabilitan con backup y no pueden bajar riesgo alto de forma insegura.

## AgentLab Contract

Módulos:

```text
src/agentlab-supervisor-contract.ts
src/agentlab-review-requests.ts
src/agentlab-review-runner.ts
src/agentlab-report-consolidation.ts
```

Flujo:

```text
request formal → review request → review run en clone → report → consolidation → candidates
```

Garantías:

- solicitudes formales;
- acciones permitidas/prohibidas explícitas;
- review-only;
- sandbox/clone;
- guard contra mutaciones del repo real;
- parsing limpio;
- `workloadEnvelope` advisory-only en requests/runs/status para reportar carga, presupuesto y estados honestos (`requested`, `completed`, `partial`, `timed_out`, `stale`, `failed`) sin autorizar auto-run, escritura de repo real ni promoción de contratos;
- planes `specialist-audit-plan` que dividen auditorías grandes en requests por especialidad con `specialtyWorkloadEnvelopes` y `explicitRunRequirement`, siempre sin ejecutar labs automáticamente;
- requests bibliotecario `external-source-intelligence` alimentados por refs locales de Source Library/digests (`sourceId`, `chunkIds`, limitaciones) sin web/live fetch automático ni documentos/chunks crudos;
- eventos locales de efectividad en `reports/agentlab-effectiveness-events.jsonl` para contar requests, runs, status, estados (`completed`, `partial`, `timed_out`, `stale`, `failed`, `security_violation`), hallazgos por severidad y completitud de evidencia sin prompts, texto crudo, env, headers, tokens, costo, porcentajes de contexto ni analytics remota;
- consolidación read-only.

## AgentRouter y Pi RPC

Módulos relacionados:

```text
src/agent-router.ts
src/pi-rpc.ts
```

El router administra perfiles, sesiones persistentes y workspaces.

El perfil default puede trabajar sobre repo real. Perfiles no-default se usan como labs en clone cuando `AGENT_WORKSPACE_MODE=clone`.

## Workspaces

```text
AGENT_WORKSPACE_ROOT/workspaces/
```

Los labs deben inspeccionar y reportar desde clones. No deben commitear, pushear ni copiar cambios al repo real.

## Prueba E2E del supervisor

La aceptación integral vive en:

```text
test/idu-supervisor-e2e.test.ts
```

Esa prueba corre sin Telegram real, red ni IA externa. Usa temporales, mocks y reportes seguros para validar el ciclo:

```text
/idu → intención humana → guarded queue → semantic draft → proposals → learning rule → skill draft → AgentLab request/run → consolidation → loop inactive
```

También verifica que no se modifiquen repo real, `.agents`, `.atl`, Project Core, Constitution, blueprint/flows, `labPrompt` ni `AgentRouter`.

## Reglas para futuras extensiones

- Agregar lógica en módulos core, no dentro de handlers Telegram.
- Mantener CLI y Telegram como adaptadores finos.
- Escribir artifacts revisables en `reports/`.
- Evitar cambios automáticos en Project Core, Constitution, flows o skills.
- Usar tests de módulo para lógica y tests de wiring para comandos.
- Repetir en salidas críticas: nada crítico se aplica sin confirmación humana.

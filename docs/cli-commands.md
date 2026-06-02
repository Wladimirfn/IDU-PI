# Comandos CLI de Idu-pi

El CLI es la superficie principal para usar el core de Idu-pi. Telegram es una interfaz remota opcional para ejecutar comandos, revisar estado, cambiar de proyecto enrolado y confirmar decisiones sin estar en la terminal. Telegram no tiene otro core: sus botones son atajos al mismo CLI/supervisor.

Usá `idu-pi` como entrada única: muestra el home, ayuda a configurar MCP, registra proyectos y guía el Plan Maestro sin tocar el repo real de forma implícita. `idu-pi idu` activa el supervisor del proyecto y muestra/reutiliza el Plan Maestro. Los comandos largos quedan para depuración/orquestadores avanzados. Desde el repo, el equivalente es:

```text
corepack pnpm cli
corepack pnpm cli -- <comando>
```

El CLI usa `AGENT_WORKSPACE_ROOT` y el registro de proyectos. Los proyectos enrolados guardan estado aislado en `AGENT_WORKSPACE_ROOT/projects/<projectId>/`; proyectos antiguos sin `stateRoot` conservan el fallback `AGENT_WORKSPACE_ROOT/reports/`.

Para uso universal desde orquestadores, `idu-pi setup mcp-init` instala MCP y el espejo global de comandos slash de Pi. Luego al abrir `pi` desde cualquier proyecto podés usar `/idu`, `/idu_status`, `/idu_task`, etc. El binario MCP es `idu-pi-mcp` o, desde el repo:

```text
corepack pnpm mcp
```

Ver [MCP Server](mcp-server.md).

## Setup e instalación

Primera instalación, antes de que `idu-pi` exista en `PATH`:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

Dry-run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -DryRun
node scripts/install.mjs --dry-run
```

El bootstrap installer crea un shim local. Si falta en `PATH`, pregunta antes de agregarlo al `PATH` de usuario; para aceptarlo sin segunda pregunta usá `-Yes -AddPath` o `--yes --add-path`.

| Comando | Uso |
| --- | --- |
| `idu-pi` | Muestra home CLI; en terminal interactiva abre menú visual único con Configurar IDU-Pi/Proyecto/Telegram remoto/Modelos y perfiles/Supervisor/Tareas/Diagnóstico/Exit. |
| `idu-pi home` | Muestra el mismo home CLI. |
| `idu-pi setup` | Muestra estado de sistema/config y acciones recomendadas. |
| `idu-pi setup status` | Igual que `setup`. |
| `idu-pi setup wizard` | Abre el asistente interactivo cuando hay TTY; en modo no interactivo muestra instrucciones y no espera input. |
| `idu-pi setup path-help` | Explica cómo arreglar `PNPM_HOME`/bin global fuera de `PATH`. |
| `idu-pi setup mcp-print` | Imprime config MCP sin escribir. |
| `idu-pi setup mcp-init` | Instala `idu-pi` en `mcp.json` y comandos slash globales de Pi. |
| `idu-pi setup mcp-init --force` | Reemplaza entrada `idu-pi` existente con backup. |
| `idu-pi project enroll <projectPath> [projectId]` | Registra proyecto y crea estado aislado. |
| `idu-pi project status <projectPath>` | Muestra estado/rutas del proyecto. |
| `idu-pi project state-path <projectPath>` | Imprime rutas aisladas esperadas. |
| `idu-pi idu-project-reset-state --yes` | Borra todo el estado aislado (`stateRoot`) del proyecto activo/seleccionado; no desregistra ni toca el repo real. |

Guía: [Instalador y estado por proyecto](installer.md).

## Receta mínima

Para un usuario nuevo, el camino feliz es:

```text
idu-pi setup status
idu-pi setup mcp-init
idu-pi project enroll "C:\ruta\a\tu-proyecto" mi-proyecto
idu-pi idu
idu-pi master-plan-review latest
idu-pi master-plan-approve latest
```

Para trabajar con Plan aprobado desde el orquestador, usá MCP:

```text
idu_plan_snapshot → idu_next_advisory_action → idu_task_package_create
→ governance-review → worker normal → idu_postflight
```

AgentLabs son opcionales/explícitos y audit-only: `idu_agentlab_request_create` crea solicitud; `idu_agentlab_review_run` ejecuta revisión; ninguno implementa código.

## Estado y activación

| Comando | Uso |
| --- | --- |
| `idu-pi status` | Muestra estado operativo del proyecto/agente. |
| `idu-pi idu` | Bootstrap/start cómodo: enrola si falta y el path está permitido, crea estado/config/Core/Constitution draft, activa guardrails y prepara análisis seguro. Pi slash `/idu` usa este mismo flujo CLI; Telegram `/idu` es activación remota sobre un proyecto ya configurado. |
| `idu-pi idu-off` | Desactiva guardrails automáticos. |
| `idu-pi idu-status` | Muestra estado de sesión Idu-pi. |

Ejemplos:

```text
idu-pi status
idu-pi idu
idu-pi idu-status

# Dentro de Pi, luego de setup mcp-init:
/idu
/idu_status
/idu_task bug "falla login"

# Los slash commands se muestran con underscore para evitar duplicados;
# los comandos CLI `idu-pi idu-status` con guion siguen existiendo.
```

## Preparación y gates

| Comando | Uso |
| --- | --- |
| `idu-pi idu-prepare` | Prepara contexto seguro del proyecto. |
| `idu-pi idu-preflight "solicitud"` | Evalúa riesgo antes de trabajar. |
| `idu-pi idu-advisory "solicitud"` | Devuelve recomendación operativa. |
| `idu-pi idu-postflight` | Revisa cambios actuales y riesgo post-trabajo. |
| `idu-pi idu-lab-review-plan postflight` | Prepara plan de revisión AgentLab sin ejecutarlo. |

Aliases compatibles:

```text
idu-pi prepare
idu-pi preflight "cambia login"
idu-pi advisory "usa JS embebido"
idu-pi postflight
idu-pi lab-review-plan postflight
```

## Plan Maestro

`idu-pi idu` genera o muestra un Plan Maestro draft/approved/stale en el `stateRoot` del proyecto. Es determinista, no usa IA externa, no aplica flows y no confirma Project Core/Constitution. El Plan Maestro es normativo: describe qué es el proyecto, su alcance, arquitectura, stack, contratos, documentación declarada versus realidad construida y referencia flujos permanentes en un artefacto separado.

El contrato de datos debe ser operativo: stores, owner lógico, retención, backup/restore, sanitización/redacción, migración/rollback y ciclo de vida de SQLite/JSON/JSONL. Los flujos de ingesta, reporting y API deben referenciar stores detectados/canónicos; si faltan, la revisión lo trata como riesgo a corregir. `master-plan-review` antepone `revisionAntesDeZarpar`, una revisión para el orquestador con contratos de preparación, fuentes, herramientas/MCP, AgentLabs recomendados, problemas, estrategia de arreglo, preguntas al usuario y checklist antes de ejecutar trabajo grande. Las fuentes externas vivas recomendadas pueden incluir docs oficiales, changelogs, releases/issues, GitHub/npm advisories, OWASP/CVE/NVD, posts oficiales en X/Twitter, Reddit/comunidades técnicas y blogs/noticias de seguridad; informan riesgos, no aprueban contratos solas. Para ese seguimiento, la revisión recomienda un AgentLab bibliotecario audit-only.

| Comando | Uso |
| --- | --- |
| `idu-pi master-plan-status` | Muestra estado del Plan Maestro actual. |
| `idu-pi master-plan-review latest` | Muestra `revisionAntesDeZarpar` y el markdown del Plan Maestro. |
| `idu-pi master-plan-approve latest` | Marca el plan como approved; no aplica flows. MCP también expone `idu_master_plan_approve` para cierre explícito desde el orquestador. |
| `idu-pi master-plan-reject latest [motivo]` | Marca el plan como rejected con motivo opcional. MCP también expone `idu_master_plan_reject`. |
| `idu-pi master-plan-redraft latest` | Rehace el draft actual actualizando el Plan Maestro canónico. |

Source Library permite agregar, leer e investigar documentación manual local en `stateRoot` sin escribir en el repo real ni promover contratos automáticamente:

| Comando | Uso |
| --- | --- |
| `idu-pi source-status` | Muestra estado explícito `missing | empty | ready | stale | invalid`, hashes y faltantes. |
| `idu-pi source-add <path.md|path.txt|path.pdf>` | Copia fuente local a `Doc/<project>/sources/local/`; para `.md/.txt` guarda snapshot de texto simple, para `.pdf` intenta conversión best-effort desde texto embebido a Markdown sin OCR/dependencias nuevas. |
| `idu-pi source-read <source-id>` | Lee contenido acotado de fuentes `.md/.txt`, snapshots o PDFs convertidos; PDFs sin texto quedan metadata-only. |
| `idu-pi source-extract <source-id>` | Actualiza snapshot acotado para `.md/.txt`; PDFs usan sólo conversión embebida existente, sin OCR/parsing pesado. |
| `idu-pi source-report <source-id>` | Reporta metadata, hash, estado de extracción/conversión y limitaciones de una fuente. |
| `idu-pi source-research <consulta>` | Busca coincidencias en fuentes registradas/legibles y devuelve señales con evidencia/citas; no consulta web ni promueve contratos. |
| `idu-pi source-digest <source-id>` | Divide texto legible en chunks/tomos, genera `sources/digests/<sourceId>.json` y actualiza `source-library-index.json`; advisory-only. |
| `idu-pi source-digest-status` | Muestra digests disponibles y estado del índice bibliotecario. |
| `idu-pi source-chunk-read <source-id> <chunk-id>` | Lee un chunk/tomo específico para que el orquestador pueda mandar subagentes a contrastar evidencia. |
| `idu-pi source-recommend <tarea>` | Recomienda fuentes/chunks relevantes para una tarea; no implementa ni aprueba contratos. |
| `idu-pi source-remove <source-id>` | Remueve una fuente registrada y sus copias/snapshot dentro de Source Library; no toca contratos ni repo real. |
| `idu-pi source-refresh` | Recalcula existencia/hash/estado; no toca Project Core, Constitution, flows, skills ni contratos. |

Aliases con prefijo Idu-pi:

```text
idu-pi idu-master-plan-status
idu-pi idu-master-plan-review latest
idu-pi idu-master-plan-approve latest
idu-pi idu-master-plan-reject latest "objetivo incompleto"
idu-pi idu-master-plan-redraft latest
```

Artefactos por proyecto:

```text
<stateRoot>/master-plan.json
<stateRoot>/master-plan.md
<stateRoot>/master-plan.current.json
<stateRoot>/master-plan.memory.json
<stateRoot>/master-plan.flows.json
<stateRoot>/project-index.json
<stateRoot>/Doc/<project>/source-index.json        # índice Source Library de fuentes locales/normativas
<stateRoot>/Doc/<project>/sources/local/           # PDFs, normas, leyes, libros o docs descargadas
<stateRoot>/Doc/<project>/sources/extracted/       # snapshot de texto simple para .md/.txt
<stateRoot>/Doc/<project>/sources/converted/       # Markdown best-effort desde PDFs con texto embebido; sin OCR
<stateRoot>/Doc/<project>/sources/chunks/          # chunks/tomos generados por digest
<stateRoot>/Doc/<project>/sources/digests/         # digest JSON por fuente
<stateRoot>/Doc/<project>/source-library-index.json # índice bibliotecario global advisory
<stateRoot>/agentlabs/
```

## Cola y tareas

| Comando | Uso |
| --- | --- |
| `idu-pi idu-task [tipo] "detalle"` | Crea tarea estructurada local. |
| `idu-pi idu-queue-detail` | Muestra cola estructurada. |
| `idu-pi idu-queue-approve <id>` | Aprueba tarea bloqueada. |
| `idu-pi idu-queue-reject <id>` | Rechaza tarea bloqueada. |
| `idu-pi idu-queue-clear-structured` | Limpia cola estructurada persistida. |

Ejemplos:

```text
idu-pi idu-task bug "falla login con token vencido"
idu-pi idu-queue-detail
idu-pi idu-queue-approve task-001
```

## Project Core

| Comando | Uso |
| --- | --- |
| `idu-pi idu-core-status` | Muestra estado de Project Core. |
| `idu-pi idu-core-diff` | Compara Project Core actual/draft. |
| `idu-pi idu-research-core` | Genera draft de research en `reports/`. |

Project Core define objetivo, alcance, stack y restricciones. No queda confirmado como verdad hasta decisión humana.

## Semantic audit y compaction

| Comando | Uso |
| --- | --- |
| `idu-pi idu-semantic-audit-status` | Revisa conteos, checkpoint y necesidad de auditoría. |
| `idu-pi idu-semantic-audit-run` | Registra auditoría semántica manual. |
| `idu-pi idu-semantic-compact-draft` | Crea draft de compactación semántica. |
| `idu-pi idu-semantic-compact-review latest` | Revisa draft sin aplicar memoria ni reglas. |
| `idu-pi idu-semantic-agent-tasks-review latest` | Revisa tareas candidatas desde compactación. |
| `idu-pi idu-semantic-agent-tasks-create latest` | Registra tareas review; no ejecuta AgentLabs. |

Aliases sin prefijo `idu-` también existen para compatibilidad:

```text
semantic-audit-status
semantic-audit-run
semantic-compact-draft
semantic-compact-review latest
semantic-agent-tasks-review latest
semantic-agent-tasks-create latest
```

## Supervisor improvements

| Comando | Uso |
| --- | --- |
| `idu-pi idu-supervisor-improvements-review latest` | Revisa propuestas de mejora. |
| `idu-pi idu-supervisor-improvements-create latest` | Guarda propuestas revisables. |
| `idu-pi idu-supervisor-improvements-status latest` | Muestra conteos/estado. |
| `idu-pi idu-supervisor-improvements-approve latest <id|all>` | Registra aprobación humana. |
| `idu-pi idu-supervisor-improvements-reject latest <id|all> [motivo]` | Registra rechazo. |
| `idu-pi idu-supervisor-improvements-defer latest <id|all> [motivo]` | Registra diferido. |
| `idu-pi idu-supervisor-improvements-apply latest` | Aplica sólo reglas aprobadas y permitidas. |

Nada se aplica sólo por crear propuestas. El humano decide.

## Learning rules

| Comando | Uso |
| --- | --- |
| `idu-pi idu-supervisor-learning-rules-status` | Lista reglas activas. |
| `idu-pi idu-supervisor-learning-rules-test` | Prueba reglas contra casos internos. |
| `idu-pi idu-supervisor-learning-rules-disable <ruleId> [motivo]` | Desactiva regla con backup. |
| `idu-pi idu-supervisor-learning-rules-enable <ruleId> [motivo]` | Reactiva regla con backup. |
| `idu-pi idu-supervisor-learning-rules-rollback latest` | Restaura backup validado. |

## Skills

| Comando | Uso |
| --- | --- |
| `idu-pi idu-skill-improvements-review latest` | Revisa propuestas de skills. |
| `idu-pi idu-skill-improvements-create latest` | Guarda propuestas de skills. |
| `idu-pi idu-skill-improvements-status latest` | Muestra estado de propuestas. |
| `idu-pi idu-skill-improvements-approve latest <id|all>` | Registra aprobación humana. |
| `idu-pi idu-skill-improvements-reject latest <id|all> [motivo]` | Registra rechazo. |
| `idu-pi idu-skill-improvements-defer latest <id|all> [motivo]` | Registra diferido. |
| `idu-pi idu-skill-drafts-create latest` | Crea drafts de skills aprobadas. |
| `idu-pi idu-skill-drafts-review latest` | Revisa draft sin tocar `.agents`. |

Los comandos de skills no modifican skills reales automáticamente.

## AgentLabs

| Comando | Uso |
| --- | --- |
| `idu-pi idu` | Entrada única: activa supervisor, muestra/reutiliza Plan Maestro y prepara deep review cuando corresponde; no convierte AgentLabs en workers. |
| `idu-pi idu-agentlab-request-create postflight` | Crea solicitudes formales desde postflight. |
| `idu-pi idu-agentlab-request-create master-plan latest` | Comando avanzado para Plan Maestro: crea solicitud audit-only; no ejecuta labs automáticamente. |
| `idu-pi idu-agentlab-request-create skill-draft latest` | Crea solicitud para revisar draft de skill. |
| `idu-pi idu-agentlab-request-create external-source-intelligence` | Crea solicitud para AgentLab bibliotecario audit-only: docs oficiales, changelogs, advisories, CVE/NVD, GitHub/npm advisories y señales comunitarias; no promueve contratos automáticamente. |
| `idu-pi idu-agentlab-request-review latest` | Valida solicitud sin ejecutar AgentLab. |
| `idu-pi idu-agentlab-review-run latest` | Ejecuta revisión review-only en workspace clone. |
| `idu-pi idu-agentlab-review-status latest` | Muestra informe AgentLab. |
| `idu-pi idu-agentlab-report-consolidate latest` | Consolida reportes en candidates. |
| `idu-pi idu-agentlab-report-consolidation-status latest` | Muestra estado de consolidación. |

La regla central:

```text
AgentLab revisa.
Idu-pi consolida.
Humano/orquestador decide.
Nada se aplica automáticamente.
```

## Supervisor

| Comando | Uso |
| --- | --- |
| `idu-pi idu-supervisor-tick` | Ejecuta ciclo supervisor seguro si `/idu` está activo. |

El tick puede observar, auditar, compactar y proponer. No aplica cambios críticos sin aprobación humana.

## Comandos locales desde el repo

```text
corepack pnpm cli -- status
corepack pnpm cli -- idu
corepack pnpm cli -- idu-preflight "cambia login"
corepack pnpm cli -- idu-agentlab-report-consolidate latest
```

## Garantías

- No commitea ni pushea.
- No copia secretos.
- No ejecuta AgentLabs salvo comandos explícitos de review run.
- No aplica Project Core, Constitution, flows, skills ni reglas sin rutas/decisiones explícitas.
- Nada crítico se aplica sin confirmación humana.

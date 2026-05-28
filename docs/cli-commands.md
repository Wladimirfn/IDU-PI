# Comandos CLI de Idu-pi

El CLI es la superficie principal para usar el core de Idu-pi. Telegram es una interfaz remota opcional para ejecutar comandos, revisar estado, cambiar de proyecto enrolado y confirmar decisiones sin estar en la terminal. Telegram no tiene otro core: sus botones son atajos al mismo CLI/supervisor.

Usá `idu-pi` para abrir el home CLI con estado y acciones recomendadas. Usá `idu-pi <comando>` si querés ejecutar un comando directo. Desde el repo, el equivalente es:

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

Guía: [Instalador y estado por proyecto](installer.md).

## Estado y activación

| Comando | Uso |
| --- | --- |
| `idu-pi status` | Muestra estado operativo del proyecto/agente. |
| `idu-pi idu` | Bootstrap inteligente: enrola si falta, crea estado/config/Core/Constitution draft, activa guardrails y prepara análisis seguro. |
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
| `idu-pi idu-agentlab-request-create postflight` | Crea solicitudes formales desde postflight. |
| `idu-pi idu-agentlab-request-create skill-draft latest` | Crea solicitud para revisar draft de skill. |
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

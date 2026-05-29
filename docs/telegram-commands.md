# Comandos Telegram de Idu-pi

Telegram es una interfaz de comodidad para operar Idu-pi desde chat. No es el núcleo del sistema.

El núcleo es el CLI/supervisor. Telegram funciona como control remoto conversacional: muestra botones para no memorizar comandos, reenvía texto libre al mismo flujo del CLI/supervisor, muestra estado y reenvía confirmaciones. Si Telegram cae, Idu-pi sigue teniendo CLI, reports y estado local.

## Ayuda y catálogo

| Comando | Uso |
| --- | --- |
| `/help` | Muestra comandos principales. |
| `/comandos` | Muestra catálogo con argumentos, CLI, Batch y PowerShell. |
| `/config sync_commands` | Sincroniza comandos visibles en Telegram con BotFather. |
| `/idu_menu` | Abre menú remoto con botones para el mismo CLI/supervisor. |
| `/idu_projects` | Lista proyectos enrolados y permite activar uno con botones. |

La fuente operativa del catálogo vive en `src/command-catalog.ts`.

## Activación Idu-pi

| Comando | Uso |
| --- | --- |
| `/idu` | Activa guardrails Idu-pi para el proyecto activo ya configurado; no auto-enrola proyectos. |
| `/idu_off` | Desactiva guardrails automáticos. |
| `/idu_status` | Muestra estado de Idu-pi. |
| `/idu_prepare` | Ejecuta preparación segura del proyecto. |
| `/idu_supervisor_tick` | Ejecuta ciclo supervisor seguro si corresponde. |
| `/idu_master_plan_status` | Muestra estado del Plan Maestro. |
| `/idu_master_plan_review [latest]` | Muestra el Plan Maestro sin aplicarlo. |
| `/idu_master_plan_approve [latest]` | Aprueba el Plan Maestro sin aplicar flows. |
| `/idu_master_plan_reject [latest] [motivo]` | Rechaza el Plan Maestro. |
| `/idu_master_plan_redraft [motivo]` | Genera nuevo draft determinista. |

`/idu` no significa “usar Telegram”. Significa activar el supervisor sobre el proyecto actual ya configurado. El bootstrap/enrolamiento cómodo vive en CLI/Pi slash y las herramientas MCP explícitas; Telegram mantiene `/idu_projects` como cambio de proyecto enrolado, sin auto-enroll.

## Menú remoto y proyectos

| Comando | Uso |
| --- | --- |
| `/idu_menu` | Muestra botones humanos: activar supervisor, estado, preparar, tareas, diagnóstico, dashboard y proyectos. |
| `/idu_projects` | Lista sólo proyectos ya enrolados y permite cambiar el proyecto activo. No auto-enrola. |
| Texto libre | Se reenvía al mismo flujo conversacional del CLI/supervisor. |

Los botones no crean un segundo core: apuntan a comandos existentes como `/idu`, `/idu_status`, `/idu_prepare`, `/queue_detail`, `/dashboard`, `/doctor`, `/projects` y `/useproject`.

## Configuración y Project Map

| Comando | Uso |
| --- | --- |
| `/config` | Muestra diagnóstico/configuración guiada. |
| `/config doctor` | Diagnóstico detallado. |
| `/config init_workspace` | Crea/verifica `reports/` y `workspaces/`. |
| `/config init_assets` | Crea assets mínimos `.agents`, `.atl`, `.mcp`. |
| `/config init_project_config` | Crea blueprint/flows si faltan. |
| `/config inspect_project_map` | Inspecciona mapa funcional sin escribir. |
| `/config scan_project_map` | Escanea código estático sin ejecutar proyecto. |
| `/config suggest_project_flows` | Sugiere cambios sin escribir. |
| `/config draft_project_flows` | Guarda draft en `reports/`. |
| `/config review_project_flows_draft [latest|ruta]` | Revisa draft sin aplicar. |
| `/config apply_project_flows_draft <ruta>` | Aplica draft con ruta explícita, backup y validación. |
| `/config ai_draft_project_blueprint` | Pide borrador seguro a Pi y lo guarda en `reports/`. |
| `/config ai_draft_project_flows` | Pide borrador seguro de flows y lo guarda en `reports/`. |
| `/config review_ai_blueprint_draft [latest|ruta]` | Revisa borrador IA sin aplicar. |
| `/config review_ai_flows_draft [latest|ruta]` | Revisa borrador IA de flows sin aplicar. |
| `/config skills_sync` | Sincroniza skills necesarias. |
| `/config db_init` | Inicializa DB local `reports/lab.db`. |

Más detalle: [`project-map-workflow.md`](project-map-workflow.md).

## Project Core

| Comando | Uso |
| --- | --- |
| `/idu_define_project` | Inicia wizard para definir Project Core. |
| `/idu_core_status` | Muestra estado de Project Core. |
| `/idu_research_core` | Crea research draft en `reports/`. |
| `/idu_review_core_research [latest|ruta]` | Revisa draft de research. |
| `/idu_confirm_core` | Confirma Project Core con decisión humana. |
| `/idu_reject_core` | Rechaza draft/core. |
| `/idu_core_diff` | Muestra diferencias. |

Project Core no queda como verdad sólo porque una IA lo propuso. Requiere confirmación humana.

## Preflight, advisory y postflight

| Comando | Uso |
| --- | --- |
| `/preflight <solicitud>` | Evalúa riesgo antes de trabajar. |
| `/advisory <solicitud>` | Devuelve recomendación operativa. |
| `/postflight` | Revisa cambios actuales. |
| `/lab_review_plan [postflight|preflight <solicitud>]` | Prepara revisión AgentLab sin ejecutarla. |

## Cola y tareas

| Comando | Uso |
| --- | --- |
| `/task bug <detalle>` | Crea tarea tipo bug. |
| `/task feature <detalle>` | Crea tarea tipo feature. |
| `/task refactor <detalle>` | Crea tarea tipo refactor. |
| `/task docs <detalle>` | Crea tarea de documentación. |
| `/queue` | Muestra cola legacy. |
| `/queue_detail` | Muestra cola estructurada persistida. |
| `/queue_approve <id>` | Aprueba tarea bloqueada. |
| `/queue_reject <id>` | Rechaza tarea bloqueada. |
| `/queue_clear` | Limpia cola legacy. |
| `/queue_clear_structured` | Limpia cola estructurada. |
| `/cancel` | Cancela tarea activa. |

La cola usa señales locales; no decide cambios críticos sola.

## Semantic audit y compaction

| Comando | Uso |
| --- | --- |
| `/semantic_audit_status` | Revisa conteos y checkpoint. |
| `/semantic_audit_run` | Registra auditoría manual. |
| `/semantic_compact_draft` | Crea draft de compactación. |
| `/semantic_compact_review [latest|ruta]` | Revisa draft sin aplicar memoria/reglas. |
| `/semantic_agent_tasks_review [latest|ruta]` | Revisa tareas candidatas. |
| `/semantic_agent_tasks_create [latest|ruta]` | Registra tareas review sin ejecutar AgentLabs. |

## Supervisor improvements y learning rules

| Comando | Uso |
| --- | --- |
| `/supervisor_improvements_review [latest|ruta]` | Revisa propuestas de mejora. |
| `/supervisor_improvements_create [latest|ruta]` | Guarda propuestas revisables. |
| `/supervisor_improvements_status [latest|ruta]` | Muestra estados. |
| `/supervisor_improvements_approve latest <id|all>` | Registra aprobación humana. |
| `/supervisor_improvements_reject latest <id|all> [motivo]` | Registra rechazo. |
| `/supervisor_improvements_defer latest <id|all> [motivo]` | Registra diferido. |
| `/supervisor_improvements_apply [latest|ruta]` | Aplica sólo reglas aprobadas y permitidas. |
| `/supervisor_learning_rules_status` | Lista reglas. |
| `/supervisor_learning_rules_test` | Prueba reglas. |
| `/supervisor_rules_disable <ruleId> [motivo]` | Desactiva regla con backup. |
| `/supervisor_learning_rules_enable <ruleId> [motivo]` | Reactiva regla con backup. |
| `/supervisor_rules_rollback latest` | Restaura backup. |

## Skills

| Comando | Uso |
| --- | --- |
| `/skill_improvements_review [latest|ruta]` | Revisa propuestas de skills. |
| `/skill_improvements_create [latest|ruta]` | Guarda propuestas revisables. |
| `/skill_improvements_status [latest|ruta]` | Muestra estado. |
| `/skill_improvements_approve latest <id|all>` | Registra aprobación humana. |
| `/skill_improvements_reject latest <id|all> [motivo]` | Registra rechazo. |
| `/skill_improvements_defer latest <id|all> [motivo]` | Registra diferido. |
| `/skill_drafts_create latest` | Crea drafts desde propuestas aprobadas. |
| `/skill_drafts_review latest` | Revisa drafts sin tocar skills reales. |

## AgentLabs

| Comando | Uso |
| --- | --- |
| `/agentlab_request_create postflight` | Crea solicitud formal desde postflight sin ejecutar AgentLab. |
| `/agentlab_request_create master-plan latest` | Crea solicitudes deep review desde Plan Maestro sin ejecutar AgentLab. |
| `/agentlab_request_create skill-draft latest` | Crea solicitud para revisar draft de skill. |
| `/agentlab_request_review [latest|ruta]` | Valida solicitud sin ejecutar. |
| `/agentlab_review_run [latest|ruta]` | Ejecuta review-only en workspace clone. |
| `/agentlab_review_status [latest|ruta]` | Muestra informe AgentLab. |
| `/agentlab_report_consolidate [latest|ruta]` | Consolida informes en candidates. |
| `/agentlab_report_status [latest|ruta]` | Muestra consolidación. |

Regla central:

```text
AgentLab revisa.
Idu-pi consolida.
Humano/orquestador decide.
Nada se aplica automáticamente.
```

## Agentes, labs y reportes

| Comando | Uso |
| --- | --- |
| `/agents` | Lista agentes/perfiles. |
| `/testlab quick` | Ejecuta smoke lab. |
| `/testlab 3tests` | Revisión media. |
| `/testlab 5tests` | Revisión fuerte. |
| `/testlab full` | Revisión amplia. |
| `/reports` | Lista reportes. |
| `/report <id> [defer|work|ignore|save]` | Registra decisión sobre reporte. |
| `/triagereports` | Triage de reportes pendientes. |
| `/syncreports` | Sincroniza reportes aprobados a memoria si está disponible. |

## Proyectos y sesiones

| Comando | Uso |
| --- | --- |
| `/projects` | Lista proyectos registrados. |
| `/where` | Muestra proyecto activo. |
| `/addproject <id> <ruta>` | Agrega proyecto permitido. |
| `/useproject <id>` | Cambia proyecto activo. |
| `/cwd <ruta>` | Cambia cwd permitido. |
| `/new <ruta>` | Alias para nuevo cwd. |
| `/trabajos` / `/work` | Lista trabajos recientes. |
| `/ver T1` | Ver trabajo. |
| `/nametrabajo T1 nombre` | Nombrar trabajo. |
| `/resume T1` | Retomar trabajo. |
| `/last` | Última sesión. |
| `/resumen` | Resumen. |

## Estado, servidor y modo

| Comando | Uso |
| --- | --- |
| `/status` | Estado del agente activo. |
| `/dashboard` | Panel operativo. |
| `/doctor` | Diagnóstico local. |
| `/server status` | Estado RPC. |
| `/server run` | Inicia/asegura RPC. |
| `/server restart` | Reinicia sesión RPC. |
| `/server off` | Detiene sesión RPC. |
| `/model` | Muestra modelo activo. |
| `/mode interactive` | Prefijo/modo interactivo. |
| `/mode auto` | Prefijo/modo auto. |
| `/mode clear` | Limpia modo. |

`/server` controla la sesión Pi RPC activa, no el proceso completo del bot.

## Memoria

| Comando | Uso |
| --- | --- |
| `/mem <query>` | Busca memoria vía Pi/Engram si está disponible. |
| `/syncreports` | Guarda reportes aprobados si memoria está disponible. |

Engram no viene garantizado por este repo. Si no está disponible, Idu-pi sigue funcionando con `reports/` y DB local.

## Garantía de seguridad

Telegram puede pedir, mostrar y confirmar. No decide por sí solo.

Nada crítico se aplica sin confirmación humana.

# Idu-pi

Idu-pi es un cerebelo supervisor de proyecto: ayuda a definir el plano, vigila la obra y coordina laboratorios de revisión sin reemplazar la decisión humana.

Su destinatario principal es el orquestador. Idu-pi habla directo con el usuario sólo para crear/aprobar el plan y para fallas graves; el resto del tiempo reporta señales de alineación, riesgo, calidad, costo, tiempo, seguridad, emoción y aprendizaje al orquestador para que ejecute con foco.

Idu-pi se usa principalmente desde CLI. Telegram es una interfaz remota opcional para operar ese mismo flujo cuando no estás en la terminal: comandos, estado y confirmaciones. El núcleo real es el supervisor que lee contexto del proyecto, aplica guardrails, registra reportes y prepara decisiones revisables.

## Qué problema resuelve

Idu-pi evita que un proyecto avance sin objetivo claro, sin reglas, sin memoria operativa o con riesgos invisibles de calidad, tiempo, costo/tokens y seguridad.

Sirve para responder preguntas como:

- ¿Este cambio coincide con el objetivo del proyecto?
- ¿Toca login, datos, seguridad o arquitectura?
- ¿Necesita confirmación humana antes de seguir?
- ¿Hay reportes o aprendizajes previos que deberían compactarse?
- ¿Conviene pedir una revisión AgentLab en sandbox?

## Seguridad de dependencias

Este repo asume que los scripts `postinstall` pueden ser un vector de ataque. Por eso la instalación segura combina varias barreras:

| Capa | Medida |
| --- | --- |
| npm/compatibilidad | `.npmrc` con `ignore-scripts=true` y `save-exact=true`. |
| pnpm 11 | `pnpm-workspace.yaml` con `ignoreScripts`, `minimumReleaseAge`, `strictDepBuilds` y `onlyBuiltDependencies: []`. |
| Dependencias | Versiones exactas en `package.json`; sin `latest` ni rangos `^`. |
| Publicación futura | `files` allowlist para no publicar archivos sensibles por accidente. |

Comando recomendado para instalar:

```text
corepack pnpm install --frozen-lockfile --ignore-scripts
```

Si alguna dependencia futura necesita build nativo, no habilites scripts globalmente: agregá una excepción explícita y revisable en `pnpm-workspace.yaml`.

## Qué NO es

- No es un bot de Telegram como núcleo del sistema; Telegram es una interfaz remota opcional del flujo CLI/supervisor.
- No es una autonomía que aplica cambios críticos sola.
- No reemplaza al humano ni al orquestador.
- No convierte propuestas de IA en verdad automáticamente.
- No ejecuta AgentLabs ni aplica reglas sólo por existir un reporte.

Nada crítico se aplica sin confirmación humana.

## Cómo funciona en 30 segundos

1. Entrás por `idu-pi` para ver el home o por `idu-pi idu` / Pi slash `/idu` para activar el supervisor del proyecto.
2. Si el proyecto no está registrado, lo enrolás explícitamente y Idu-pi crea estado aislado fuera del repo real.
3. Idu-pi genera o lee el Plan Maestro: objetivo, contratos, flujos, riesgos y diferencia entre docs declaradas y realidad construida.
4. Con Plan aprobado, el orquestador pide una acción candidata, crea un paquete de tarea y manda un governance-review antes de codificar.
5. Los workers normales del orquestador implementan; Idu-pi sólo audita, recomienda y hace postflight con evidencia.
6. AgentLabs se ejecutan sólo por llamada explícita y siempre son audit-only: no editan repo, no hacen commit/push y no implementan.
7. El humano/orquestador decide qué aplicar, confirmar, encolar, regenerar o descartar.

## Ruta rápida para usuarios nuevos

```powershell
# 1) Instalar / verificar sin cambios destructivos
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -DryRun
powershell -ExecutionPolicy Bypass -File scripts/install.ps1

# 2) Abrir el home
idu-pi

# 3) Configurar MCP para que Pi vea las tools de Idu-pi
idu-pi setup mcp-init

# 4) Registrar un proyecto real
idu-pi project enroll "C:\ruta\a\tu-proyecto" mi-proyecto

# 5) Activar supervisor local
idu-pi idu

# 6) Crear/revisar/aprobar Plan Maestro cuando estés conforme
idu-pi master-plan-status
idu-pi master-plan-review latest
idu-pi master-plan-approve latest
```

Después de eso, el orquestador puede usar MCP para el loop preventivo:

```text
idu_plan_snapshot
→ idu_supervisor_context_pack
→ idu_next_advisory_action
→ idu_continuation_proposal
→ idu_task_package_create
→ governance-review del orquestador
→ worker normal
→ idu_postflight
→ idu_agentlab_review_run sólo si el orquestador lo decide
```

## Arquitectura simple

```text
Humano → Orquestador → Subagentes / código
              ↑
           Idu-pi Supervisor → AgentLabs / reports / DB / memoria
```

Idu-pi no compite con el orquestador: lo supervisa. Si detecta desvío del plan, falta de evidencia, costo excesivo, riesgo crítico o confusión del usuario, le avisa al orquestador con una recomendación accionable. Para que el supervisor no sea invisible, las salidas MCP principales exponen `data.supervisorConsultation`: objetivo del Plan Maestro, recomendación, riesgos, gates, contratos, evidencia y razón de avanzar/frenar.

Roles:

| Rol | Responsabilidad |
| --- | --- |
| Humano | Define intención, aprueba decisiones críticas, commits, pushes y cambios de verdad. |
| Orquestador | Ejecuta trabajo, coordina subagentes, aplica decisiones aprobadas. |
| Idu-pi | Supervisa plan, riesgo, contexto, memoria, reportes, propuestas, gates, costo, calidad, seguridad, emoción y aprendizaje; mide calidad de contexto local, reporta deuda semántica/context pruning y genera inteligencia externa allowlist para factibilidad sin guardar prompts/docs crudos ni borrar/actualizar automáticamente. |
| AgentLabs | Inspeccionan en sandbox como especialistas y reportan evidencia. |
| Subagentes | Ejecutan tareas acotadas bajo coordinación del orquestador. |

## Interfaces

Idu-pi puede usarse por varias superficies:

| Interfaz | Para qué sirve |
| --- | --- |
| CLI | Superficie principal para uso local, scripts, validación rápida e integración con Pi. |
| Telegram | Interfaz remota opcional para usar comandos, estado y confirmaciones del mismo supervisor sin estar en la terminal. |
| MCP Server | Herramientas stdio para que el orquestador consulte Idu-pi desde cualquier proyecto; incluye `idu_supervisor_context_pack` para inyectar metas, contratos, riesgos, gates y refs locales de Bibliotecario/Source Library sin volcar docs largas. |
| Futuras UI/dashboard | Visualizar cola, reportes, propuestas y estado del supervisor. |

Más detalle: [MCP Server](docs/mcp-server.md).

Todas las interfaces llaman al mismo core. El core no depende de Telegram.

## Instalación / configuración

Primera instalación segura, cuando `idu-pi` todavía no existe en `PATH`:

```powershell
git clone https://github.com/Wladimirfn/IDU-PI.git idu-pi
cd idu-pi
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

Dry-run verificable:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -DryRun
# o
node scripts/install.mjs --dry-run
```

El instalador no ejecuta bootstrap remoto opaco ni scripts de dependencias: usa `pnpm-lock.yaml` con `--frozen-lockfile --ignore-scripts`; pnpm puede descargar paquetes fijados desde el registry/cache configurado. El repo además incluye defensa en profundidad para instalaciones manuales: `.npmrc` bloquea scripts en clientes npm/compatibles, `pnpm-workspace.yaml` declara `ignoreScripts`, `minimumReleaseAge`, `strictDepBuilds` y `onlyBuiltDependencies: []`, y `package.json` usa versiones exactas. No ejecuta Telegram/AgentLabs ni enrola proyectos. Si crea el shim local y falta en `PATH`, pregunta antes de agregarlo al `PATH` de usuario; para aceptarlo sin segunda pregunta usá `-Yes -AddPath`. Guía: [Instalación rápida segura](docs/quickstart-install.md).

Para entrar sin memorizar comandos después de instalar:

```text
idu-pi
```

Primera vez desde el repo, antes del link global o shim:

```text
corepack pnpm cli
# o después de compilar
node dist/src/cli.js
```

El home muestra logo, estado del sistema, MCP, proyecto actual, supervisor, rutas de estado y acciones recomendadas. Si la terminal es interactiva, muestra un menú minimalista:

```text
1. Configurar IDU-Pi
2. Proyecto actual
3. Telegram remoto
4. Modelos y perfiles
5. Supervisor
6. Tareas y cola
7. Diagnóstico
8. Exit
```

Si no es interactivo, imprime el resumen y sale sin escribir archivos.

Para configurar MCP y enrolar proyectos externos:

```text
idu-pi setup status
idu-pi setup wizard
idu-pi setup path-help
idu-pi setup mcp-init
idu-pi project enroll <projectPath> [projectId]
```

Desde MCP, el orquestador usa Idu-pi como guía de buenas prácticas, asesor y auditor; no como autoridad ciega. Las tools principales son:

```text
# Proyecto y sesión
idu_project_status
idu_project_enroll
idu_project_reset_state
idu_bootstrap_project
idu_start
idu_status
idu_activate
idu_deactivate
idu_prepare

# Plan Maestro
idu_master_plan_status
idu_master_plan_create
idu_master_plan_review
idu_master_plan_approve
idu_master_plan_reject
idu_plan_snapshot
idu_next_advisory_action
idu_continuation_proposal
idu_task_package_create

# Riesgo, tareas y postflight
idu_orchestrator_procedure
idu_task_context
idu_preflight
idu_advisory
idu_postflight
idu_task
idu_queue_detail
idu_queue_complete
idu_semantic_audit_status
idu_supervisor_tick
idu_bibliotecario_proactive_advisory

# Source Library / documentación manual
idu_source_status
idu_source_add
idu_source_remove
idu_source_read
idu_source_extract
idu_source_report
idu_source_research_report
idu_source_digest
idu_source_digest_status
idu_source_chunk_read
idu_source_recommend_for_task
idu_source_required_actions
idu_source_refresh
idu_external_source_recommend
idu_external_intelligence_report

# AgentLabs audit-only
idu_agentlab_request_create
idu_agentlab_review_run
idu_agentlab_review_status
```

`idu_start` activa guardrails para proyectos registrados y corre el hook seguro de arranque supervisor (`on_idu_activation`) exponiendo `data.supervisorStartup`; no enrola ni crea drafts. `idu_activate` sólo activa guardrails; no enrola, no crea drafts y no corre hook de arranque. `idu_source_add/status/remove/read/extract/report/research/digest/chunk/recommend/required-actions/refresh` mantienen una Source Library en `stateRoot/Doc/<project>` para documentación manual `.md`, `.txt` y `.pdf`; los PDFs se copian/registran con conversión best-effort desde texto embebido a Markdown, sin OCR ni dependencias nuevas; si no hay texto legible quedan `metadata_only`. Los digests dividen documentos grandes con texto real en chunks/tomos bajo `sources/chunks`, guardan `sources/digests/<sourceId>.json` y actualizan `source-library-index.json` para recomendar lecturas al orquestador; si una fuente no es legible, no inventan temas y devuelven acción requerida para lector bibliotecario especializado. Ninguna fuente promueve contratos automáticamente. `idu_external_source_recommend` usa un registry no-fetch para recomendar fuentes por tarea/dominio/lenguaje/framework: official docs, academic discovery, community signals y blocked/manual, incluyendo estructura de programación como HTML sin JS embebido, separación de responsabilidades y carpetas controladas. No consulta web, no guarda raw docs, no importa Source Library, no ejecuta AgentLabs y no promueve contratos. `idu_external_intelligence_report` consulta sólo source IDs externos exactos/allowlist, guarda un reporte normalizado bajo `stateRoot/reports/external-intelligence` y no acepta URLs libres, no guarda cuerpos crudos, no actualiza dependencias, no ejecuta AgentLabs ni promueve contratos. `idu_master_plan_create` crea/regenera en `stateRoot` un Plan Maestro normativo que separa documentación declarada, realidad construida, drift, contratos y flujos permanentes (`master-plan.flows.json`). `idu_master_plan_review` devuelve además `revisionAntesDeZarpar`: una revisión honesta para el orquestador con entendimiento del proyecto, contratos necesarios, definiciones faltantes, fuentes, herramientas/MCP, AgentLabs recomendados, problemas, estrategia de arreglo, preguntas al usuario y checklist antes de ejecutar trabajo grande. `idu_master_plan_approve` y `idu_master_plan_reject` cierran explícitamente el ciclo normativo desde MCP: cambian sólo artefactos de gobernanza en `stateRoot`, no aplican flows, no ejecutan AgentLabs, no tocan el repo real y no hacen commit/push. Con un Plan aprobado, `idu_plan_snapshot`, `idu_next_advisory_action`, `idu_continuation_proposal` e `idu_task_package_create` arman lineamientos preventivos para que el orquestador revise Plan/flows/contratos con un subagente governance-review antes de codificar. `idu_continuation_proposal` cierra el ciclo post-tarea: consulta Plan Maestro + cola/Todos + preflight/guards + ventana de autonomía y devuelve si conviene `continue_autonomously`, `ask_user` o `stop_no_safe_action` sin implementar ni ejecutar AgentLabs. `idu_orchestrator_procedure` e `idu_task_context` devuelven severidad, confianza, evidencia, lecturas requeridas, contratos afectados, labs sugeridos y guía para subagentes. El orquestador revalida y decide. `idu_agentlab_request_create` sólo crea solicitud; los labs se ejecutan únicamente con `idu_agentlab_review_run` o llamada explícita del orquestador.

Guía: [Instalador, home CLI y estado por proyecto](docs/installer.md).

## Cómo se activa

Desde Telegram, usá el menú remoto para no memorizar comandos:

```text
/idu_menu
/idu_projects
/idu
/idu_status
/idu_off
```

Telegram replica el mismo flujo CLI/supervisor: los botones son atajos a comandos existentes y el texto libre se reenvía como entrada humana al core.

Desde CLI:

```text
idu-pi idu
idu-pi idu-status
idu-pi idu-off
```

En CLI y Pi slash, `idu-pi idu` / `idu-pi idu start` / `/idu` es el flujo cómodo de bootstrap/start: puede enrolar un proyecto permitido, crear estado aislado y drafts de Project Core/Constitution si faltan, activar guardrails, mostrar el arranque supervisor y mostrar el dashboard/reporte. En Telegram, `/idu` es activación remota sobre el proyecto activo ya configurado; no crea un segundo core ni auto-enrola proyectos.

`/idu_off` apaga esos guardrails automáticos. Los comandos manuales siguen disponibles.

### Living Loop Triggers (opt-in)

El trigger engine inyecta envelopes al orchestrator cuando se cumplen condiciones (tareas colgadas, recordatorio del objetivo, intenciones pendientes de decisión humana). Es opt-in:

```bash
# Activar
IDU_PI_TRIGGER_ENGINE=1

# O en Windows (en el .env o en la Task Scheduler del bridge):
setx IDU_PI_TRIGGER_ENGINE 1
```

Sin el flag, el trigger engine no se invoca desde el bridge runtime. Ver [`docs/living-loop-triggers.md`](docs/living-loop-triggers.md) para el bus de eventos, los disparadores, las tools MCP (`idu_pending_injections`, `idu_subscribe_triggers`) y los flows end-to-end.

## Conceptos principales

### Project Core

Project Core es el plano maestro: objetivo, alcance, usuarios, stack, sensibilidad de datos, restricciones y criterios de éxito. Puede nacer como draft, pero sólo es fuente de verdad cuando el humano lo confirma.

### Constitution

Constitution son las normas técnicas derivadas del Project Core confirmado. Traducen alcance, stack, seguridad, datos y aprobaciones humanas a reglas operativas.

### Gates

Los gates son validadores deterministas. Revisan intención, archivos cambiados y riesgos. Si aparece riesgo `high` o `blocker`, Idu-pi pide confirmación humana.

### AgentLabs

AgentLabs son especialistas de revisión audit-only. Inspeccionan en workspaces aislados, producen reportes con evidencia y no aplican cambios al repo real, no crean workspaces permanentes en `stateRoot`, no hacen commit/push y no implementan features. Las solicitudes, ejecuciones y estados exponen `workloadEnvelope` advisory-only para declarar carga, presupuesto y estados honestos (`completed`, `partial`, `timed_out`, `stale`, `failed`, etc.) sin autorizar ejecución ni promoción de contratos. Para bibliotecario, `external-source-intelligence` usa refs locales de Source Library/digests antes que prompts genéricos y no hace web/live fetch automático. Para auditorías grandes, `specialist-audit-plan` divide la solicitud en especialistas con envelopes por especialidad y exige ejecución explícita posterior. Idu-pi registra efectividad AgentLab localmente en `stateRoot/reports/agentlab-effectiveness-events.jsonl` con counts/outcomes/severidades/completitud de evidencia, sin prompts, texto crudo, env, headers, tokens, costo, porcentajes de contexto ni analytics remota. La calidad del contexto supervisor se mide aparte en `stateRoot/reports/context-quality-events.jsonl` con ratings/cuentas derivadas, sin guardar prompts/docs crudos ni medir tokens/costo/% contexto. Idu-pi consolida esos reportes en hallazgos, recomendaciones y candidates; el humano/orquestador decide.

### Plan Maestro

Plan Maestro es el documento normativo vivo del proyecto. Responde qué es el repo, qué hace, cómo está construido, qué alcance tiene, qué requisitos debe cumplir, qué contratos gobiernan cambios y qué diferencia existe entre la documentación declarada y la realidad construida. Los flujos permanentes viven aparte en `master-plan.flows.json` para que puedan actualizarse junto al proyecto sin convertir el Plan Maestro en lista de tareas.

El contrato de datos no se limita a “hay DB”: debe declarar stores, owner lógico, retención, backup/restore, sanitización/redacción, migración/rollback y ciclo de vida de artefactos SQLite/JSON/JSONL. Los flujos de ingesta, reportes y API deben quedar asociados a stores detectados/canónicos; si no hay evidencia, Idu-pi lo marca como riesgo en vez de inventar persistencia.

La revisión del Plan Maestro incluye `revisionAntesDeZarpar`: contratos entendidos como acuerdos/recursos de preparación, no sólo prohibiciones. Cubre objetivo, stack, arquitectura, datos, seguridad, navegación, fuentes de información, AgentLabs, testing y entrega. Si falta una biblioteca local de fuentes (`Doc/<project>/source-index.json` y `sources/local/` para PDFs, normas, leyes o libros), la revisión la marca como fuente recomendada antes de derivar normas fuertes. Las fuentes externas vivas —docs oficiales, changelogs, releases/issues, GitHub/npm advisories, OWASP/CVE/NVD, posts oficiales en X/Twitter, Reddit/comunidades técnicas y blogs/noticias de seguridad— sólo informan riesgos y recomendaciones; no se convierten automáticamente en contratos aprobados. Para esa inteligencia, Idu-pi ofrece `idu_external_intelligence_report` como primer conector controlado del Bibliotecario: source IDs allowlist, reportes normalizados stateRoot-only y sin web libre, updates automáticos ni ejecución AgentLab. AgentLab bibliotecario sigue siendo audit-only y mantiene al orquestador informado sin implementar ni modificar el repo.

### Supervisor loop

El supervisor loop observa señales, audita eventos, compacta memoria, propone mejoras y prepara tareas. No reemplaza el criterio humano.

## Qué protege

| Pilar | Cómo ayuda Idu-pi |
| --- | --- |
| Calidad | Pide contexto, tests, evidencia y revisión antes de avanzar. |
| Tiempo | Prioriza señales humanas, evita loops y reduce retrabajo. |
| Costo/tokens | Compacta contexto y propone mejoras de flujo cuando hay ruido. |
| Seguridad | Bloquea cambios sensibles y exige aprobación en zonas críticas. |
| Reportes | Guarda salidas revisables en `reports/` y DB local. |
| Recursos | Usa labs/sandbox para revisar sin contaminar el repo real. |
| Aprendizaje | Convierte reportes en propuestas, reglas, skills y memoria candidata. |

Nada crítico se aplica sin confirmación humana.

## Instalación rápida

Recomendado en Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

Instalación manual para desarrollo:

```bash
corepack pnpm install
cp .env.example .env
corepack pnpm dev
```

Variables mínimas en `.env` para el adapter Telegram:

```env
TELEGRAM_BOT_TOKEN=token_de_botfather
ALLOWED_USER_ID=123456789
DEFAULT_CWD=/ruta/absoluta/a/tu/proyecto
ALLOWED_ROOTS=/ruta/absoluta/a/tu/proyecto
PI_BIN=pi
AGENT_WORKSPACE_ROOT=/ruta/absoluta/a/bridge-agents
AGENT_WORKSPACE_MODE=clone
```

## Camino inicial recomendado

Desde Telegram:

```text
/config
/config init_workspace
/config init_assets
/config init_project_config
/config skills_sync
/config db_init
/config sync_commands
/idu
/idu_status
```

Desde CLI:

```text
idu-pi status
idu-pi idu
idu-pi idu-status
idu-pi idu-prepare
```

## Seguridad operativa

- Nunca subas `.env`.
- Mantené `ALLOWED_ROOTS` limitado.
- No subas tokens, API keys, registros locales ni estado runtime.
- Usá workspaces clone para AgentLabs.
- No copies cambios desde labs sin revisión humana.
- No hagas commit/push sin aprobación humana explícita.
- Nada crítico se aplica sin confirmación humana.

## Desarrollo

```bash
corepack pnpm build
corepack pnpm test
```

## Documentación

- [`docs/quickstart-install.md`](docs/quickstart-install.md) — primera instalación segura con bootstrap installer.
- [`docs/cli-commands.md`](docs/cli-commands.md) — comandos CLI por grupo.
- [`docs/telegram-commands.md`](docs/telegram-commands.md) — comandos Telegram por grupo.
- [`docs/supervisor-model.md`](docs/supervisor-model.md) — modelo conceptual del supervisor.
- [`docs/superpowers/specs/2026-06-07-birth-pipeline-universal-design.md`](docs/superpowers/specs/2026-06-07-birth-pipeline-universal-design.md) — Birth Pipeline Universal: Project Core → Plan Maestro → Prototipo → Spec General → Repo/Git gate.
- [`docs/superpowers/specs/2026-06-08-supervisor-autoresurrect-exploration.md`](docs/superpowers/specs/2026-06-08-supervisor-autoresurrect-exploration.md) — exploración de causa raíz y opciones para resucitar el supervisor automático.
- [`docs/architecture.md`](docs/architecture.md) — arquitectura técnica y módulos core.
- [`docs/project-map-workflow.md`](docs/project-map-workflow.md) — workflow de Project Core, blueprint y flows.
- [`docs/lab-agent-best-practices.md`](docs/lab-agent-best-practices.md) — checklist operativo para AgentLabs.
- [`docs/living-loop-triggers.md`](docs/living-loop-triggers.md) — bus de eventos, inyecciones, disparadores y activación (`IDU_PI_TRIGGER_ENGINE=1`).

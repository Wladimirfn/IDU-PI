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

## Qué NO es

- No es un bot de Telegram como núcleo del sistema; Telegram es una interfaz remota opcional del flujo CLI/supervisor.
- No es una autonomía que aplica cambios críticos sola.
- No reemplaza al humano ni al orquestador.
- No convierte propuestas de IA en verdad automáticamente.
- No ejecuta AgentLabs ni aplica reglas sólo por existir un reporte.

Nada crítico se aplica sin confirmación humana.

## Cómo funciona en 30 segundos

1. Iniciás Idu-pi desde la superficie disponible: `idu-pi idu` / Pi slash `/idu` como flujo cómodo de bootstrap/start local, o Telegram `/idu` para activar guardrails remotos sobre un proyecto ya configurado.
2. Idu-pi revisa Project Core, Constitution, flows, reportes y memoria disponible.
3. Interpreta la intención humana con señales deterministas.
4. Bloquea o pide confirmación cuando detecta riesgo alto.
5. Audita eventos y compacta conocimiento en drafts revisables.
6. Propone mejoras, reglas, skills o tareas futuras sin aplicarlas sola.
7. AgentLabs revisan en sandbox/clone y devuelven evidencia.
8. El humano/orquestador decide qué aplicar, encolar, ignorar o guardar.

## Arquitectura simple

```text
Humano → Orquestador → Subagentes / código
              ↑
           Idu-pi Supervisor → AgentLabs / reports / DB / memoria
```

Idu-pi no compite con el orquestador: lo supervisa. Si detecta desvío del plan, falta de evidencia, costo excesivo, riesgo crítico o confusión del usuario, le avisa al orquestador con una recomendación accionable.

Roles:

| Rol | Responsabilidad |
| --- | --- |
| Humano | Define intención, aprueba decisiones críticas, commits, pushes y cambios de verdad. |
| Orquestador | Ejecuta trabajo, coordina subagentes, aplica decisiones aprobadas. |
| Idu-pi | Supervisa plan, riesgo, contexto, memoria, reportes, propuestas, gates, costo, calidad, seguridad, emoción y aprendizaje. |
| AgentLabs | Inspeccionan en sandbox como especialistas y reportan evidencia. |
| Subagentes | Ejecutan tareas acotadas bajo coordinación del orquestador. |

## Interfaces

Idu-pi puede usarse por varias superficies:

| Interfaz | Para qué sirve |
| --- | --- |
| CLI | Superficie principal para uso local, scripts, validación rápida e integración con Pi. |
| Telegram | Interfaz remota opcional para usar comandos, estado y confirmaciones del mismo supervisor sin estar en la terminal. |
| MCP Server | Herramientas stdio para que el orquestador consulte Idu-pi desde cualquier proyecto. |
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

El instalador no ejecuta bootstrap remoto opaco ni scripts de dependencias: usa `pnpm-lock.yaml` con `--frozen-lockfile --ignore-scripts`; pnpm puede descargar paquetes fijados desde el registry/cache configurado. No ejecuta Telegram/AgentLabs ni enrola proyectos. Si crea el shim local y falta en `PATH`, pregunta antes de agregarlo al `PATH` de usuario; para aceptarlo sin segunda pregunta usá `-Yes -AddPath`. Guía: [Instalación rápida segura](docs/quickstart-install.md).

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

Desde MCP, el orquestador usa Idu-pi como guía de buenas prácticas, asesor y auditor; no como autoridad ciega:

```text
idu_project_status
idu_project_enroll
idu_bootstrap_project
idu_start
idu_master_plan_status
idu_master_plan_create
idu_master_plan_review
idu_master_plan_approve
idu_master_plan_reject
idu_plan_snapshot
idu_next_advisory_action
idu_task_package_create
idu_orchestrator_procedure
idu_task_context
idu_preflight
idu_postflight
idu_agentlab_request_create
idu_agentlab_review_run
```

`idu_activate` sólo activa guardrails; no enrola ni crea drafts. `idu_master_plan_create` crea/regenera en `stateRoot` un Plan Maestro normativo que separa documentación declarada, realidad construida, drift, contratos y flujos permanentes (`master-plan.flows.json`). `idu_master_plan_review` devuelve además `revisionAntesDeZarpar`: una revisión honesta para el orquestador con entendimiento del proyecto, contratos necesarios, definiciones faltantes, fuentes, herramientas/MCP, AgentLabs recomendados, problemas, estrategia de arreglo, preguntas al usuario y checklist antes de ejecutar trabajo grande. `idu_master_plan_approve` y `idu_master_plan_reject` cierran explícitamente el ciclo normativo desde MCP: cambian sólo artefactos de gobernanza en `stateRoot`, no aplican flows, no ejecutan AgentLabs, no tocan el repo real y no hacen commit/push. Con un Plan aprobado, `idu_plan_snapshot`, `idu_next_advisory_action` e `idu_task_package_create` arman lineamientos preventivos para que el orquestador revise Plan/flows/contratos con un subagente governance-review antes de codificar. `idu_orchestrator_procedure` e `idu_task_context` devuelven severidad, confianza, evidencia, lecturas requeridas, contratos afectados, labs sugeridos y guía para subagentes. El orquestador revalida y decide. `idu_agentlab_request_create` sólo crea solicitud; los labs se ejecutan únicamente con `idu_agentlab_review_run` o llamada explícita del orquestador.

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

En CLI y Pi slash, `idu-pi idu` / `/idu` es el flujo cómodo de bootstrap/start: puede enrolar un proyecto permitido, crear estado aislado y drafts de Project Core/Constitution si faltan, activar guardrails y mostrar el dashboard. En Telegram, `/idu` es activación remota sobre el proyecto activo ya configurado; no crea un segundo core ni auto-enrola proyectos.

`/idu_off` apaga esos guardrails automáticos. Los comandos manuales siguen disponibles.

## Conceptos principales

### Project Core

Project Core es el plano maestro: objetivo, alcance, usuarios, stack, sensibilidad de datos, restricciones y criterios de éxito. Puede nacer como draft, pero sólo es fuente de verdad cuando el humano lo confirma.

### Constitution

Constitution son las normas técnicas derivadas del Project Core confirmado. Traducen alcance, stack, seguridad, datos y aprobaciones humanas a reglas operativas.

### Gates

Los gates son validadores deterministas. Revisan intención, archivos cambiados y riesgos. Si aparece riesgo `high` o `blocker`, Idu-pi pide confirmación humana.

### AgentLabs

AgentLabs son especialistas de revisión audit-only. Inspeccionan en workspaces aislados, producen reportes con evidencia y no aplican cambios al repo real, no crean workspaces permanentes en `stateRoot`, no hacen commit/push y no implementan features. Idu-pi consolida esos reportes en hallazgos, recomendaciones y candidates; el humano/orquestador decide.

### Plan Maestro

Plan Maestro es el documento normativo vivo del proyecto. Responde qué es el repo, qué hace, cómo está construido, qué alcance tiene, qué requisitos debe cumplir, qué contratos gobiernan cambios y qué diferencia existe entre la documentación declarada y la realidad construida. Los flujos permanentes viven aparte en `master-plan.flows.json` para que puedan actualizarse junto al proyecto sin convertir el Plan Maestro en lista de tareas.

La revisión del Plan Maestro incluye `revisionAntesDeZarpar`: contratos entendidos como acuerdos/recursos de preparación, no sólo prohibiciones. Cubre objetivo, stack, arquitectura, datos, seguridad, navegación, fuentes de información, AgentLabs, testing y entrega. Si falta una biblioteca local de fuentes (`Doc/<project>/source-index.json` y `sources/local/` para PDFs, normas, leyes o libros), la revisión la marca como fuente recomendada antes de derivar normas fuertes. Las fuentes externas vivas —docs oficiales, changelogs, releases/issues, GitHub/npm advisories, OWASP/CVE/NVD, posts oficiales en X/Twitter, Reddit/comunidades técnicas y blogs/noticias de seguridad— sólo informan riesgos y recomendaciones; no se convierten automáticamente en contratos aprobados. Para esa inteligencia, Idu-pi recomienda un AgentLab bibliotecario audit-only que mantiene al orquestador informado sin implementar ni modificar el repo.

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
- [`docs/architecture.md`](docs/architecture.md) — arquitectura técnica y módulos core.
- [`docs/project-map-workflow.md`](docs/project-map-workflow.md) — workflow de Project Core, blueprint y flows.
- [`docs/lab-agent-best-practices.md`](docs/lab-agent-best-practices.md) — checklist operativo para AgentLabs.

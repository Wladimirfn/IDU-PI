# Idu-pi MCP Server

MCP en Idu-pi es un adapter para que el orquestador consulte al supervisor desde cualquier proyecto abierto.

Regla central: MCP no reemplaza a Idu-pi. MCP expone Idu-pi al orquestador.

## Core vs adapters

```text
Idu-pi Core
├─ CLI adapter
├─ Telegram adapter
├─ MCP adapter
├─ Supervisor loop
├─ Project Core / Constitution / Gates
├─ Semantic memory
├─ AgentLabs
└─ reports / DB
```

- **Idu-pi Core**: núcleo supervisor, guardrails, gates, memoria semántica, reports y AgentLabs.
- **CLI**: adapter para terminal local.
- **Telegram**: adapter para celular/chat.
- **MCP Server**: adapter stdio para que el orquestador use Idu-pi como herramientas.

Ningún adapter debe duplicar lógica del core.

## Cómo correr

Recomendado: primero configurar el adapter MCP en Pi:

```bash
corepack pnpm cli -- setup mcp-init
# o
idu-pi setup mcp-init
```

Para imprimir la configuración sin escribir:

```bash
idu-pi setup mcp-print
```

Desde el repo Idu-pi:

```bash
corepack pnpm mcp
```

Como bin compilado:

```bash
idu-pi-mcp
```

También se puede ejecutar directo después de compilar:

```bash
corepack pnpm build
node dist/src/mcp-server.js
```

El servidor usa stdio JSON-RPC/MCP. No levanta Telegram y no importa el entrypoint de Telegram.

`setup mcp-init` configura el servidor con `cwd` apuntando al repo Idu-pi y `directTools: true`, para que Pi pueda cachear/exponer sus herramientas aunque el orquestador esté abierto en otro proyecto.

## Configuración conceptual del orquestador

Ejemplo conceptual:

```json
{
  "mcpServers": {
    "idu-pi": {
      "command": "node",
      "args": ["C:\\Users\\elmas\\pi-telegram-bridge\\dist\\src\\mcp-server.js"],
      "cwd": "C:\\Users\\elmas\\pi-telegram-bridge",
      "lifecycle": "lazy",
      "directTools": true
    }
  }
}
```

`TELEGRAM_BOT_TOKEN` y `ALLOWED_USER_ID` no son necesarios para el MCP adapter. El adapter carga la `.env` y el registry del paquete Idu-pi, no del proyecto externo que tenga abierto el orquestador.

## Resolución de proyecto

Antes de usar un proyecto externo, enrolalo para aislar estado:

```bash
idu-pi project enroll "C:\\Users\\elmas\\OneDrive\\Escritorio\\Mis proyectos\\Sistema_de_mantencion"
```

Cada herramienta acepta `projectPath` opcional.

1. Si `projectPath` viene, Idu-pi valida la ruta contra `ALLOWED_ROOTS` e intenta asociarla con el registry.
2. Si la ruta no está registrada, las herramientas de lectura/activación devuelven `unregistered_project` con diagnóstico claro. No escriben el registry automáticamente.
3. Si `projectPath` no viene, usa el proyecto activo del registry.
4. Si no hay proyecto activo, usa `process.cwd()` sólo como candidato y recomienda registrar el proyecto.
5. El registry sólo se modifica desde herramientas explícitas: `idu_project_enroll` o `idu_bootstrap_project`; `idu_project_reset_state` borra estado aislado pero deja el registry intacto.

## Herramientas disponibles

Todas devuelven JSON estructurado con:

```json
{
  "ok": true,
  "tool": "idu_status",
  "projectId": "sistema_de_mantencion",
  "projectPath": "C:\\...",
  "summary": "...",
  "data": {},
  "safeNotes": [],
  "errors": []
}
```

Las herramientas que evalúan intención o supervisor (`idu_preflight`, `idu_advisory`, `idu_supervisor_tick`, `idu_task_context`) agregan `data.alignmentAdvisory`: una señal compacta para el orquestador con `audience`, `severity`, `alignment`, `recommendation`, `confidence`, `requiredReads`, `suggestedAgentLabs`, `orchestratorGuidance` y `evidenceRefs`. `idu_supervisor_context_pack` expone esa guía como `data.taskContext` junto con el paquete compacto de objetivo/Plan/contratos/riesgos/gates. Esto evita pasarle al usuario reportes largos cuando el destinatario real es el orquestador.

El modo de autoridad MCP por defecto es `IDU_MCP_AUTHORITY_MODE=advisory`: Idu-pi informa, audita y recomienda; el orquestador revalida, decide, ejecuta y comunica. El valor `strict` queda reservado para despliegues futuros con hazards críticos explícitos y hoy sólo se expone como dato de configuración, no como permiso para imponer decisiones.

`idu_master_plan_review` agrega `data.revisionAntesDeZarpar`: la revisión previa a navegar. Esta estructura resume entendimiento del proyecto, contratos necesarios, definiciones faltantes, fuentes de información, fuentes externas vivas recomendadas, MCP/herramientas requeridas, AgentLabs sugeridos, problemas actuales, estrategia de arreglo, preguntas para el usuario y checklist antes de trabajo grande. `idu_master_plan_approve` e `idu_master_plan_reject` cierran ese ciclo de forma explícita: sólo cambian el estado del Plan Maestro y sus artefactos de gobernanza en `stateRoot`; no aplican flows, no ejecutan AgentLabs, no modifican el repo real y no hacen commit/push. Los contratos son acuerdos de readiness/recursos: objetivo, stack, arquitectura, datos, seguridad, navegación, fuentes, AgentLabs, testing y entrega. La biblioteca de fuentes locales registra documentación manual en `stateRoot/Doc/<project>`: `.md`/`.txt` generan snapshot de texto simple y `.pdf` intenta conversión best-effort desde texto embebido a Markdown sin OCR ni dependencias nuevas; si no hay texto legible queda `metadata_only/pending_conversion`. Las herramientas de lectura/extracción/research/digest operan sólo sobre fuentes registradas y texto legible/snapshots; no consultan web ni promueven contratos. Source Digest divide documentos grandes con texto real en chunks/tomos bajo `sources/chunks`, guarda `sources/digests/<sourceId>.json`, actualiza `source-library-index.json` y permite recomendar al orquestador qué fuente/chunk debe mandar a leer con subagentes antes de codificar. Si una fuente no tiene texto legible, no inventa temas por metadata: marca acción requerida para que el orquestador despache un lector bibliotecario especializado. El estado explícito de `source-index.json` es `missing | empty | ready | stale | invalid`; mera existencia del archivo no confirma contratos. Las fuentes externas vivas pueden incluir documentación oficial, changelogs, releases/issues, GitHub/npm advisories, OWASP/CVE/NVD, posts oficiales en X/Twitter, Reddit/comunidades técnicas y blogs/noticias de seguridad. Esas señales informan riesgos y recomendaciones, pero no pasan a contratos aprobados sin validación humana/orquestador. Para este seguimiento, Idu-pi recomienda un AgentLab bibliotecario audit-only: lee documentación/noticias/advisories/comunidades y mantiene informado al orquestador sin implementar ni modificar el repo. El flujo formal se crea con `idu_agentlab_request_create { source: "external-source-intelligence" }`: primero intenta usar recomendaciones locales de Source Library/digests (`sourceId`, `chunkIds`, motivos, confianza, limitaciones) sin leer documentos completos ni hacer web/live fetch automático; si faltan digests, lo declara como conocimiento faltante. El request queda en estado `requested`, lista fuentes permitidas (`official_docs`, `changelog`, `advisory`, `cve_nvd`, `github_advisory`, `npm_advisory`, `community_signal`) sólo como marco de clasificación, exige evidencia/confianza/frescura y fija `contractPromotionAllowed: false`; ninguna señal externa se convierte en contrato sin revisión explícita del orquestador/humano.

Después de aprobar el Plan Maestro, el loop preventivo recomendado para cualquier cambio no trivial es:

```text
idu_plan_snapshot
→ idu_supervisor_context_pack
→ idu_next_advisory_action
→ idu_task_package_create
→ subagente governance-review del orquestador
→ worker normal del orquestador
→ idu_postflight con actionId/taskPackageId
→ AgentLab audit-only si el orquestador decide ejecutarlo explícitamente
```

Las tools advisory nuevas no ejecutan cambios ni AgentLabs. Producen lineamientos, acciones candidatas y paquetes para subagentes normales. `idu_supervisor_context_pack` es el punto de inyección natural para el orquestador: combina visión humana del README, objetivo del Plan Maestro, contratos, riesgos, lecturas requeridas, guía para omitir ruido y gates de autonomía sin volcar documentos largos. Cada pack exitoso registra señales locales de calidad de contexto en `stateRoot/reports/context-quality-events.jsonl`: ratings de compacto/relevante/ruido/completo, uso de presupuesto de caracteres y omisiones agregadas por razón, sin prompts, texto crudo, docs, tokens, costo, porcentajes de contexto ni analytics remota. `idu_context_pruning_advisory` agrega señales read-only de deuda semántica/context pruning desde eventos de calidad, Source Library/digests, planes/specs y artefactos acumulados; devuelve sólo conteos, ids, rutas y metadata, no borra, no archiva fuentes, no refactoriza y no promueve/degrada contratos. El paso `governance-review` ocurre antes de codificar para evitar rework: valida Plan Maestro, flujos, contratos, criterios de aceptación, stop conditions y política AgentLab. AgentLabs siguen siendo audit-only y sólo corren mediante `idu_agentlab_review_run` o llamada explícita equivalente del orquestador. Las herramientas AgentLab registran eventos locales de efectividad en `stateRoot/reports/agentlab-effectiveness-events.jsonl`: cuentan requests, runs, status checks, outcomes, severidades, aprobación humana y completitud de evidencia sin prompts, texto crudo, env, headers, tokens, costo, porcentajes de contexto ni analytics remota.

Para proyectos con persistencia, el Plan Maestro debe expresar gobernanza de datos: stores detectados/canónicos, owner lógico, retención, backup/restore, sanitización/redacción, migración/rollback y ciclo de vida de artefactos SQLite/JSON/JSONL. Los flujos de ingesta, reporting y API deben apuntar a stores existentes; Idu-pi no inventa stores sin evidencia.


`idu_postflight` separa cambios funcionales de ruido operativo: ignora artefactos locales de subagentes, informa `ignoredFiles`, clasifica `observedChangeMode` y normaliza contratos observados (`data`, `security`, `frontend`, `agent`, `docs`, `tests`). Esto reduce falsos positivos en loops no-op/docs/stateRoot sin degradar blockers reales como `.env` o runtime DB/JSONL trackeado.

Herramientas mínimas:

| Tool | Propósito |
| --- | --- |
| `idu_project_status` | Lee si un proyecto está registrado y sus rutas de estado; no escribe archivos. |
| `idu_project_enroll` | Registra explícitamente un proyecto y crea estado aislado; no crea drafts ni activa guardrails. |
| `idu_project_reset_state` | Borra el contenido del `stateRoot` del proyecto registrado con `confirm=true`; no desregistra ni toca el repo real. |
| `idu_bootstrap_project` | Bootstrap explícito: enrola, crea estado y, con `allowCreateDrafts=true`, crea Project Core/Constitution/blueprint/flows draft. |
| `idu_start` | Entrada cómoda para proyectos registrados: activa guardrails y muestra estado; no enrola ni crea drafts. |
| `idu_status` | Estado de conexión, sesión, config/alignment y próximo paso. |
| `idu_activate` | Sólo activa guardrails automáticos sin enrolar, bootstrap, scan pesado ni AgentLabs. |
| `idu_deactivate` | Apaga guardrails automáticos. |
| `idu_prepare` | Ejecuta prepare seguro. |
| `idu_master_plan_status` | Lee estado/rutas del Plan Maestro sin regenerar. |
| `idu_master_plan_create` | Crea o regenera el Plan Maestro normativo en `stateRoot`, con docs declaradas vs realidad construida y flujos permanentes aparte. |
| `idu_master_plan_review` | Revisa el Plan Maestro actual/selector y devuelve JSON estructurado más markdown, incluyendo `revisionAntesDeZarpar`. |
| `idu_master_plan_approve` | Aprueba explícitamente el Plan Maestro seleccionado; actualiza artefactos de gobernanza en `stateRoot` sin aplicar flows ni tocar el repo real. |
| `idu_master_plan_reject` | Rechaza explícitamente el Plan Maestro seleccionado con motivo opcional; no borra drafts ni toca el repo real. |
| `idu_plan_snapshot` | Devuelve vista compacta del Plan aprobado: objetivo, contratos, flujos, riesgos, drift, blockers y AgentLabs recomendados. |
| `idu_next_advisory_action` | Propone una próxima acción candidata desde Plan/request; no ordena, no implementa y no ejecuta AgentLabs. |
| `idu_task_package_create` | Crea paquete para subagentes normales con brief obligatorio de governance-review previo al worker. |
| `idu_supervisor_context_pack` | Inyecta contexto supervisor compacto para orquestador/subagentes: visión humana, Plan Maestro, contratos, riesgos, lecturas, ruido a omitir y gates de autonomía; registra calidad de contexto local con cuentas/ratings, sin prompts/docs crudos ni tokens/costo/% contexto. |
| `idu_orchestrator_procedure` | Devuelve procedimiento asesor para crear/actualizar plan, implementar o revisar postflight sin reemplazar al orquestador. |
| `idu_task_context` | Devuelve contratos afectados, lecturas requeridas, labs sugeridos audit-only y guía para subagentes del orquestador. |
| `idu_preflight` | Evalúa riesgo/impacto de una solicitud humana y devuelve advisory compacto para el orquestador. |
| `idu_advisory` | Devuelve advisory seguro para el orquestador desde preflight. |
| `idu_postflight` | Lee cambios/gates y sugiere AgentLabs sin aplicar cambios; puede recibir `actionId`, `taskPackageId`, `expectedContracts`, `expectedFiles` y `expectedChangeMode` (`no-op`, `docs`, `tests`, `code`, `stateRoot`) para trazabilidad advisory. |
| `idu_supervisor_tick` | Tick supervisor seguro con flags explícitos. |
| `idu_context_pruning_advisory` | Reporta deuda semántica/context pruning read-only: context bloat, evidencia/digests stale, planes/specs viejos y ruido de artefactos; no borra, no archiva, no refactoriza ni promueve contratos. |
| `idu_task` | Interpreta intención humana y registra tarea estructurada. |
| `idu_queue_detail` | Devuelve cola estructurada con ids completos y guardStatus. |
| `idu_semantic_audit_status` | Lee stats/checkpoint/decisión de auditoría semántica. |
| `idu_source_status` | Lee Source Library en `stateRoot` y reporta `missing | empty | ready | stale | invalid`; no escribe ni promueve contratos. |
| `idu_source_add` | Copia/registra `.md`, `.txt` o `.pdf` local en `Doc/<project>/sources/local`; para PDFs intenta conversión best-effort desde texto embebido a Markdown, sin OCR/dependencias nuevas. |
| `idu_source_remove` | Remueve una fuente registrada y sus copias/snapshot en Source Library stateRoot; no cambia contratos ni repo real. |
| `idu_source_read` | Lee contenido acotado de fuente registrada; PDFs sin texto embebido quedan metadata-only. |
| `idu_source_extract` | Extrae/actualiza texto acotado para `.md/.txt`; PDFs usan sólo conversión embebida existente, sin OCR. |
| `idu_source_report` | Reporta metadata, hash, estado de extracción/conversión y limitaciones de una fuente. |
| `idu_source_research_report` | Busca señales en fuentes registradas/legibles con citas/evidencia/confianza; no consulta web ni promueve contratos. |
| `idu_source_digest` | Genera chunks/tomos, digest JSON e índice bibliotecario local para una fuente con texto real; si no puede leerla, devuelve acción requerida para lector bibliotecario especializado. Advisory-only. |
| `idu_source_digest_status` | Lee estado de digests e índice bibliotecario sin escribir. |
| `idu_source_chunk_read` | Lee un chunk/tomo específico bajo Source Library stateRoot. |
| `idu_source_recommend_for_task` | Recomienda fuentes/chunks para una tarea del orquestador; no implementa ni aprueba contratos. |
| `idu_source_required_actions` | Lista fuentes no leídas que obligan al orquestador a despachar un lector bibliotecario/document-reader. |
| `idu_source_skill_candidates_create` | Genera reporte JSON de candidatas de skill desde digests; reports-only, no instala skills, no escribe `.agents`/`.atl`, tokens/cost `no medido`. |
| `idu_source_skill_candidates_review` | Revisa un reporte de candidatas de skill y valida superficie advisory/reports-only. |
| `idu_source_refresh` | Recalcula hashes/estado de fuentes; no cambia contratos, Project Core, Constitution, flows, skills ni AgentLabs. |
| `idu_agentlab_request_create` | Crea solicitud formal AgentLab; no ejecuta labs automáticamente. `source` acepta `postflight`, `master-plan`, `skill-draft`, `external-source-intelligence` y `specialist-audit-plan`; devuelve `data.workloadEnvelope` advisory-only con carga/presupuesto estimados. Para `external-source-intelligence`, usa refs locales de Source Library/digests cuando existen y no hace web/live fetch. Para `specialist-audit-plan`, el orquestador pasa `specialties` explícitas y recibe `plan.specialtyWorkloadEnvelopes` más `explicitRunRequirement`; la ejecución sigue siendo sólo `idu_agentlab_review_run`. |
| `idu_agentlab_review_run` | Ejecuta revisión AgentLab explícita con sandbox/clone guard; devuelve `data.workloadEnvelope` con estado agregado (`completed`, `partial`, `timed_out`, `failed`, etc.). |
| `idu_agentlab_review_status` | Lee estado de review AgentLab y expone `data.workloadEnvelope`; estados `stale`/fallidos siguen bloqueando en el decision envelope. Las tres tools AgentLab registran métricas locales de efectividad en stateRoot sin prompts/texto crudo/tokens/costo/contexto. |

## Seguridad

El MCP adapter:

- no levanta Telegram;
- no depende de Telegram;
- no hace commit ni push;
- no aplica cambios críticos automáticamente;
- no modifica Project Core confirmado ni Constitution;
- no modifica skills reales;
- no borra memoria;
- no devuelve secretos de errores/logs sin redacción básica;
- no ejecuta AgentLabs salvo la herramienta explícita `idu_agentlab_review_run`;
- `workloadEnvelope` es metadata advisory-only: no permite auto-run, escritura de repo real ni promoción de contratos;
- no escribe registry desde `idu_status`, `idu_activate` ni `idu_start`;
- no crea `config/project-*.json` salvo `idu_bootstrap_project` con `allowCreateDrafts=true`.

Telegram es un adapter, no el núcleo. El núcleo sigue siendo Idu-pi Core.

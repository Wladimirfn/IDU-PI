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

Las herramientas que evalúan intención o supervisor (`idu_preflight`, `idu_advisory`, `idu_supervisor_tick`, `idu_task_context`) agregan `data.alignmentAdvisory`: una señal compacta para el orquestador con `audience`, `severity`, `alignment`, `recommendation`, `confidence`, `requiredReads`, `suggestedAgentLabs`, `orchestratorGuidance` y `evidenceRefs`. Esto evita pasarle al usuario reportes largos cuando el destinatario real es el orquestador.

El modo de autoridad MCP por defecto es `IDU_MCP_AUTHORITY_MODE=advisory`: Idu-pi informa, audita y recomienda; el orquestador revalida, decide, ejecuta y comunica. El valor `strict` queda reservado para despliegues futuros con hazards críticos explícitos y hoy sólo se expone como dato de configuración, no como permiso para imponer decisiones.

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
| `idu_orchestrator_procedure` | Devuelve procedimiento asesor para crear/actualizar plan, implementar o revisar postflight sin reemplazar al orquestador. |
| `idu_task_context` | Devuelve contratos afectados, lecturas requeridas, labs sugeridos audit-only y guía para subagentes del orquestador. |
| `idu_preflight` | Evalúa riesgo/impacto de una solicitud humana y devuelve advisory compacto para el orquestador. |
| `idu_advisory` | Devuelve advisory seguro para el orquestador desde preflight. |
| `idu_postflight` | Lee cambios/gates y sugiere AgentLabs sin aplicar cambios. |
| `idu_supervisor_tick` | Tick supervisor seguro con flags explícitos. |
| `idu_task` | Interpreta intención humana y registra tarea estructurada. |
| `idu_queue_detail` | Devuelve cola estructurada con ids completos y guardStatus. |
| `idu_semantic_audit_status` | Lee stats/checkpoint/decisión de auditoría semántica. |
| `idu_agentlab_request_create` | Crea solicitud formal AgentLab; no ejecuta labs automáticamente. |
| `idu_agentlab_review_run` | Ejecuta revisión AgentLab explícita con sandbox/clone guard. |
| `idu_agentlab_review_status` | Lee estado de review AgentLab. |

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
- no escribe registry desde `idu_status`, `idu_activate` ni `idu_start`;
- no crea `config/project-*.json` salvo `idu_bootstrap_project` con `allowCreateDrafts=true`.

Telegram es un adapter, no el núcleo. El núcleo sigue siendo Idu-pi Core.

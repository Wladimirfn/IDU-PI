# Living Loop Triggers

El Living Loop Triggers es el primer slice del plan mayor de living loop para Idu-pi. Permite que el supervisor inyecte envelopes al orchestrator cuando se cumplen condiciones, en lugar de esperar a que el orchestrator pregunte.

## Activación

El trigger engine es **opt-in**. Para activarlo:

```bash
IDU_PI_TRIGGER_ENGINE=1
```

Sin esa env var, `runTriggerEngineTick` no se invoca desde el bridge runtime (CLI o Telegram). El bridge invoca el engine post-alert-tick cuando el flag está activo.

## Bus de eventos

Path: `<stateRoot>/events.jsonl`

Append-only JSONL. Cada línea es un evento:

```json
{
  "ts": "2026-06-08T10:00:00.000Z",
  "kind": "task_stuck",
  "projectId": "idu-pi",
  "payload": { "taskId": "t-1", "ageMs": 3700000, "domain": "stale_work" },
  "sourceRef": "autonomous-alert-engine",
  "evidenceRefs": []
}
```

### Kinds soportados

- `task_stuck` — emitido por alert engine cuando detecta tarea abierta con ageMs >= 1h.
- `task_created` — tarea nueva creada.
- `intention_registered` — preflight con risk != "low".
- `intention_decision_pending` — intención esperando decisión humana.
- `intention_blocked` — intención bloqueada por contrato.
- `objective_reminder_due` — recordatorio del objetivo.
- `bibliotecario_research_requested` — investigación bibliotecario pedida.
- `agentlab_finding_ready` — resultado de AgentLab listo.
- `queue_proposal_added` — propuesta añadida a la queue.
- `master_plan_drift` — drift del master plan detectado.

## Store de inyecciones

Path: `<stateRoot>/injections.jsonl`

Cada línea es una inyección:

```json
{
  "ts": "2026-06-08T10:00:00.000Z",
  "triggerId": "stuck_tasks_1h",
  "decisionEnvelope": {
    "severity": "warning",
    "summary": "5 tareas abiertas más de 1h",
    "options": ["review_each", "close_stale", "ignore"],
    "evidenceRefs": ["events.jsonl:..."],
    "orchestratorDecisionRequired": true
  },
  "injectionId": "ab12cd34ef567890",
  "acked": false
}
```

## Disparadores iniciales

| triggerId | severity | decisionRequired | kinds |
| --- | --- | --- | --- |
| `stuck_tasks_1h` | warning | true | task_stuck, task_created, intention_registered |
| `objective_reminder_hourly` | info | false | master_plan_drift |
| `intention_decision_pending` | warning | true | intention_decision_pending |

## Tools MCP

### `idu_pending_injections`

Lee inyecciones pendientes. Opcionalmente las marca como acked.

Input:
- `projectPath?: string` — ruta opcional del proyecto.
- `ack?: boolean` (default `true`) — si true, marca las devueltas como acked.

Output: `data.birth.pendingInjections` (array) y `data.birth.ackedCount` (número).

### `idu_subscribe_triggers`

Read-only. Describe los disparadores disponibles, su contrato, y los kinds que monitorean.

Output: `data.birth.triggers` (array de disparadores con id, descripción, kinds, signature, contract).

## CLI

```bash
corepack pnpm cli -- idu-pending-injections
corepack pnpm cli -- idu-subscribe-triggers
```

## Idempotencia

El trigger engine computa `injectionId = sha1({triggerId}|{fromTs}|{toTs}|{signature})`. Antes de escribir, verifica que el `injectionId` no exista ya en `injections.jsonl`. Si existe, skip. Esto garantiza que dos ticks consecutivos sobre la misma ventana no duplican inyecciones.

## Flow end-to-end

1. autonomous-alert-engine tick genera reporte con `stale_work` y ageMs >= 1h.
2. bridge wireo (en `runCliAutonomousAlertTick`) llama `emitStuckTaskEventsFromAlertReport` (vía `runTriggerEngineTickOptIn` después, pero el bridge actual sólo tiene el trigger engine post-tick — los bridges de emisión de eventos son slices siguientes).
3. trigger engine matchea `stuck_tasks_1h` con esos eventos.
4. trigger engine invoca `appendInjection`.
5. orchestrator hace pull de `idu_pending_injections`, recibe el envelope.
6. orchestrator decide qué hacer. Vuelve a llamar con `ack: true` cuando procesó.

## Constraints y Non-goals

- **No** se monta `setInterval`. La invocación la hace el bridge runtime a través de su propio scheduler.
- **No** se hace push. El push lo decide el orchestrator.
- **No** se crea DB nueva. Todo es JSONL en stateRoot.
- **No** se cambia el constitution. El trigger engine es bounded interval + opt-in.

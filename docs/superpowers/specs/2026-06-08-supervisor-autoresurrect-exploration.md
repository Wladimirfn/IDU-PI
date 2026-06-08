# sdd-explore — Supervisor Autoresurrect

**Fecha:** 2026-06-08
**Modo:** interactive
**Artifact store:** OpenSpec canónico (no se abrió change en esta fase)
**Proyecto:** Idu-pi (`pi-telegram-bridge`)

## Resumen ejecutivo

El supervisor automático de Idu-pi **no tiene un scheduler autónomo en runtime**. El bridge runtime sólo dispara el `runIduSupervisorLoop` (y por extensión `runAutomaticov1AdvisoryCycle`) **on-demand**, ya sea desde el handler de Telegram (`/idu_supervisor_tick`) o desde CLI (`idu-supervisor-tick`, `idu-automaticov1 cycle`).

Esto explica el síntoma reportado: **"última llamada Idu-pi: hace 19h"** — no es un bug del código del supervisor, es que el bridge no está vivo, o está vivo pero nadie lo está disparando.

Hay tres caminos viables para "resucitar" el supervisor y dejarlo andando solo, todos con trade-offs diferentes.

## Mapa de archivos relevantes

### Entry points del bridge

- **`scripts/start-bridge.ps1`** — Lanza `node dist/src/index.js` (no `cli.js`). Tiene Scheduled Task asociado vía `scripts/install-scheduled-task.ps1` (trigger `AtLogOn`, restart cada 1 min si muere).
- **`scripts/install-scheduled-task.ps1`** — Registra la Windows Task `Idu-pi Telegram Bridge`. Trigger: `AtLogOn`. Restart: 999 veces cada 1 min.
- **`scripts/scheduled-task-status.ps1`** — Verifica el estado del task.
- **`scripts/bridge-control.ps1`** — start/stop del bridge.
- **`scripts/stop-bridge.ps1`**, **`scripts/uninstall-scheduled-task.ps1`** — Apagado y desinstalación.

### Loops de supervisor (en runtime, no se autoejecutan)

- **`src/idu-supervisor-loop.ts`** — `runIduSupervisorLoop` (entry function del ciclo).
- **`src/idu-supervisor-cron.ts`** — `buildSupervisorCronPlan` (planificación advisory, no ejecución).
- **`src/automaticov1-cycle.ts`** — `runAutomaticov1AdvisoryCycle` (orquesta engines: bibliotecario, alert scheduler, postflight).
- **`src/autonomous-alert-scheduler.ts`** — `runAutonomousAlertScheduledTick` (toma decisiones, pero necesita que alguien lo llame).
- **`src/autonomous-alert-cron.ts`** — Verifica que el cron corra.

### Invocation sites (on-demand)

- **`src/index.ts:1848`** — Telegram `/idu_supervisor_tick` invoca `runIduSupervisorLoop({ trigger: "manual", ... })`.
- **`src/cli.ts`** — CLI invoca `runIduSupervisorLoop` cuando el usuario corre `idu-supervisor-tick` o `idu-automaticov1 cycle`.
- **`src/mcp-server.ts`** — MCP tool `idu_supervisor_tick` invoca al runtime directamente.

### Scheduler / cron check

```bash
grep -rn "setInterval\|setTimeout" src/ 2>/dev/null | grep -v "test\|node_modules"
```

Resultados (excluyendo timeouts de promesas):
- `src/agentlab-review-runner.ts:273` — `setTimeout` para `LAB_TIMEOUT` (no es scheduler).
- `src/lab.ts:267` — `setTimeout` para await de polls (no es scheduler).
- `src/pi-rpc.ts:158` — `setTimeout` para retry de RPC.
- `src/cli.ts:4076/4093` — Inyección de `setInterval` como dependency (nadie la usa para supervisor).

**No hay un `setInterval(...)` que ejecute `runIduSupervisorLoop` o `runAutomaticov1AdvisoryCycle` cada N minutos.**

## Diagnóstico de causa raíz

El supervisor **no es un daemon**: es un orquestador manual/on-demand. Esto es deliberado en la arquitectura (ver `constitution.forbiddenPractices`: "Running automaticov1 as an unbounded daemon"). El sistema tiene permitido planear, ejecutar on-demand, y registrar, pero **no auto-tickear indefinidamente**.

El síntoma "19h sin llamadas" se da cuando:
1. El bridge Node no está vivo (Scheduled Task falló, o el proceso murió y el restart no se disparó).
2. El bridge está vivo pero Telegram no recibe mensajes (sin usuario activo).
3. Nadie corre el CLI periódicamente.

Confirmación con `Get-CimInstance Win32_Process`:
- Hoy **no hay un proceso `node dist/src/index.js` corriendo**. Sólo hay un `node dist/src/cli.js` (probablemente de pruebas manuales).
- `bridge.log` muestra que el último arranque fue el 2026-05-27, con `Node exited with code -1` (crash).

## Opciones de implementación

### Opción A — Tick desde el bridge Node (`setInterval` interno)

**Qué:** Agregar un `setInterval(() => runIduSupervisorLoop({ trigger: "cron" }), N*60_000)` dentro de `src/index.ts` cuando el bridge arranca, sólo si un flag de config (e.g. `IDU_PI_SUPERVISOR_AUTOTICK=1`) lo permite.

**Pros:**
- Testeable in-process.
- Integrado al lifecycle del bridge (se detiene con el bridge).
- Logging consistente con el resto del bridge.

**Contras:**
- Viola el principio constitutional de "no unbounded daemon" si se deja siempre activo.
- Requiere un flag de opt-in explícito.
- Dificulta auditar quién disparó el tick (mezcla user-triggered con auto-triggered en los mismos logs).

**Cambio mínimo:**
- `src/index.ts` — añadir un opt-in guard + `setInterval` al final del bootstrap.
- `src/idu-supervisor-loop.ts` — distinguir `trigger: "cron"` en el log de auditoría.
- Tests para verificar que el opt-in funciona y que el off no programa nada.
- Documentación en README o constitution.

### Opción B — Script externo vía Windows Task Scheduler

**Qué:** Crear `scripts/idu-supervisor-tick.ps1` que invoca `node dist/src/cli.js -- idu-supervisor-tick` (o `-- idu-automaticov1 cycle`), y registrarlo vía una nueva task de Windows que se dispare cada N minutos.

**Pros:**
- No toca código del bridge.
- El bridge puede estar vivo o muerto, el tick corre igual.
- Cumple con el constitution (es un trigger explícito, no un daemon in-process).
- Audit-friendly: el Task Scheduler tiene su propio log de ejecuciones.

**Contras:**
- Requiere instalación manual (o un script `install-supervisor-cron.ps1` análogo al de scheduled task del bridge).
- Si el proceso Node del tick queda colgado, no se reinicia solo.
- En Windows, los Task Schedulers a veces no se ejecutan si la máquina está en sleep/hibernación.

**Cambio mínimo:**
- `scripts/idu-supervisor-tick.ps1` (nuevo, ~10 líneas).
- `scripts/install-supervisor-cron.ps1` (nuevo, similar a `install-scheduled-task.ps1`).
- Documentación en README: cómo instalar/desinstalar.
- `scripts/scheduled-task-status.ps1` extendido para listar también la nueva task.

### Opción C — Usar el `autonomous-alert-scheduler` que ya existe

**Qué:** El `src/autonomous-alert-scheduler.ts` ya tiene `runAutonomousAlertScheduledTick` y un state file. Investigar por qué no se está ejecutando periódicamente y arreglarlo.

**Pros:**
- Reusa infraestructura existente.
- State persistence (lease, createdTaskIds) ya está.

**Contras:**
- El alert scheduler **también** se llama on-demand (no es un daemon). Solo cambia el nombre del entry point.
- El `automaticov1_cycle` es un superset: corre el alert scheduler + bibliotecario + supervisor + postflight. Sólo el alert scheduler es un subconjunto.
- Si el problema es que el código no se autoejecuta, agregar el alert scheduler no resuelve nada.

**Veredicto:** Esta opción no resuelve el problema. Se descarta.

### Opción D — Cron interno vía Pi o extensión

**Qué:** Aprovechar la extensión Pi `.pi/extensions/idu-pi-commands.ts` que ya hace `refreshPiModelCatalogSnapshot` antes de cada slash command. Agregar un tick opcional al inicio.

**Pros:**
- Reusa la extensión que ya existe.

**Contras:**
- La extensión sólo corre cuando un slash command del Pi CLI se ejecuta, o sea on-demand también.
- No resuelve el caso "bridge no está vivo" ni "Telegram no recibe mensajes".

**Veredicto:** No resuelve el problema raíz. Se descarta.

## Recomendación (sin implementar)

**Opción B (script externo + Task Scheduler)**, por estas razones:

1. **Alineada con el constitution**: no convierte Idu-pi en un daemon in-process. El trigger es explícito y externo.
2. **No toca código crítico**: el bridge sigue siendo on-demand. El tick es un proceso separado.
3. **Audit-friendly**: el Task Scheduler de Windows deja un log de cada ejecución (éxito/fallo), separable del log del bridge.
4. **Reproducible**: el script es corto y testeable (puede invocarse a mano para verificar).
5. **Independiente del bridge**: si el bridge se cae, el tick sigue corriendo y al menos refresca el supervisor context pack y la última llamada Idu-pi.

Como plan B, si la Opción B resulta operacionalmente ruidosa (muchos logs, ejecuciones fallidas), se puede combinar con la Opción A: usar la Opción B como mecanismo primario, y dejar la Opción A como fallback para sistemas sin Task Scheduler (ej. WSL, Linux).

## Riesgos y dependencias

- **Riesgo:** El tick externo puede ejecutarse mientras el bridge está vivo y pisar estado si no hay lock. **Mitigación:** el stateRoot ya está aislado y `autonomous-alert-scheduler` usa un `ownerId` por `process.pid`. Verificar que el tick externo no rompa el lock del bridge.
- **Riesgo:** El Scheduled Task puede no ejecutarse en máquinas con sleep/hibernación. **Mitigación:** documentar y sugerir el flag "Wake the computer to run this task" en el instalador.
- **Dependencia:** Requiere que la Windows Task Scheduler esté habilitada y que la sesión del usuario esté activa (logon type `Interactive` en el instalador, igual que el bridge).
- **Dependencia:** Requiere que `dist/src/cli.js` esté construido (`corepack pnpm build`).

## Próximo paso si aprobás la Opción B

Abrir un SDD change con nombre propuesto:

- **Nombre tentativo:** `supervisor-autoresurrect` (o `supervisor-cron-external`).
- **Scope acotado:**
  - Crear `scripts/idu-supervisor-tick.ps1`.
  - Crear `scripts/install-supervisor-cron.ps1` (Task Scheduler cada 15 minutos).
  - Crear `scripts/uninstall-supervisor-cron.ps1` (para reversibilidad).
  - Tests para los scripts (puede ser un test de Node que valide que `cli.js -- idu-supervisor-tick` corre sin error y devuelve un envelope estructurado).
  - Documentación breve en `README.md` o `docs/installer.md`.

- **Review workload forecast:** ~80-120 líneas. **Bajo presupuesto de 400.** Single PR viable.

- **Slices:**
  1. `scripts/idu-supervisor-tick.ps1` + tests de invocación.
  2. `install-supervisor-cron.ps1` + `uninstall-supervisor-cron.ps1`.
  3. Documentación.

- **Strict TDD:** test primero (Node invoca el script y verifica código de salida + JSON), después implementar.

## Estado SDD

- `openspec/changes/lab-triage-engram/` sigue en `apply-closing` con 1 tarea pendiente (gate de verify).
- **No se abrió change** en este sdd-explore. Si vos aprobás la Opción B, abrimos `sdd-propose` con nombre `supervisor-autoresurrect`.

## skill_resolution

- `paths-injected` (el orchestrator me pasó las skills writing-plans y pi-subagents en el prompt).
- No usé fallback registry ni path.

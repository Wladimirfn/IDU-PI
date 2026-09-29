# Arquitectura de IDU Cross-CLI

`idu-cross-cli` es un router universal de terminales y arnés de calidad. Permite que un
orquestador padre (**Claude Code**, **Pi**, **OpenCode**, **Antigravity**) delegue tareas a
procesos de terminal reales (**Claude CLI**, **OpenCode CLI**, **Codex CLI**, **Pi CLI**,
**Kimi**, **Qwen**, **agy**, **cmdc**) mediante perfiles de costo/modelo, bajo la
**ONE ORCHESTRATOR RULE**.

> **Nota de alcance.** Este documento describe el sistema que existe hoy. El bot de Telegram,
> el módulo AgentLab, el Plan Maestro, el supervisor loop y el sistema de semantic memory que
> aparecen en el historial del repositorio fueron retirados; su código quedó accesible en el
> tag `legacy-archive-pre-purge` y ya no ocupa el árbol de trabajo. Sus últimos rastros —los
> perfiles de `config/profiles/` y los scripts del cron `supervisor-tick`— se eliminaron con
> la purga de vestigios. No reintroducirlos desde el tag.

## Vista general

```text
Orquestador padre (Claude Code / Pi / OpenCode / Antigravity)
        │
        │  MCP (stdio, 13 herramientas)   ó   CLI directa
        ▼
┌───────────────────────────────────────────────────────────────┐
│  process-manager.ts — CrossCliProcessManager (singleton)       │
│  · validación de perfil y guardas de gobernanza                 │
│  · tríada de sesiones  · locks · árbol de sesiones             │
└───────────────────────────────────────────────────────────────┘
        │  escribe spec.json, spawpea daemon desligado
        ▼
┌───────────────────────────────────────────────────────────────┐
│  runner.ts — daemon watchdog (proceso Node independiente)      │
│  · spawpea el worker real (claude / pi / codex / …)            │
│  · watchdog adaptativo: hard cap + inactividad + gracia        │
│  · escribe logs/ y sessions/, actualiza el árbol de sesiones   │
└───────────────────────────────────────────────────────────────┘
        │
        ▼
   Worker CLI real  ──stdout/stderr──▶  logs/<runId>.log
```

El orquestador **no** espera al worker: escribe un spec, lanza un daemon desligado y sondea el
estado en disco. Si el orquestador muere, el worker sigue vivo.

## Capas

| Capa | Módulo | Responsabilidad |
| --- | --- | --- |
| Transporte MCP | `mcp-server.ts` | Servidor stdio, 13 herramientas, JSON-RPC por líneas, validación estricta de esquema. |
| Transporte CLI | `cli.ts` | `status`, `result`, `wait`, `capabilities`, `preflight`, `sessions`, `delegate`. |
| Orquestación | `process-manager.ts` | `CrossCliProcessManager`: guardas, sesiones, locks, árbol, construcción del spec. |
| Ejecución | `runner.ts` | Daemon que posee el proceso hijo, el watchdog y el cierre del registro. |
| Construcción de argv | `cmdline.ts` | Un `case` por harness + unwrapper de wrappers `.cmd`/`.bat` de Windows. |
| Calidad | `quality.ts` | `runPreflight` (riesgo) y `runPostflight` (blast radius). |
| Configuración | `config.ts` | Perfiles por defecto, config, rutas de `~/.idu`. |
| Ledger | `decision-ledger.ts` | Registro durable de decisiones y auditorías de postflight. |

## Ciclo de una delegación

1. **Guardas.** Se validan, en orden: ONE ORCHESTRATOR RULE (no recursión), existencia del
   perfil, y el guard de Work Unit SDD (ver abajo).
2. **Sesión.** Se resuelve la tríada: identificador nuevo, `resume` de una sesión existente, o
   `fork` que ramifica desde un padre.
3. **Lock.** Se toma un lock atómico de sesión; una sesión viva no puede correr en paralelo.
4. **Spec.** Se escribe `~/.idu/runtime/<runId>.spec.json` y el registro inicial en
   `~/.idu/sessions/<runId>.json`.
5. **Daemon.** Se spawpea `runner.js` con `detached: true` + `unref()`.
6. **Watchdog.** El daemon sondea el tamaño del log cada 3 s y aplica los límites (§ Watchdog).
7. **Cierre.** El daemon escribe el resumen limpio, actualiza `sessions/tree.json`, borra lock,
   pid y spec, y termina.

Un `runId` tiene la forma `IDU-<YYYYMMDDHHMMSS>-<perfil>-<rand>`.

## Watchdog adaptativo

El daemon no confía en un `setTimeout` ciego: usa el crecimiento del archivo de log como proxy de
actividad. Tres límites, evaluados en cada tick de 3 s:

| Límite | Condición | Semántica |
| --- | --- | --- |
| `hardCapMs` | tiempo total desde el arranque | Techo absoluto. `0` lo desactiva. |
| `idleTimeoutMs` | inactividad **después** del primer byte | Solo aplica si el perfil tiene `streams: true`. |
| `startupGraceMs` | inactividad **antes** del primer byte | Da margen de arranque (por defecto `max(idle, 120s)`). |
| `timeoutMs` | tiempo total | Solo para perfiles **sin** `streams`. |

> **Trampa conocida.** Un perfil con `streams: false` nunca recibe corte por inactividad,
> aunque declare `idleTimeoutMs`. Solo lo detiene `timeoutMs` o `hardCapMs`. Si querés que una
> tarea larga de Pi se proteja contra silencios, el perfil necesita `streams: true`.

Al vencer un límite se mata el árbol de procesos y se esperan 10 s antes de cerrar el registro
como `timeout`, preservando la salida parcial (`partial: true`) y el `resumeHint`.

## Guardas de gobernanza

- **ONE ORCHESTRATOR RULE.** El worker se lanza con `IDU_WORKER=true` y
  `IDU_ALLOW_DELEGATION=false`. Un worker que intente delegar hacia adentro recibe un error.
- **Guard de Work Unit SDD.** Si el perfil tiene `permissions: "workspace"` y hay un intento SDD
  activo en `openspec/changes` (o el prompt menciona `sdd-apply` / `WU…`), la delegación se
  bloquea. La implementación primaria la hace el orquestador activo; los workers externos son
  consultivos.
- **Permisos fail-closed.** `buildWorkerArgs` solo bypasea sandbox con el valor exacto
  `permissions === "workspace"`. Un valor mal escrito no bypasea.

## Sesiones y concurrencia

- **Tríada universal:** identificador nuevo, `resume` de sesión existente, `fork` desde un padre.
  Cada CLI lo expresa con flags distintos (`--session-id`/`--resume`/`--fork-session`,
  `--session`/`--fork`, `--conversation`, …); `cmdline.ts` traduce.
- **Alias a UUID:** para Claude, un alias no-UUID se mapea a un UUIDv4 determinista
  (`aliasToUuid`), de modo que la misma conversación siempre resuelve al mismo identificador.
- **Lock atómico:** `openSync(path, "wx")` sobre
  `~/.idu/locks/sess_<hash-cwd8>_<sessionId>.lock`. El PID se valida antes de robar un lock; en
  Windows, `EPERM` significa proceso **vivo** con otra elevación y el lock nunca se roba. Un lock
  con PID muerto se reclama automáticamente, y uno corrupto se elimina y se reintenta.
- **Árbol de sesiones:** `~/.idu/sessions/tree.json`, escrito de forma atómica
  (tmp + `rename`), con `turnCount` y lista de runs por sesión.

## Estado en disco (`~/.idu`)

```text
config.json          configuración de CLIs y de la ONE ORCHESTRATOR RULE
profiles.json        perfiles del usuario (mergean sobre los del proyecto)
runtime/             <runId>.spec.json, .pid, .runner.pid  (efímeros)
sessions/            <runId>.json (registro) + tree.json
locks/               sess_*.lock
logs/                <runId>.log  (stdout+stderr crudo del worker)
decision_ledger.json decisiones y auditorías de postflight
```

## Recoverencia de procesos muertos

`getStatus()` detecta runs cuyo daemon y worker ya no existen. Si el log contiene la marca
`=== PROCESS CLOSED WITH CODE n ===`, reconstruye el código de salida y el estado desde el
log; si no, marca el run como `failed`. Esto evita que un run huérfano quede eternamente
`running`.

## Extinción

Para agregar un harness nuevo basta con: una entrada en `DEFAULT_CONFIG.clis`, un `case` en
`buildWorkerArgs` (más el parseo de `nativeSessionId` en `runner.ts` si expone sesiones
nativas), y opcionalmente un perfil en `DEFAULT_PROFILES`. El modelo es un **pass-through
opaco**: el harness no valida ni normaliza el nombre del modelo, lo que permite usar cualquier
identificador que el CLI subyacente acepte.

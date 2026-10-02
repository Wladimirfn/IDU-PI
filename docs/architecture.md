# Arquitectura de IDU Cross-CLI

`idu-cross-cli` es un router universal de terminales y arnés de calidad. Permite que un
orquestador padre (**Claude Code**, **Pi**, **OpenCode**, **Antigravity**, **minimax Code**)
delegue tareas a procesos de terminal reales (**Claude CLI**, **OpenCode CLI**, **Codex CLI**,
**Pi CLI**, **minimax Code**, **Kimi**, **Qwen**, **agy**, **cmdc**) mediante perfiles de
costo/modelo, bajo la **ONE ORCHESTRATOR RULE**.

> **Nota de alcance.** Este documento describe el sistema que existe hoy. El bot de Telegram,
> el módulo AgentLab, el Plan Maestro, el supervisor loop y el sistema de semantic memory que
> aparecen en el historial del repositorio fueron retirados; su código quedó accesible en el
> tag `legacy-archive-pre-purge` y ya no ocupa el árbol de trabajo. Sus últimos rastros —los
> perfiles de `config/profiles/` y los scripts del cron `supervisor-tick`— se eliminaron con
> la purga de vestigios. No reintroducirlos desde el tag.

## Vista general

```text
Orquestador padre (Claude Code / Pi / OpenCode / Antigravity / minimax Code)
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

- **ONE ORCHESTRATOR RULE (convención, no frontera).** El worker se lanza con `IDU_WORKER=true` y
  la guarda dispara solo con esa identidad. **No es *fail-closed*.** `IDU_WORKER` es una variable de
  entorno que controla el propio worker: puede borrarla, ponerla en `"false"` o no propagarla, y la
  guarda no lo distingue. Medido el 2026-10-01 contra el binario: `IDU_WORKER=false` y la variable
  ausente pasan el control y spawnean un worker anidado sin incidente.
  - **Lo que la guarda compra.** Un worker que no sabe que heredó el marcador no entra en bucle por
    accidente, y el rechazo queda en el log del run donde un post-mortem lo encuentra.
  - **Lo que no compra.** La misma señal decide el filtro del servidor MCP (`isWorkerProcess()`), así
    que ambas superficies descansan sobre un único contrato cooperativo en vez de dos defensas.
  - **Configuración.** `oneOrchestratorRule` está **retirado**: ya no se lee ni se mergea. Era un
    interruptor en `~/.idu/config.json`, archivo que todo worker puede escribir, y una sola edición
    apagaba la regla de forma global. El warning que aparece al cargarlo dice que es inerte.
  - **Alcance.** Cubre la vía idu-pi. **No** cubre que un worker invoque un harness directamente
    (`claude -p ...`), ni que escriba `~/.idu/profiles.json` para inyectar un perfil con `command` y
    `permissions` arbitrarios.
  - Cerrar esto de verdad exige quitarle autoridad al worker, no afinar el predicado. Ver
    [SECURITY.md](../SECURITY.md) para la lista medida de vías de evasión y para las dos formas que
    sí PONdrían un techo (supervisor con IPC autenticado, o usuario de servicio con ACL).
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
- **Afinidad de harness:** una sesión pertenece al harness que la creó. Reanudar **sin** `--profile`
  hereda el perfil de la sesión en vez de caer al default global (`fast`/pi), y reanudar con un
  `--profile` explícito de **otro** harness se rechaza antes del spawn
  (`checkSessionHarnessAffinity`). Sin esa guarda, un CLI ajeno no puede leer una transcripción que
  nunca escribió: el `nativeSessionId` se pierde en silencio y el run degrada a conversación nueva
  mientras se imputa a la sesión original. `--force` es la salida deliberada, y avisa por stderr.
- **Turnos transaccionales:** `turnCount` y `nativeSessionId` solo avanzan si el subproceso terminó
  bien (`shouldCountTurn`: `exitCode === 0 && status !== "timeout"`). Un run fallido o expirado se
  registra igual en `runs` para auditoría, pero no cuenta como turno conversacional ni ata la sesión
  a un id nativo que el CLI nunca aceptó.
- **Alias a UUID:** para Claude, un alias no-UUID se mapea a un UUIDv4 determinista
  (`aliasToUuid`), de modo que la misma conversación siempre resuelve al mismo identificador.
- **Lock atómico:** `openSync(path, "wx")` sobre
  `~/.idu/locks/sess_<hash-cwd8>_<sessionId>.lock`. El PID se valida antes de robar un lock; en
  Windows, `EPERM` significa proceso **vivo** con otra elevación y el lock nunca se roba. Un lock
  con PID muerto se reclama automáticamente, y uno corrupto se elimina y se reintenta.
- **Árbol de sesiones:** `~/.idu/sessions/tree.json`, escrito de forma atómica
  (tmp + `rename`), con `turnCount` y lista de runs por sesión.

## Cuota de las cuentas

idu-pi no guarda ninguna credencial. Cada fuente toma la sesion que ya existe
en la maquina, la usa para **una** consulta y la descarta: nunca se escribe, nunca
se registra, y ningun snapshot la transporta. Un test planta un secreto en el
payload y comprueba que no aparece en la salida.

No se raspa ningun archivo de estado: se le pregunta a la cuenta. Como se le
pregunta depende del CLI, y la diferencia importa porque tiene costo. Claude y
agy lo responden **ejecutando su propio `/usage`**, que gasta una llamada de
modelo. Codex y cmdc lo responden por **HTTP contra el endpoint del proveedor**,
con el token de su auth store, y eso no cuesta nada.
Medido el 2026-10-01 contra las cuatro cuentas de esta maquina:

| Fuente | Como responde | Nota |
| --- | --- | --- |
| `claude` | `claude -p "/usage"` | prosa; la ventana semanal imprime `8pm` **sin minutos** |
| `agy` | `agy -p "/usage"` | TSV; **dos medidores** (Gemini vs Claude/GPT) en un mismo binario |
| `cmdc` | `https://api.commandcode.ai/alpha/billing/credits` | `used/cap`; endpoint descubierto leyendo su statusline |
| `codex` | `https://chatgpt.com/backend-api/wham/usage` | `plan_type`, ventanas y **disponibilidad por modelo** |

Corroboracion independiente: el plugin `opencode-quota` de un tercero reporta
`[OpenAI] (Plus) 5h 97% left, Weekly 21% left`, que coincide exactamente con lo
que el adaptador de codex lee de la misma cuenta.

### Medidor y ventana son cosas distintas

Un `QuotaSnapshot` tiene `meters`, y cada medidor tiene `windows`. No es
decorativo: antigravity reporta "Gemini Models" y "Claude and GPT models" como
dos medidores distintos, y **ambos tienen una ventana de 5h**. Aplanarlos en claves
tipo `"Gemini Models:5h"` hace que `windows["5h"]` de `undefined` para ese
harness y entierra el eje que el llamador necesita: que bolsa se esta vaciando.
Ademas se conserva la disponibilidad **por modelo** que solo codex reporta, que
es mas accionable que un porcentaje.

### Reglas que el modulo sostiene y los tests fijan

1. **Todo se normaliza a `remaining`.** Claude reporta *used* y agy *remaining*
   para el mismo estado. Hay un test que cruza un payload `used` contra uno
   `remaining` y exige que coincidan. El plugin `opencode-quota` elige lo
   mismo (`"percentDisplayMode": "remaining"`).
2. **`unknown` con motivo, nunca `0`.** Un `0` que significa "agotado" y uno
   que significa "no medido" se ven iguales y llevan a decisiones opuestas. Si
   una ventana no trae porcentaje, sale `?`; si **ninguna** lo trae, la fuente
   entera es `unknown` con su motivo. Todo CLI de la config aparece, tenga o no
   sonda: la ausencia es ambigua, la respuesta desconocida no.
3. **Unidades distintas por proveedor.** codex entrega el reset en epoch
   **segundos** y cmdc en **milisegundos**. Un rango de fechas saneado evita que
   un `0` se vuelva 1970 o que un `1e300` lance un RangeError que tumba la
   fuente entera.
4. **Ningun mensaje de excepcion se interpola en un snapshot.** `JSON.parse`
   cita el texto crudo alrededor del fallo, y en `auth.json` ese texto es la key.
   Los motivos son cadenas fijas.

### Coste y cache

La sonda **nunca** es automatica y esta cacheada 10 minutos en
`~/.idu/runtime/quota-cache.json`, porque dos de las cuatro fuentes corren un
modelo y una lectura en frio tarda unos 11 segundos. `getCapabilities()` la omite
salvo que se pida, `delegate()` no la dispara nunca, y `--fresh` (CLI) o
`fresh_quota` (MCP) fuerzan una llamada viva. La cache se rotula con `stale`.

La exposicion es `idu_capabilities` con `include_quota`, documentada en las tres
copias del protocolo porque una opcion que el orquestador no conoce es una
opcion que no se usa. No se registro una herramienta nueva: el drift se queda en
13.

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

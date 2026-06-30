# idu-pi — Informe de Conexión del Supervisor

> **Tipo:** auditoría de cableado (no implementación).
> **Fecha:** 2026-06-30.
> **Auditor posterior:** Claude (revisa este informe contra código real).
> **Norte:** `C:/Users/elmas/Downloads/Documento proyecto/idu-pi-vision-supervisor-semantico.md` (la visión — "Cinturón", 4 capas, 3 riesgos, hoja de ruta §5).
> **Output complementario:** observación engram topic_key `idu-pi/supervisor-connection-report`.

---

## Resumen ejecutivo (TL;DR)

idu-pi **sí está cableado end-to-end** para arrancar solo: el scheduled task existe, corre cada hora, dispara el sensor → AgentLab → supervisor y el supervisor principal (`automaticov1`) decide si crear tareas. Esto **no es un cascarón** — funciona.

Lo que **falta** para que sea un **supervisor semántico serio** (no un refuego funcional) está concentrado en 3 cosas:

1. **Project Graph Builder determinista** — hoy la "decisión de territorio" se hace con regex sobre el path del archivo (`sensors.ts:31-78`). El LLM evalúa el contenido raw, no un grafo AST. Los edges dinámicos (path en strings, config, DB) **no se ven**. Esto es exactamente el riesgo que el bug del loader demostró — y no tiene defensa sistemática hoy.
2. **Deploy-out automatizado de skills** — `.idu/skills/` es la fuente, `.agents/skills/` son outputs. Idem-idu puede regenerar skills y los proyectos aguas abajo **no las reciben**. Parche de una vez existe (la copia que hicimos ayer); proceso continuo no.
3. **decision-ledger como circuito de aprendizaje** — el módulo existe (`decision-ledger.ts:172`) y se escribe, pero **no hay lectura que mate falsos positivos con evidencia**. La visión lo dice claro: "El humano en el puente ES el período de entrenamiento". Hoy el puente no mira el ledger antes de aceptar lo que dice el supervisor.

El **ciclo recursivo (idu-pi auditando idu-pi con humano de puente) SÍ se puede correr hoy**. El stateRoot real (`bridge-agents/projects/idu-pi`) tiene project-core confirmado y constitution activa. El run de auditoría de ayer ya demostró: gate `kind: 'ran'`, rejected_stack bloqueó 1 finding. El gap es operacional, no técnico.

---

## 1. Mapa de cableado actual (qué FIRES de verdad vs qué es cascarón)

### 1.1 Scheduled task — FIRES (verificado)

| Pieza | Archivo:línea | Estado |
|---|---|---|
| Script de tick | `scripts/idu-supervisor-tick.ps1:36-40` | Lee `IDU_PI_TICK_INTERVAL_MINUTES` (default 60min). |
| Trigger real | `scripts/install-supervisor-tick.ps1:70` | `New-ScheduledTaskTrigger -Once -At ... -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 365)` — corre **cada hora, indefinidamente**. |
| Bootstrap env vars | `scripts/install-supervisor-tick.ps1:56-62` | Inyecta `IDU_PI_TICK_STATE_ROOT` + `AGENT_WORKSPACE_ROOT` + `IDU_PI_REGISTRY_PATH` en el wrapper. |
| Skip si CLI humano activo | `scripts/idu-supervisor-tick.ps1:64-80` | Comprueba `pi`, `opencode`, `opencode-go`, `opencode-zen`. `IDU_PI_TICK_FORCE=1` lo bypasea. |
| Opt-in por TUI | `scripts/idu-supervisor-tick.ps1:102-116` | Lee `<stateRoot>/supervisor-trigger.json` — si `enabled: false`, **silent exit** (intencional, ver comentario :97-101). |

**Veredicto:** el cron **FIRES de verdad**, no es cascarón. Está instalado, se repite cada hora, respeta opt-in y skip-by-CLI. Pendiente confirmar que esté **realmente instalado en la máquina actual** (`Get-ScheduledTask -TaskName 'Idu-pi Supervisor Tick'`) — no lo verifiqué.

### 1.2 Pasos del tick — qué ejecuta realmente

Orden estricto del script (cada paso falla loud y sale):

| Paso | Comando | Qué hace | Evidencia |
|---|---|---|---|
| 1 | `corepack pnpm tsc -p tsconfig.json` | Type-check antes de correr. Falla con exit 1 si TS roto. | `idu-supervisor-tick.ps1:120-128` |
| 2 | `node dist/src/cli.js idu-automaticov1 cycle` | Corre el `automaticov1-cycle.ts` con `allowTaskCreation` default false | `idu-supervisor-tick.ps1:135-142` |
| 2.5 | `git diff --name-only HEAD~1 HEAD` → `node dist/src/cli.js idu-run-cron-preflight <changedFiles>` | Detecta diff contra commit previo, dispara cadena **postflight → sensor → AgentLab → categorize** | `idu-supervisor-tick.ps1:150-173` |
| 3 | `node dist/src/cli.js idu-pending-injections` | Surface de advisories pendientes | `idu-supervisor-tick.ps1:177-183` |
| 3.5 | `node dist/src/cli.js idu-check-user-escalation` | Reglas de 3+ criticals / 10+ total / 6h+ sin touch | `idu-supervisor-tick.ps1:192-201` |
| 4 | logea `next_run` | housekeeping | `idu-supervisor-tick.ps1:204` |

**Diferencia crítica con `planIduSupervisorCron`:** el cron planer (`idu-supervisor-cron.ts:24`) corre `mode: "plan"` con `dryRun:true, writesAllowed:false, agentLabsAllowed:false` — **NO ejecuta, solo propone**. El script PS **SÍ ejecuta** (no es dry-run). Esto resuelve la confusión del primer audit: el planner y el scheduled task son piezas distintas. El planner es para revisión humana previa; el task es el que pruede la cadena real.

### 1.3 Cadena cron preflight — qué FIRES por paso

Ejecuta `runCronPreflight` (`src/cron-preflight.ts:93`):

| Sub-paso | Llama | Output |
|---|---|---|
| 1 | `runSensorImpulses({stateRoot, projectRoot, changedFiles, promptForRole})` | Lista de `SensorImpulseResult` — uno por sensor que matchea con `changedFiles` |
| 2 | `categorizeFindings({stateRoot, findings, promptForRole})` | `supervisorAdvisory: CategorizeResult` |
| 3 | `enqueueObjectiveReminder({stateRoot, planObjective, now})` | Evalúa dedup/escalación del objective y posiblemente escribe reminder |
| 4 | `runHygieneSensor({stateRoot, repoPath})` + `emitHygieneInjections` | Hygiene advisories sobre el repo |
| 5 | `evaluateSatisfactionPredicates({stateRoot, now})` | Resuelve advisories pendientes (resolved/expired lifecycle events) |

**Decisión de AgentLabs (gobernador de costo #4.2):** `matchSensors(changedFiles)` en `src/sensors.ts:86` — un `for` sobre 6 patrones regex, first-match-wins. **No es AST**, no detecta `import { x } from "./y.ts"` ni `path.join(...)` con strings. **Funciona como trigger económico por territorio de archivo**, pero deja fuera el territorio dinámico (path-en-strings, config, DB) que fue exactamente el bug del loader.

### 1.4 Hooks de evento — cuáles disparan y cuáles no

Confirmado del audit previo (memoria `idu-pi/supervisor-wiring-audit`):

| Hook | Disparador real | Bypass throttle | Notas |
|---|---|---|---|
| `maybeRunSupervisorOnIduActivation` | `handleIdu → supervisorOnIduActivation` (campo del `CliRuntime`); se asigna en `createCliRuntime`. **FIRES cuando idu arranca**. | no | Único hook que no respeta `bypassThrottle` porque la activación siempre debe correr |
| `maybeRunSupervisorAfterPostflight` | `cli.ts` postflight + `index.ts` (Telegram postflight). **FIRES en cada postflight**. | sí (high/blocker) | Wire bonus: `detectContractDrift` advisory (líneas 151-177) — **no-op hasta que haya contracts aprobados** |
| `maybeRunSupervisorAfterSemanticTrigger` | n/a — no veo caller real (codegraph marca solo en `supervisor-categorize.ts` call site) | sí (major/critical) | **Verificar caller real** |
| `maybeRunSupervisorAfterTask` | `structured-task-queue.ts` después de crear task. **FIRES cuando se registra task** | sí (high/blocker) | |
| `planIduSupervisorCron` | manual (CLI/Telegram); NO se autoejecuta. | — | El cron real es el PS, no este |

**SAFE_FLAGS** en `idu-supervisor-hooks.ts:100` = `{agentLabsExecuted:false, rulesApplied:false, memoryDeleted:false, projectCoreModified:false}` — defensa explícita, el supervisor **no puede mutar** el sistema.

### 1.5 Outputs que se persisten

- `<stateRoot>/injections.jsonl` (append `supervisor_advisory`)
- `<stateRoot>/events.jsonl` (`lifecycle` events: resolved/expired/expired_ack)
- `<stateRoot>/supervisor-trigger.json` (opt-in)
- `<stateRoot>/decision-ledger.jsonl` (vía `recordDecision` en `injection-store.ts:10`)
- `<stateRoot>/lab.db` (advisory engagement: tareas creadas, advisor summaries)
- `<stateRoot>/role-rails.json` (cooldowns por role, token budgets)
- `logs/supervisor-tick.log` (rotativo del PS)

---

## 2. Tabla del Cinturón — visión §3 vs realidad

| Componente visión | Estado | Evidencia |
|---|---|---|
| **idu-supervisor-tick** (pulso periódico) | **existe** | `scripts/install-supervisor-tick.ps1:70` (cadencia 1h) + `scripts/idu-supervisor-tick.ps1:64-201` |
| **Project Graph Builder** (AST/deps/diff determinista) | **falta** | No existe módulo. `src/sensors.ts:31-78` es solo regex sobre path. La decisión "qué lab disparar" se hace aquí, no en un grafo. |
| **Semantic Rail** (LLM sobre el grafo) | **parcial** | `src/supervisor-consult.ts:80` (`consultSupervisor`) tiene role-rails + cooldowns + token budgets. PERO el LLM recibe `fileContent` (truncado 4000 chars, `:27`), **no un grafo**. El "Rail" existe; el "Sobre el grafo" no. |
| **AgentLabs paralelos** | **parcial** | 8 roles existen (`src/sensors.ts:32-77`); corren en workspace **clone** (`src/agentlab-review-runner.ts:250`) — write-protect correcto. PERO los 8 no se justifican empíricamente; el audit #2431 dice "PR-102 sensor→AgentLab merged-ready" — sensor dispara, falta lab real (lo que PR-103 iba a agregar). |
| **supervisor-compaction** | **existe** | `src/roles/supervisor-compaction.ts:2` como role; `src/role-engine-config.ts:71,86` default off + budget 60s. |
| **supervisor-main** | **existe** | `src/roles/supervisor-main.ts` + `src/automaticov1-cycle.ts:105` (ciclo advisory de 3 capas con `EMERGENCY_CAP_MS = 10min`). |
| **decision-ledger** | **existe** | `src/decision-ledger.ts:172` (`decisionLedgerPath`), `recordDecision`, `listDecisions`. CLI: `idu-decision-ledger list`. **Caveat:** el ledger acumula, pero no hay política de "suprimir advisories reincidentes sin evidencia". |
| **Engram** | **existe** | MCP server cargado en OpenCode (`mcp.engram` config). `engram_mem_*` tools. Tema idu-pi memoria histórica disponible. |
| **idu-preflight** | **existe** | `src/project-preflight.ts`; 27 hooks de clasificación de riesgo (security/auth/DB/dep/etc.); R5.2 fail-loud con reason. |
| **idu-postflight** | **existe** | `src/project-postflight.ts`; **discriminated union** `kind: 'ran' | 'skipped'` (R5.2 fail-loud). En la auditoría de ayer el gate skipeó con `reason: core-loaded-default` cuando corrí desde un cwd equivocado. **Desde el cwd correcto del repo, gate RAN (evidencia runtime del auditor).** |

---

## 3. Gaps ordenados por severidad

### 3.1 Bloqueantes (no se puede llamar "supervisor serio")

| # | Gap | Por qué bloquea | Evidencia |
|---|---|---|---|
| **B1** | **Project Graph Builder faltante** | El gobernador de costo (#4.2 visión) hoy es regex sobre path. Edges dinámicos (path en strings, config, DB) son ciegos. **Es exactamente el dominio del bug del loader que la visión cita como ejemplo.** Sin esto, idu-pi tiene 1/3 del cinturón (sensado regex sin grafo). | `src/sensors.ts:31-78`; ausencia total de módulo AST/deps. |
| **B2** | **PISO vs TECHO ambiguos en PISO** | La visión distingue "PISO = gating advisory que advierte" de "TECHO = hard-stop por hooks del host (opt-in)". El hook re-inyecta directrices de idu-pi en el system prompt tras compactación es PISO (sirve, pero no obliga). Está bien cableado como PISO. PERO no hay TECHO configurado: el host CLI no tiene un hard-stop para "ignorar supervisor_advisory". El supervisor es completamente opt-in hoy. | `src/idu-supervisor-hooks.ts:100` SAFE_FLAGS + ausencia de hooks de host. |
| **B3** | **Decision-ledger no cierra el loop** | El ledger se escribe pero no se lee para suprimir falsos positivos reincidentes. La visión dice "El humano en el puente ES el entrenamiento", pero el ledger no es el termómetro de "valió la pena la señal". Sin lectura, no hay forma de saber cuándo automatizar el puente. | `src/decision-ledger.ts:172`, ausencia de lógica `shouldSuppressByReincidence()`. |

### 3.2 Importantes (calidad / cierre del loop)

| # | Gap | Por qué importa | Evidencia |
|---|---|---|---|
| **I1** | **Deploy-out de skills no automatizado** | `.idu/skills/` es la fuente (correcto), `.agents/skills/` son outputs (también correcto). PERO no hay proceso que mantenga sincronizados. Si el orquestador de un proyecto aguas abajo borra `.agents/skills/`, no se reinjectan. **Hoy idu-pi está roto aguas abajo si las skills no se deployan.** | Manual: ayer copiamos `.idu/skills/` → `.agents/skills/`. No hay código que automatice. |
| **I2** | **Constitution gate skipea con `reason: core-loaded-default`** | El gate skipea cuando no hay `stateRoot/.idu/config/project-core.json`. El stateRoot real (`bridge-agents/projects/idu-pi`) SÍ tiene core confirmado. PERO si idu-pi corre contra otro stateRoot (clone vacío, test fixture), gate skipea sin fall-loud sobre el motivo. No he verificado si este skip es **el mismo** que el audit previo mostró (`runIduSupervisorLoop({})` → kind:skipped/reason). **Si lo es, no hay un único contrato: el skip es legítimo si el stateRoot es headless, pero el caller no tiene forma de saberlo sin rerun.** | `src/project-postflight.ts` (postflight); `src/idu-supervisor-loop.ts` (loop). |
| **I3** | **Sensor de "no_changed_files"** | El cron preflight corre con `changedFiles=[]` cuando no hay diff (first commit, git roto). Los 6 sensores regex no disparan → no se ejecuta ningún AgentLab. La lógica está bien, pero **no hay telemetría explícita de "tick sin señal"**. No sabemos cuántos ticks pasaron sin audit. | `scripts/idu-supervisor-tick.ps1:153-162`. |
| **I4** | **AgentLab sin llamada concreta para security/architecture** | `matchSensors` devuelve el role, pero ¿quién es el "AgentLab" que efectivamente ejecuta? En `agentlab-review-runner.ts:225-244`, se selecciona profile. Los profiles deben existir para `agentlab-security`, `agentlab-architecture`, etc. La memoria #2431 marca que falta trabajo de labs reales (PR-103 era el siguiente). | `src/agentlab-review-runner.ts:231`; PR-103 no merged. |

### 3.3 Nice-to-have

| # | Gap | Notas |
|---|---|---|
| **N1** | **No tests para `SKILLS_DIR`/`syncNecessarySkills`** | Memoria `idu-pi/supervisor-wiring-audit` lo marca; relevante al deploy-out de skills. |
| **N2** | **`handleIdu` (el activador) sin tests directos** | Confirmado en audit previo. Punto único de falla del path de activation. |
| **N3** | **Logging estructurado (no `console.log`)** | El script PS usa `Add-Content` + `Out-String`, funciona pero no hay parseo structured de eventos del supervisor. |
| **N4** | **Trigger opt-in sin telemetría** | Si el usuario apaga el trigger (`supervisor-trigger.json: enabled:false`), el script silent-exit (intencional) deja 0 rastro del por qué. Para auditoría "por qué mi supervisor no corre" hay que mirar logs. |

---

## 4. Las 6 dudas (A–F) respondidas

### A. Cableado actual end-to-end

**Sí, existe.** Evidencia completa en §1. Diferencia importante: `planIduSupervisorCron` (en `idu-supervisor-cron.ts:24`) NO es el cron real — es un planner dry-run (`mode:"plan"`, `writesAllowed:false`). El cron real es `scripts/idu-supervisor-tick.ps1` instalado por `install-supervisor-tick.ps1:76` con cadencia cada hora (repetir 365 días).

**Quién registra el scheduled task del SO:** el script `install-supervisor-tick.ps1` mismo — `Register-ScheduledTask -TaskName ... -Force`. Lo invoca el humano una vez. Estado actual en la máquina: **no lo verifiqué en esta auditoría** — pendiente `Get-ScheduledTask -TaskName 'Idu-pi Supervisor Tick'`.

**Los 4 hooks de evento (4 de la tabla §1.4):** 3 están cableados con call sites reales (activation, postflight, task). `maybeRunSupervisorAfterSemanticTrigger` debe verificarse con un caller concreto (memoria #2729 marca el call site en `supervisor-categorize.ts` pero parece interno).

### B. El Cinturón vs lo construido

Tabla completa en §2. 8/10 componentes existen o son parciales. Los 2 que faltan son: **Project Graph Builder** (FALTA) y el **"sobre el grafo"** del Semantic Rail (parcial — el LLM no recibe grafo).

### C. La pregunta de los tres grafos

Hay efectivamente **3 grafos** en juego, con roles distintos:

| Grafo | Qué hace | Quién lo opera | Rol en supervisor |
|---|---|---|---|
| **(1) codegraph** (`C:\Users\elmas\.codegraph`) | Símbolos TS del repo. Stats: 582 files, 13.927 nodos, 42.652 edges, SQLite. | Hoy solo accesible a mí vía CLI `codegraph explore` / MCP `codegraph_explore` (instalado pero NO expuesto como MCP al supervisor) | Ninguno hoy. Si se expone a `AgentLab` como input, podría complementar el AST estático. |
| **(2) Project Graph Builder** | AST + imports + dependencies + diffs. Determinista. | **No existe.** Es el gap B1. | Gobernador de costo (#4.2). Único mecanismo que cierra la cobertura sobre edges estáticos. |
| **(3) Grafo de Engram** | Conocimiento/memoria histórica (`mem_search` FTS5, observaciones topic-keyed). | MCP `engram_mem_*` en runtime. | Memoria operativa del orquestador. **No es un grafo de código** — es un grafo de *lo que el proyecto aprendió*. |

El supervisor **debe usar los 3 con propósitos distintos**: (2) para el sensado determinista + gobernador de costo; (3) para "qué decisiones se tomaron antes en este repo"; (1) opcionalmente para "qué símbolos expone la base de código". Mezclar 2 con 3 es el error más probable del orquestador al interpretar la visión.

**Sobre "el grafo de engram para auditar":** viable HOY para "el orquestador AUDITA al supervisor llamando a `engram_mem_search` antes de aceptar lo que el supervisor produjo" — eso es el uso correcto. Pero NO es un análisis de código; es un "buscar en la memoria del proyecto qué hemos visto sobre esto antes". La visión distingue esto con la palabra "**memoria**" explícita en el Cinturón.

### D. Gobernador de costo — ¿existe o se dispararían todos 8 labs?

**Mitigado, no ausente.** Hoy `matchSensors(changedFiles)` (`src/sensors.ts:31-78`) decide qué labs despertar **por regex sobre el path del archivo** + first-match-wins. **El riesgo 4.2 está parcialmente controlado**: si el diff solo toca `.md`, solo corre `agentlab-docs` (no los 8). PERO:

1. Es **cobertura insufficient**: los 6 patrones regex son "primer match wins" — un `src/auth/login.ts` ya queda como `agentlab-security` y no genera otros impulses. Diff grande = muchos archivos = muchos roles en paralelo (no explosión, pero sí varios).
2. Falta **edges dinámicos**: paths en strings (`require("./foo")`, `path.join(__dirname, ...)`) son invisibles. Eso requiere el grafo AST (#B1).

**Veredicto:** se dispararían varios, no los 8 — pero la granularidad es por archivo, no por edge del código. Para la visión §4.2 ("solo los labs cuyo territorio se tocó"), el sensor regex cumple la primera parte (filtra dominios grandes) pero pierde la segunda (edges dinámicos).

### E. Deploy-out de skills — ¿bloqueante para "bien conectado"?

**Sí, bloqueante.** Razón concreta:

- `.idu/skills/` es la fuente (se trackea en git). Si idu-pi agrega una skill hoy, queda en el commit.
- `.agents/skills/` son outputs (también trackeados por whitelist legacy). **No hay automatización que despliegue `.idu/skills/` → `.agents/skills/` cuando OpenCode/Pi lee las skills.**
- Hoy OpenCode lee de `~/.config/opencode/skills/` y `~/.agents/skills/<cwd>/skills/` (según el bloque `<available_skills>` que tengo en el AGENTS.md local). Si un proyecto aguas abajo no tiene `.agents/skills/`, las skills de idu-pi **no se cargan**.

**Para "bien conectado" idu-pi debe asegurarse de que cada vez que alguien lo activa como MCP en un proyecto, sus skills aparezcan en el dir que el host lee.** Eso es una pieza que no existe. La ausencia la veo confirmada por:

- No hay código que sincronice `.idu/skills/` → host location
- La memoria `idu-pi/skill-deploy-out-gap` (topic_key) lo marcó en su momento
- `src/syncNecessarySkills` (`config-wizard.ts:750`) hace la dirección **inversa** (source → projectPath), no la que la visión pide

### F. Ciclo recursivo (idu-pi auditando idu-pi) — ¿corre HOY?

**Sí, corre hoy.** Pasos concretos:

1. El registry actual confirma `activeProjectId: 'idu-pi'` con `path: pi-telegram-bridge` y `stateRoot: bridge-agents/projects/idu-pi` (`registry/projects.json`).
2. El `stateRoot` real SÍ tiene `project-core.json` confirmado (`bridge-agents/projects/idu-pi/.idu/config/project-core.json` — verificado `status: confirmed`, `updatedAt: 06-06-2026 19:04:30`).
3. Constitution activa (`status: active`, `sourceCoreStatus: confirmed`).
4. El audit del run previo del auditor (en el hilo de hoy, output ya producido) mostró: **gate kind: 'ran'**, rejected_stack bloqueó 1 finding (long-running sin SIGTERM).

**No hay bloqueante técnico para correr el ciclo recursivo**. Falta la práctica: ¿quién lo corre, cada cuánto, qué hace con el output? Eso es decisión de proceso.

**Lo que ayudaría al humano de puente**: el `decision-ledger` debería poder consultarse con `idu-decision-ledger list --since <iso>` para que el operador vea "qué advisories rechazó el supervisor en los últimos 7 días, y cuáles estaban bien". Esa herramienta existe (`src/decision-ledger.ts`). Falta el flujo "el operador corre esto, registra decisión, mide".

---

## 5. Secuencia "chico primero" — próximo paso concreto (alineado con visión §5)

La visión §5 dice:

1. Merge fix del loader (commit `412c1c9`, branch `fix/project-core-loader-path-bug`) — **hecho y mergeado** según los hilos previos (`R5.3.2.1` PR #203, #210).
2. Correr **un par de ciclos recursivos con humano de puente**. Leer cada ciclo a mano.
3. Dejar que esos ciclos **digan cuál lab vale la pena primero**.

Mi recomendación, alineada con la visión y este audit:

### Paso 1 (HOY) — Primer ciclo recursivo con telemetría explícita

```bash
# asegurar que el scheduled task está activo (verificación)
Get-ScheduledTask -TaskName 'Idu-pi Supervisor Tick'

# si no está, instalar
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-supervisor-tick.ps1

# correr manualmente el cron preflight (sin esperar la hora)
node dist/src/cli.js idu-automaticov1 cycle
node dist/src/cli.js idu-run-cron-preflight <changedFiles>
node dist/src/cli.js idu-pending-injections
node dist/src/cli.js idu-decision-ledger list --since "$(Get-Date -Format o)"
```

**Objetivo:** capturar el output completo, leerlo, y registrar en el decision-ledger las decisiones: "acepto / descarto / reincidente". Eso entrena al termómetro.

### Paso 2 — Próximo corte del decision-ledger

Hoy el ledger escribe pero no suprime reincidentes. Después de N=10 ciclos con humano de puente, se puede agregar `shouldSuppressByReincidence(decision, ledger) → boolean`. **Justificación:** la visión §4.3 dice "el humano en el puente ES el período de entrenamiento" — el ledger mide cuándo termina ese entrenamiento.

### Paso 3 — Candidato natural al Project Graph Builder

Si los ciclos del paso 1 muestran falsos positivos (over-trigger de un AgentLab), construir el grafo determinista **limitado al territorio** del sensor que peor performance dé. Ejemplo: si `agentlab-architecture` sobre-triggertea porque el regex captura `.ts` demasiado amplio, un grafo que mira **qué exports de qué archivos importa el diff** reduce el territorio a los símbolos afectados, no al path completo.

NO construir el grafo entero de entrada (la visión §5.4-5 lo prohíbe literalmente: "El grafo NO debe ser LLM: es análisis estático (parser/AST). Ojo: los grafos estáticos pierden edges dinámicos (paths en strings, config, DB) — exactamente el tipo de bug del loader. Por eso el grafo cubre la capa dura y el LLM razona sobre lo que el grafo no ve.").

### Paso 4 — Deploy-out de skills automatizado

Solo **después** de que el grafo ayude al sensor a decidir (paso 3). Razón: el deploy-out es infraestructura operativa; el grafo es el gobernador de costo. Si el grafo todavía no existe, los deploys automatizados solo amplifican ruido.

**NO construyo esto en aislamiento**, porque sin el resto del cinturón el deploy-out es "agregar más superficie sin fondo".

### Lo que NO recomiendo

- **Construir el grafo entero ahora (B1):** saltarse el ciclo recursivo primero viola "chico primero".
- **Construir los 8 labs especializados:** la visión §3.4 explícitamente lo prohíbe. Construir el que el ciclo del paso 1 indique que cierra el loop.
- **TECHO con hard-stops del host:** el contrato es advisory-only. Bajar a TECHO es decisión de gobernanza aparte, no parte de este ciclo.

---

## 6. Estado del constraint advisory-only

- `SAFE_FLAGS` en `idu-supervisor-hooks.ts:100` = todas las mutaciones en `false`. ✓
- `planIduSupervisorCron` `writesAllowed:false, agentLabsAllowed:false`. ✓
- `agentlab-review-runner.ts:250` exige `workspaceKind === "clone"`. ✓ (AgentLabs NO tocan el repo real)
- `SAFE_FLAGS` también se inyectan en el `IduSupervisorHookResult.safety` — telemetria explícita. ✓
- **Gap:** el TECHO (hooks del host que frenen) **no se ha decidido**. La visión dice "PISO advierte; el TECHO frena" — sin un trigger de "host opt-in al TECHO", el contrato actual es solo PISO. Esto NO es un problema de implementación, es de gobernanza.

---

## 7. Apéndice — archivos:linea usados como evidencia

- `scripts/install-supervisor-tick.ps1:70` (cadencia 1h)
- `scripts/idu-supervisor-tick.ps1:64-201` (lógica del tick)
- `src/cron-preflight.ts:93` (chain postflight→sensor→AgentLab)
- `src/sensor-impulses.ts:58` (runSensorImpulses)
- `src/sensors.ts:31-78` (los 6 regex, governor de costo)
- `src/supervisor-categorize.ts` (categorizeFindings con LLM)
- `src/idu-supervisor-hooks.ts:100` (SAFE_FLAGS)
- `src/idu-supervisor-hooks.ts:107-202` (los 4 hooks)
- `src/idu-supervisor-cron.ts:24` (planner dry-run, NO es el cron real)
- `src/automaticov1-cycle.ts:105` (supervisor-main con EMERGENCY_CAP_MS 10min)
- `src/decision-ledger.ts:172` (path del ledger)
- `src/agentlab-review-runner.ts:250` (AgentLab write-protect via clone)
- `src/config-wizard.ts:149-151` (SKILLS_DIR/SKILLS_KEEP/SKILL_INDEX)
- `src/roles/supervisor-compaction.ts:2` (rol de compaction)
- `src/roles/supervisor-main.ts` (rol principal)
- `src/project-postflight.ts` (postflight con R5.2 discriminated union)
- `src/project-preflight.ts` (preflight con 27 hooks)
- `C:\Users\elmas\Documents\bridge-agents\registry\projects.json` (active project = idu-pi)
- `C:\Users\elmas\Documents\bridge-agents\projects\idu-pi\.idu\config\project-core.json` (confirmado)
- `C:\Users\elmas\Documents\bridge-agents\projects\idu-pi\.idu\config\project-constitution.json` (active)

---

> **Para el auditor Claude:** todo lo de arriba vino de `codegraph_explore` + Read directo en archivos:linea. Si algo falla la verificación, está mal y debe corregirse con la evidencia que el auditor encontró. No hay claims sin file:line.

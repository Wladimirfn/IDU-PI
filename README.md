# IDU Cross-CLI Agent Router & Quality Harness (v2.1.0)

<a href="https://github.com/Gentleman-Programming/gentle-ai">
  <img width="220" src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" alt="Built with Gentle-AI" />
</a>

**IDU Cross-CLI** es un router universal de terminales y arnés de calidad que permite a cualquier agente orquestador padre (**Claude Code**, **Pi**, **OpenCode** o **Antigravity**) delegar tareas a procesos de terminal reales (**Claude CLI**, **OpenCode CLI**, **Codex CLI**, **Pi CLI**) mediante perfiles de costos/modelos bajo la estricta **ONE ORCHESTRATOR RULE**.

Todo el código heredado previo (bot de Telegram, 78 herramientas obsoletas, AgentLab, Plan
Maestro y cron loops) fue retirado en dos pasos: primero en el commit `92f8380` y después con
la purga de vestigios que borró los 15 perfiles de `config/profiles/` y los 14 scripts del
cron `supervisor-tick` y de un solo uso que quedaban colgados. Su código está en el tag
`legacy-archive-pre-purge` y ya no ocupa el árbol de trabajo; sus documentos de planificación
se eliminaron por completo. Ver `docs/architecture.md` para la arquitectura vigente.

> **Nombre de la carpeta.** El repositorio se llama `idu-cross-cli` (mismo `name` de
> `package.json`). Si tu clon todavía vive en un directorio llamado `pi-telegram-bridge`, es
> un nombre histórico: renómbralo y actualiza la ruta absoluta que declara tu cliente MCP.

---

## Novedades en v2.1.0: Watchdog Adaptativo, Tareas Largas y Resiliencia

1. **Watchdog Adaptativo por Inactividad (Sliding Window)**:
   - Supera el límite ciego de `setTimeout`. Monitorea en tiempo real el streaming de `stdout`/`stderr` (`idleTimeoutMs`, `lastActivityAt`, `bytesEmitted`).
   - El worker **nunca se interrumpe** mientras siga razonando o emitiendo actividad.
   - En caso de corte o interrupción, preserva la salida parcial (`partial: true`), el error exacto y el `resumeHint` con el identificador de sesión.

2. **Techos Extendidos (Hasta 4 Horas o Ilimitado con Sentinel `0`)**:
   - Soporta tareas de refactorización y análisis profundo de 30 a 60 minutos o más.
   - Techos configurables por perfil (`hardCapMs`), con soporte para `hardCapMs = 0` (techo desactivado).

3. **Terminación Confiable de Procesos en Windows (`killProcessTree`)**:
   - Ejecución de `taskkill /PID <pid> /T /F` en Windows (`win32`).
   - Elimina en árbol los wrappers por lotes (`cmd.exe`), `node.exe` y los binarios hijos del CLI sin dejar procesos zombies o huérfanos.

4. **Nueva Herramienta MCP `idu_worker_wait`**:
   - Permite a los clientes MCP esperar la finalización de workers asíncronos con tiempo de espera configurable.
   - **Garantía no destructiva**: si el timeout del cliente expira, el worker continúa ejecutándose en el sistema operativo en segundo plano.

5. **Tríada de Sesiones Cross-CLI (`Session Triad`) y Bloqueos Concurrenciales**:
   - Soporte nativo para `--session-id`, `--resume` y `--fork` en Claude, OpenCode y Pi.
- **Afinidad de harness al reanudar:** sin `--profile`, la sesión hereda el suyo en vez de caer al
  default global. Con un `--profile` de otro harness, la operación se rechaza antes de arrancar;
  `--force` la permite asumiendo que se pierde la continuidad nativa.
- **Turnos transaccionales:** solo los runs completados incrementan `turnCount` y fijan
  `nativeSessionId`. Un run fallido queda registrado en `runs` para auditoría, pero no cuenta como
  turno.
   - Bloqueo atómico contra ejecuciones concurrentes en la misma sesión (`acquireSessionLock`) con validación de PID y protección contra eliminación foránea.

6. **Integración Corregida con Codex CLI**:
   - Soporte directo de `codex exec` con los flags oficiales `--dangerously-bypass-approvals-and-sandbox` y `--json`.

7. **Evaluación Multirepositorio (`idu_preflight` & `idu_postflight`)**:
   - Soporte total para `working_dir` y `cwd`. Permite auditar repositorios y proyectos externos sin falsear la ruta hacia el directorio de IDU.

---

## Catálogo de Herramientas MCP (`dist/src/mcp-server.js`)

El servidor expone **13 herramientas de alto impacto** optimizadas para mínimo consumo de contexto:

| Herramienta | Descripción |
| :--- | :--- |
| `idu_status` | Estado del workspace actual, rama Git, cambios en el árbol y salud del sistema. |
| `idu_project_status` | Alias de compatibilidad para consultar el estado del proyecto. |
| `idu_preflight` | Evaluación de riesgo, tree sucio e impacto antes de tocar código en `working_dir`. |
| `idu_postflight` | Verificación post-edición: diffs reales vs esperados y blast radius en `working_dir`. |
| `idu_decision_record` | Registra una decisión técnica, de arquitectura o de gobernanza en el ledger duradero. |
| `idu_decision_list` | Consulta y filtra el historial de decisiones auditables. |
| `idu_delegate` | Lanza un worker terminal real bajo un perfil configurado con `IDU_WORKER=true`. Un worker que vuelve a delegar recibe un error: la guarda es fail-closed y se apoya solo en la identidad de worker. |
| `idu_delegate_parallel` | Lanza múltiples workers concurrentemente en paralelo. |
| `idu_worker_status` | Monitorea en tiempo real estado, telemetría (`elapsedMs`, `health`, actividad) y logs. |
| `idu_worker_wait` | Espera de forma síncrona/reactiva la finalización de un worker sin matarlo si expira. |
| `idu_worker_result` | Recupera la salida completa estructurada, diffs y reporte del worker. |
| `idu_session_list` | Lista las sesiones activas o históricas con su CLI, timestamp y bloqueo. |
| `idu_capabilities` | Informa los perfiles disponibles en `~/.idu/profiles.json` y CLIs detectados. |

---

## Perfiles de Ejecución (`~/.idu/profiles.json`)

Los perfiles no están-fixed en el repo: se cargan desde `~/.idu/profiles.json`, que **mergea
sobre** los presets del proyecto. Para ver los perfiles efectivos de tu máquina:

```bash
pnpm run cli capabilities
```

| Perfil | CLI | Modelo | Timeout Trabajo | Inactividad (Idle) | Techo Máximo |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `architecture` | Claude Code | opus | 1 hora | 5 minutos | 4 horas |
| `antigravity-advisory` | Antigravity (`agy`) | gemini-3.8-flash-high | 1 hora | 5 minutos | 4 horas |
| `deep-refactor` | Claude Code | sonnet | 1 hora | 5 minutos | 4 horas |
| `coding` | Codex CLI | gpt-5.6-luna | 1 hora | N/A | 4 horas |
| `cheap-explore` | OpenCode | MiniMax-M3 | 30 minutos | 5 minutos | 2 horas |
| `cheap-debug` | OpenCode | deepseek-v4-flash | 30 minutos | 5 minutos | 2 horas |
| `commandcode` | Command Code (`cmdc`) | deepseek/deepseek-v4.1-flash | 30 minutos | 5 minutos | 2 horas |
| `fast` | Pi CLI | MiniMax-M3 | 3 minutos | N/A | 3 minutos |
| `mcode` | minimax Code (`mcode`) | minimax/MiniMax-M3.1-Flash-Preview | 30 minutos | 5 minutos | 2 horas |
| `kimi` | Kimi | (default del CLI) | 30 minutos | N/A | 2 horas |
| `qwen` | Qwen | (default del CLI) | 30 minutos | N/A | 2 horas |
| `antigravity` | Antigravity (`agy`) | gemini-3.8-flash-high | 30 minutos | 5 minutos | 2 horas |

**El nombre del modelo es un pass-through opaco.** El arnés no lo valida ni lo normaliza: lo
reenvía al CLI subyacente, que acepta cualquier identificador que entienda. Para usar un
modelo distinto, agregá un perfil a `~/.idu/profiles.json` — no hace falta tocar código.

> **Inactividad vs. streaming.** La columna "Inactividad" solo aplica a perfiles con
> `streams: true`. En un perfil sin streaming, el único freno es el timeout total: el daemon no
> corta por silencio aunque se declare `idleTimeoutMs`. Si delegás tareas largas a un perfil
> así, sumale `streams: true` al perfil.

---

## Configuración en Clientes MCP

### OpenCode (`~/.config/opencode/opencode.json` y `opencode.jsonc`)

Para evitar que OpenCode cancele llamadas de herramientas MCP en tareas largas que tarden más de 2 minutos, configura:

En `~/.config/opencode/opencode.json`:
```json
{
  "experimental": {
    "mcp_timeout": 1800000
  }
}
```

En `~/.config/opencode/opencode.jsonc`:
```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "idu-pi": {
      "type": "local",
      "command": [
        "node",
        "/ruta/absoluta/al/repo/dist/src/mcp-server.js"
      ],
      "cwd": "/ruta/absoluta/al/repo",
      "enabled": true,
      "timeout": 1800
    }
  }
}
```

Usá la **ruta absoluta**: un path relativo resuelve contra el cwd del cliente MCP, que no es el
del proyecto. Antes de conectar, compilá con `pnpm build` — `dist/` no está versionado.

Otras clientes: `docs/mcp-server.md`.

---

## Comandos CLI Directos

El arnés puede ejecutarse directamente desde terminal:

```bash
# Ver estado del sistema y CLIs instalados
pnpm run cli status

# Ver capacidades y perfiles en JSON
pnpm run cli capabilities

# Ejecutar preflight sobre una tarea en un repositorio específico
pnpm run cli preflight "Refactorizar autenticación" --cwd "C:/ruta/al/proyecto"

# Delegar directamente a un worker desde la terminal
pnpm run cli delegate "Auditar arquitectura del módulo IoT" --profile architecture

# Esperar en silencio a un worker lanzado con async
node dist/src/cli.js wait <run_id> --timeout 540000

# Iniciar el servidor MCP por stdio
pnpm run mcp
```

`preflight` acepta `--cwd` (o `--working-dir`) y `--expected-files a,b`. Sin `--cwd` audita el
directorio actual.

---

## Pruebas y Construcción

```bash
# Compilar TypeScript
pnpm run build

# Ejecutar suite de pruebas unitarias
pnpm test

# Suite completa + guardas de deriva e higiene del repo
pnpm run verify
```

| Script | Qué comprueba |
| :--- | :--- |
| `pnpm test` | 49 pruebas unitarias: arnés cross-cli, ciclo de vida de procesos, locks, watchdog y contrato de las 13 herramientas MCP. |
| `pnpm run test:guarded` | La misma suite envuelta en `scripts/run-tests-with-leak-guard.mjs`, que falla si los tests dejan archivos nuevos en el temp. |
| `pnpm run test:protocol-drift` | Que el SKILL.md del protocolo documente exactamente las 13 herramientas canónicas, sin fantasmas. |
| `pnpm run test:repo-hygiene` | Que las pruebas no filtren estado a la raíz del repo. |

La suite completa pasa al 100% y cubre el arnés cross-cli, el ciclo de vida de procesos, el
aislamiento de locks, el watchdog de timeouts, el contrato de las 13 herramientas MCP y la
ausencia de drift entre este README y los perfiles reales del código.

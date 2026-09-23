# IDU Cross-CLI Agent Router & Quality Harness (v2.1.0)

<a href="https://github.com/Gentleman-Programming/gentle-ai">
  <img width="220" src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" alt="Built with Gentle-AI" />
</a>

**IDU Cross-CLI** es un router universal de terminales y arnés de calidad que permite a cualquier agente orquestador padre (**Claude Code**, **Pi**, **OpenCode** o **Antigravity**) delegar tareas a procesos de terminal reales (**Claude CLI**, **OpenCode CLI**, **Codex CLI**, **Pi CLI**) mediante perfiles de costos/modelos bajo la estricta **ONE ORCHESTRATOR RULE**.

Todo el código heredado previo (bot de Telegram, 78 herramientas obsoletas y cron loops) ha sido retirado y archivado de forma segura en `legacy_archive/`.

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
| `idu_delegate` | Lanza un worker terminal real bajo un perfil configurado con `IDU_WORKER=true`. |
| `idu_delegate_parallel` | Lanza múltiples workers concurrentemente en paralelo. |
| `idu_worker_status` | Monitorea en tiempo real estado, telemetría (`elapsedMs`, `health`, actividad) y logs. |
| `idu_worker_wait` | Espera de forma síncrona/reactiva la finalización de un worker sin matarlo si expira. |
| `idu_worker_result` | Recupera la salida completa estructurada, diffs y reporte del worker. |
| `idu_session_list` | Lista las sesiones activas o históricas con su CLI, timestamp y bloqueo. |
| `idu_capabilities` | Informa los perfiles disponibles en `~/.idu/profiles.json` y CLIs detectados. |

---

## Perfiles de Ejecución (`~/.idu/profiles.json`)

| Perfil | CLI | Modelo | Timeout Trabajo | Inactividad (Idle) | Techo Máximo |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `architecture` | Claude Code | Claude 3.7 / Opus | 1 hora | 5 minutos | 4 horas |
| `deep-refactor` | Claude Code | Claude 3.7 / Sonnet | 1 hora | 5 minutos | 4 horas |
| `coding` | Codex CLI | GPT-5.6 Luna | 1 hora | N/A | 4 horas |
| `cheap-explore` | OpenCode | MiniMax M3 | 30 minutos | 5 minutos | 2 horas |
| `cheap-debug` | OpenCode | DeepSeek V4 Flash | 30 minutos | 5 minutos | 2 horas |
| `fast` | Pi CLI | MiniMax M3 | 3 minutos | N/A | 3 minutos |

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
        "C:\\Users\\elmas\\pi-telegram-bridge\\dist\\src\\mcp-server.js"
      ],
      "cwd": "C:\\Users\\elmas\\pi-telegram-bridge",
      "enabled": true,
      "timeout": 1800
    }
  }
}
```

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

# Iniciar el servidor MCP por stdio
pnpm run mcp
```

---

## Pruebas y Construcción

```bash
# Compilar TypeScript
pnpm run build

# Ejecutar suite de pruebas unitarias
pnpm test
```

Todas las 24 pruebas pasan al 100% cubriendo el arnés cross-cli, ciclo de vida de procesos, aislamiento de locks, watchdog de timeouts y herramientas MCP.

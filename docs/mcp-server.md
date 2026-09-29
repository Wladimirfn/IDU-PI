# MCP Server — IDU Cross-CLI

El servidor expone **13 herramientas** por stdio. Es la superficie que usan los orquestadores
para delegar trabajo y para pasar por los gates de calidad.

> Este documento antes listaba ~52 herramientas (`idu_master_plan_*`, `idu_source_*`,
> `idu_agentlab_*`, `idu_supervisor_*`, `idu_bibliotecario_*`) que pertenecen al sistema
> retirado y **no existen**. Si buscás una de esas, no está.

## Catálogo

| Herramienta | Propósito |
| --- | --- |
| `idu_status` / `idu_project_status` | Rama, árbol sucio, conteo y hasta 20 archivos modificados, `iduHome`. |
| `idu_preflight` | Riesgo antes de tocar código. `request` (req), `expected_files`, `change_mode`, `working_dir`/`cwd`. |
| `idu_postflight` | Blast radius después. `task_id` y `expected_files` (req), `working_dir`/`cwd`. Registra en el ledger. |
| `idu_decision_record` | Escribe una decisión en `~/.idu/decision_ledger.json`. |
| `idu_decision_list` | Lee el ledger, con filtro `project_id` y `limit`. |
| `idu_delegate` | Lanza un worker. Es el núcleo. |
| `idu_delegate_parallel` | Lanza varios `tasks[]` en paralelo, todos en modo async. |
| `idu_worker_status` | Telemetría en vivo: `elapsedMs`, `secondsSinceLastActivity`, `health`, `bytesEmitted`. |
| `idu_worker_wait` | Espera el fin de un run. **No destructivo**: si expira, el worker sigue vivo. |
| `idu_worker_result` | Resultado final, con `stdout`/`stderr` solo si `verbose`. |
| `idu_session_list` | Árbol de sesiones con padre, perfil, turnos y última actividad. |
| `idu_capabilities` | Perfiles cargados, CLIs detectados y estado de la ONE ORCHESTRATOR RULE. |

## `idu_delegate`

| Parámetro | Tipo | Notas |
| --- | --- | --- |
| `task` | string | Instrucciones para el worker. |
| `profile` | string | Clave de `~/.idu/profiles.json` (o de los presets). |
| `async` | boolean | `true` devuelve `run_id` al instante y el worker corre como daemon. |
| `working_dir` / `cwd` | string | Directorio del proyecto a auditar. |
| `session_id` | string | Reanuda una sesión existente, o crea una con ese id. |
| `parent_session_id` | string | Padre, para la jerarquía. |
| `fork` | boolean | Ramifica desde `session_id` en vez de continuarla. |
| `timeout_ms` | number | Anula el `timeout_ms` del perfil. |
| `context_files` | string[] | Rutas a adjuntar como contexto. |
| `verbose` | boolean | Incluye `stdout`/`stderr` completos. Consume tokens; úsalo solo al depurar. |

### Modo async: la regla del `wait`

Con `async: true` el proceso del worker queda **desligado**. Para no gastar tokens ni dejar
runs huérfanos, la forma correcta de esperar es:

```bash
node dist/src/cli.js wait <run_id> --timeout 540000
```

**No uses `--follow`**: vuelca el NDJSON crudo al contexto y lo desborda. Códigos de salida de
`wait`: `0` completado, `1` fallido, `124` timeout **con el worker todavía corriendo** (volvé a
invocarlo).

### Perfiles con permiso de escritura

Un perfil `workspace` queda bloqueado si hay un intento SDD activo (guard de Work Unit). Para
revisión externa usá perfiles `read-only`, como `architecture` o `antigravity-advisory`.

## Validación de entrada

El servidor es **fail-closed** en los esquemas: rechaza parámetros desconocidos, tipos
incorrectos y valores fuera del `enum`, con un mensaje que nombra el parámetro culpable. Un
argumento mal escrito produce un error, nunca un default silencioso.

## Configuración por cliente

El binario es `dist/src/mcp-server.js`. **Compilá antes de usarlo** (`pnpm build`): `dist/` no
está versionado.

### OpenCode

`~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "idu-pi": {
      "type": "local",
      "command": ["node", "/ruta/absoluta/al/repo/dist/src/mcp-server.js"],
      "cwd": "/ruta/absoluta/al/repo",
      "enabled": true,
      "timeout": 1800
    }
  }
}
```

OpenCode cancela llamadas MCP largas por defecto; `timeout: 1800` (segundos) y
`experimental.mcp_timeout: 1800000` en `opencode.json` evitan que corte una delegación de
varios minutos.

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.idu-pi]
command = "node"
args = ["/ruta/absoluta/al/repo/dist/src/mcp-server.js"]
startup_timeout_ms = 30000
```

### Claude Code

```bash
claude mcp add idu-pi -- node /ruta/absoluta/al/repo/dist/src/mcp-server.js
```

Usá la **ruta absoluta**. Un path relativo resuelve contra el cwd del cliente MCP, que no es el
del proyecto.

## Notas de operación

- `idu_postflight` con `expected_files: []` marca **todo** cambio observado como violación de
  blast radius. Es intencional: es la forma de afirmar "no toqué nada".
- El ledger es un JSON plano en `~/.idu/decision_ledger.json`, con relectura y reescritura
  completa en cada alta. Crece sin poda automática.
- El esquema de sesión y el de `verify` viven en `openspec/specs/` cuando esa carpeta está
  versionada; el repo la excluye por `.gitignore`, así que en un clone fresco no están.

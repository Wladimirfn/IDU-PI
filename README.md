# Idu-pi

Bridge privado de Telegram para operar Pi localmente: elegís proyecto, agente/modelo, workspaces de laboratorio, reportes y acciones seguras sin salir del chat.

## Camino rápido

### 1. Instalar y arrancar

```text
setup-pi-telegram-bridge.bat
start-pi-telegram-bridge.bat
```

### 2. Inicializar desde Telegram

Ejecutá estos comandos en orden:

```text
/config
/config init_workspace
/config init_assets
/config skills_sync
/config db_init
/config sync_commands
/agents
/testlab quick
/reports
```

### 3. Verificar estado

```text
/status
/dashboard
/config doctor
```

## Qué hace

| Área        | Qué resuelve                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Seguridad   | Acepta mensajes solo desde `ALLOWED_USER_ID` y mantiene secretos fuera de Git.                                                   |
| Pi RPC      | Envía prompts a Pi en modo RPC con sesión persistente.                                                                           |
| Proyectos   | Permite cambiar proyecto activo y retomar trabajos recientes.                                                                    |
| Agentes     | Permite elegir perfiles/modelos y muestra qué modelo usa cada agente.                                                            |
| Laboratorio | Ejecuta agentes no-default en clones aislados.                                                                                   |
| Reportes    | Guarda corridas en `reports/lab-runs.jsonl`; `/config db_init` prepara la DB SQLite `reports/lab.db` para tracking estructurado. |
| Engram      | Puede buscar contexto y sincronizar reportes aprobados cuando Engram está disponible.                                            |
| Telegram UI | Reenvía confirmaciones y selecciones interactivas de Pi al chat.                                                                 |

## Requisitos

- Node.js con Corepack habilitado.
- Pi CLI instalado localmente.
- Token de bot creado con BotFather.
- Tu id numérico de Telegram desde `@userinfobot`.
- Windows para scripts `.bat` / PowerShell incluidos.

## Instalación

### Instalación rápida en Windows

```text
setup-pi-telegram-bridge.bat
```

Arranque normal:

```text
start-pi-telegram-bridge.bat
```

Apagado manual:

```text
stop-pi-telegram-bridge.bat
```

El script de arranque valida `.env`, instala dependencias si faltan, compila el proyecto e inicia el bot. El script de apagado solo cierra bridges abiertos de este proyecto.

### Instalación manual

```bash
corepack pnpm install
cp .env.example .env
```

Editá `.env` con tus valores reales:

```env
TELEGRAM_BOT_TOKEN=token_de_botfather
ALLOWED_USER_ID=123456789
DEFAULT_CWD=/ruta/absoluta/a/tu/proyecto
ALLOWED_ROOTS=/ruta/absoluta/a/tu/proyecto
PI_BIN=pi
PI_EXTRA_ARGS=--no-skill-registry --no-lens
PI_AGENT_PROFILES=default|Pi default
AGENT_WORKSPACE_ROOT=/ruta/absoluta/a/bridge-agents
AGENT_WORKSPACE_MODE=clone
```

Después ejecutá:

```bash
corepack pnpm dev
```

## Configuración guiada desde Telegram

`/config` es el instalador/mantenedor desde Telegram. Primero muestra diagnóstico; después podés ejecutar acciones puntuales.

| Comando                                            | Resultado                                                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `/config`                                          | Checklist del proyecto activo.                                                                                                   |
| `/config doctor`                                   | Diagnóstico detallado.                                                                                                           |
| `/config init_workspace`                           | Crea/verifica `reports/` y `workspaces/` bajo `AGENT_WORKSPACE_ROOT`.                                                            |
| `/config init_assets`                              | Crea assets project-local mínimos.                                                                                               |
| `/config init_project_config`                      | Crea `config/project-blueprint.json` y `config/project-flows.json` desde defaults si faltan; no sobreescribe configs existentes. |
| `/config inspect_project_map`                      | Inspecciona el mapa funcional cargado y reporta vacíos/inconsistencias sin escribir archivos ni usar IA.                         |
| `/config scan_project_map`                         | Escanea código real en modo read-only y compara elementos detectados contra `project-flows`.                                     |
| `/config suggest_project_flows`                    | Genera un borrador JSON parcial sugerido desde el escaneo, sin escribir `project-flows`.                                         |
| `/config draft_project_flows`                      | Guarda el borrador sugerido en `AGENT_WORKSPACE_ROOT/reports/` sin tocar `config/project-flows.json`.                            |
| `/config review_project_flows_draft [latest/ruta]` | Revisa un borrador guardado contra el `project-flows` actual sin aplicar cambios.                                                |
| `/config apply_project_flows_draft <ruta>`         | Aplica un borrador con ruta explícita, backup y validación final de `project-flows`.                                             |
| `/config skills_sync`                              | Copia solo skills necesarias desde el proyecto fuente registrado.                                                                |
| `/config db_init`                                  | Crea/actualiza `AGENT_WORKSPACE_ROOT/reports/lab.db`.                                                                            |
| `/config sync_commands`                            | Actualiza el menú de comandos de Telegram con `setMyCommands`.                                                                   |

Assets creados por `/config init_assets`:

```text
.agents/skills/.gitkeep
.atl/skill-registry.md
.mcp/config.json
```

Config project-local creada por `/config init_project_config` si falta:

```text
config/project-blueprint.json
config/project-flows.json
```

Reglas de seguridad:

- No ejecuta MCP automáticamente.
- No copia secretos.
- No commitea ni pushea.
- `skills_sync` copia solo skills necesarias/generalistas, no todo el proyecto fuente.

## Agentes y modelos

Configurá perfiles seleccionables con `PI_AGENT_PROFILES`:

```env
PI_AGENT_PROFILES=default|Pi default;codex|GPT Codex|--model openai-codex/gpt-5.3-codex-spark;spark|Spark|--model openai-codex/gpt-5.3-codex-spark
```

Formato:

```text
id|Nombre visible|argumentos extra opcionales;otro_id|Otro nombre|argumentos extra
```

En Telegram:

```text
/agents
```

La salida muestra label, id, provider y modelo:

```text
1. Pi default ✅
   id: default
   provider: pi
   model: Pi default

2. GPT Codex
   id: codex
   provider: pi
   model: openai-codex/gpt-5.3-codex-spark
```

Notas:

- El perfil 1/default trabaja directo sobre el repo real.
- Los perfiles no-default pueden correr como laboratorios en clones aislados si `AGENT_WORKSPACE_MODE=clone`.
- Cada perfil mantiene su propia sesión RPC persistente por proyecto.

## Laboratorios de tests

Los agentes lab corren en workspaces clone bajo:

```text
AGENT_WORKSPACE_ROOT/workspaces
```

Reportes y DB quedan bajo:

```text
AGENT_WORKSPACE_ROOT/reports
```

Comandos principales:

```text
/testlab quick
/testlab 3tests
/testlab 5tests
/testlab full
/testlab2 quick
/testlab3 quick
/gentest_model_lab
/reports
/report <id>
/triagereports
/syncreports
```

Profundidades:

| Profundidad | Uso recomendado                   |
| ----------- | --------------------------------- |
| `quick`     | Smoke test rápido.                |
| `3tests`    | Señal media sin gastar demasiado. |
| `5tests`    | Verificación más fuerte.          |
| `full`      | Revisión amplia, más lenta.       |

Decisiones sobre reportes:

```text
/report <id> defer
/report <id> work
/report <id> ignore
/report <id> save
```

`/syncreports` usa el orquestador para guardar hallazgos aprobados en Engram cuando Engram está disponible.

## Comandos operativos

### Estado y servidor RPC

```text
/status
/dashboard
/server status
/server run
/server restart
/server off
```

`/server` controla la sesión Pi RPC activa, no el proceso del bot de Telegram:

| Comando           | Acción                                         |
| ----------------- | ---------------------------------------------- |
| `/server status`  | Muestra bridge, RPC, proyecto y agente activo. |
| `/server run`     | Inicia o deja listo el RPC activo.             |
| `/server restart` | Reinicia solo la sesión RPC activa.            |
| `/server off`     | Detiene solo la sesión RPC activa.             |

Si el bot de Telegram está caído, no puede recibir comandos. Para recuperación completa usá el supervisor Windows o `start-pi-telegram-bridge.bat`.

### Trabajo diario

```text
/review
/fix_tests
/audit
/safe_push
/task bug <detalle>
/task feature <detalle>
/task refactor <detalle>
/task docs <detalle>
```

| Comando      | Uso                                                    |
| ------------ | ------------------------------------------------------ |
| `/review`    | Revisa cambios actuales sin commitear ni pushear.      |
| `/fix_tests` | Corre tests, identifica fallas y aplica fixes mínimos. |
| `/audit`     | Revisa repo público, secretos, artefactos y calidad.   |
| `/safe_push` | Checklist antes de push; no commitea ni pushea.        |
| `/task`      | Arma prompts operativos por tipo de tarea.             |

### Cola y cancelación

Si mandás mensajes mientras Pi está ocupado, Idu-pi los guarda en cola FIFO.

```text
/queue
/queue_clear
/cancel
```

`/cancel` cancela la tarea actual y limpia la cola.

### Trabajos recientes

```text
/trabajos
/ver T1
/nametrabajo T1 mantenimiento
/resume T1
/last
/resumen
```

Los trabajos usan selectores explícitos `T1`, `T2`, etc. También podés responder `A`, `activo` o `esta sesión` cuando el menú lo indique.

### Catálogo de comandos

```text
/comandos
/config sync_commands
```

- `/comandos` muestra el catálogo completo desde `src/command-catalog.ts`.
- `/config sync_commands` actualiza el menú nativo de Telegram desde esa misma fuente.

## Engram y memoria

Engram no viene de este repo; depende de que Pi tenga la herramienta/memoria disponible.

Cuando está disponible:

```text
/mem <query>
/syncreports
```

| Comando           | Uso                                                  |
| ----------------- | ---------------------------------------------------- |
| `/mem login auth` | Busca contexto histórico vía Pi/Engram.              |
| `/syncreports`    | Guarda reportes aprobados como memoria estructurada. |

Si Engram no está disponible, el bridge debe seguir funcionando con archivos locales (`lab-runs.jsonl`, `lab.db`, `.agents`, `.atl`, `.mcp`).

## Decisiones interactivas

Si Pi emite una solicitud de UI en RPC, el bridge la reenvía a Telegram.

Ejemplos:

- Confirmación: respondé `sí` o `no`.
- Selección: respondé `U1`, `U2`, etc.
- Texto libre: respondé con el texto solicitado.

Esto cubre aprobaciones tipo guarded command cuando Pi las expone como eventos RPC `extension_ui_request`.

## Supervisor Windows / auto-restart

Instalar e iniciar tarea programada:

```text
install-idu-pi-task.bat
```

Ver estado:

```text
status-idu-pi-task.bat
```

Desinstalar:

```text
uninstall-idu-pi-task.bat
```

La tarea se registra como `Idu-pi Telegram Bridge`, arranca al iniciar sesión y reintenta si el proceso falla. Los logs quedan en `logs/bridge.log`, ignorado por Git.

## Seguridad

- Nunca subas `.env`.
- Nunca subas tokens de bot, API keys, registros locales de proyectos ni estado runtime.
- Mantené `ALLOWED_ROOTS` lo más limitado posible.
- Usá `/mode interactive` para operaciones riesgosas.
- Pedí confirmación humana antes de push, copiar cambios desde labs o ejecutar MCP.

## Desarrollo

```bash
corepack pnpm build
corepack pnpm test
```

Comandos locales útiles:

```text
corepack pnpm install
corepack pnpm dev
corepack pnpm start
corepack pnpm clean
```

## Documentación

Este README sigue una estructura de baja carga cognitiva: camino rápido primero, detalles después, tablas para reconocimiento rápido y comandos copiables. Para futuras mejoras de documentación, usá la skill `cognitive-doc-design`.

# Idu-pi

Bridge de Telegram para controlar una sesión local de Pi desde un bot privado.

## Qué hace

- Acepta mensajes sólo desde `ALLOWED_USER_ID`.
- Envía prompts a una sesión persistente de Pi en modo RPC.
- Devuelve la salida de Pi al chat de Telegram.
- Permite elegir proyectos, agentes/modelos y trabajos recientes.
- Puede reenviar decisiones interactivas de Pi, por ejemplo confirmaciones tipo “Allow guarded command?”.
- Muestra mini reportes de avance mientras el orquestador trabaja.
- Mantiene secretos y estado local fuera de Git.

## Requisitos

- Node.js con Corepack habilitado.
- Pi CLI instalado localmente.
- Token de bot creado con BotFather.
- Tu id numérico de Telegram desde `@userinfobot`.

## Instalación rápida en Windows

Primera configuración:

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

## Instalación manual

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

## Uso en Telegram

```text
/doctor
/status
/dashboard
/server status
/server run
/server restart
/server off
/review
/fix_tests
/audit
/safe_push
/task bug el botón no responde
/task feature nuevo panel
/task refactor limpiar index
/task docs README
/queue
/queue_clear
/config
/comandos
/agents
/useproject
/trabajos
/ver T1
/nametrabajo T1 mantenimiento
/resume T1
/resumen
/mem login auth
/mode interactive
arreglá los tests de este proyecto
```

## Comandos principales

### `/comandos`

Muestra el catálogo completo generado desde una fuente única en el código: comandos para BotFather `/setcommands`, usos con argumentos, comandos CLI `pnpm`, batch directos y PowerShell directos. Usalo cuando se agreguen comandos nuevos para copiar la lista actualizada sin revisar archivos a mano.

### `/trabajos`

Lista trabajos recientes del proyecto activo. Los trabajos usan selectores explícitos como `T1`, `T2`, etc. También podés responder `A`, `activo` o `esta sesión` para seguir con el agente activo.

### `/dashboard`

Muestra un panel operativo breve con estado del bridge, RPC, proyecto, agente, workspace y comandos sugeridos.

### Comandos rápidos

Estos comandos lanzan prompts operativos prearmados contra el orquestador activo:

- `/review`: revisa cambios actuales sin commitear ni pushear.
- `/fix_tests`: corre tests, identifica fallas y aplica fixes mínimos.
- `/audit`: revisa preparación de repo público, secretos, artefactos y calidad.
- `/safe_push`: ejecuta un checklist local de modo guardián: estado git, rutas sensibles ignoradas, posibles secretos en archivos versionados y remoto configurado. No commitea ni pushea.

### Plantillas de tarea

`/task` arma un prompt operativo con disciplina según el tipo de trabajo:

```text
/task bug <síntoma o error>
/task feature <objetivo de producto>
/task refactor <área a mejorar>
/task docs <documento o tema>
```

Si falta el tipo o no es válido, el bot muestra ayuda breve.

### Configuración guiada

`/config` muestra un checklist del bridge y del proyecto activo. Sirve para validar proyecto, agentes, workspaces y assets versionables.

```text
/config
/config doctor
/config init_workspace
/config init_assets
/config skills_sync
/config db_init
/config sync_commands
```

`/config init_workspace` verifica/crea `reports/` y `workspaces/` bajo `AGENT_WORKSPACE_ROOT`.

`/config init_assets` crea estructura project-local mínima para skills y MCP:

```text
.agents/skills/.gitkeep
.atl/skill-registry.md
.mcp/config.json
```

`/config skills_sync` copia solo las skills necesarias para este bridge desde el proyecto fuente registrado `sistema_de_mantencion` y actualiza `.agents/skills/INDEX.md`.

`/config db_init` crea o actualiza la base SQLite de laboratorio en `AGENT_WORKSPACE_ROOT/reports/lab.db`.

`/config sync_commands` actualiza el menú de comandos de Telegram desde `src/command-catalog.ts` usando `setMyCommands`.

No ejecuta MCP, no copia secretos, no commitea y no pushea.

### Cola de tareas

Si mandás mensajes mientras Pi está ocupado, Idu-pi los guarda en una cola FIFO y los ejecuta cuando termina el turno actual.

```text
/queue       # ver cola actual
/queue_clear # limpiar cola
```

`/cancel` también limpia la cola.

### `/server status|run|restart|off`

Controla la sesión Pi RPC activa, no el proceso del bot de Telegram:

- `/server status`: muestra estado del bridge, RPC, proyecto y agente activo.
- `/server run`: inicia o deja listo el RPC activo sin mandar un prompt nuevo.
- `/server restart`: reinicia solo la sesión RPC activa.
- `/server off`: detiene solo la sesión RPC activa.

Nota: si el proceso del bot de Telegram está completamente caído, no puede recibir comandos. Para auto-recuperación completa usá el supervisor por tarea programada o `start-pi-telegram-bridge.bat`.

### Supervisor Windows / auto-restart

Instalar e iniciar la tarea programada:

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

La tarea se registra como `Idu-pi Telegram Bridge`, arranca al iniciar sesión y reintenta si el proceso falla. Si ya existe una tarea con el mismo nombre, el instalador la reemplaza; podés cambiar el nombre con `IDU_PI_TASK_NAME`. Los logs quedan en `logs/bridge.log`, que está ignorado por Git.

### Decisiones interactivas

Si Pi emite una solicitud de UI en RPC, el bridge la reenvía a Telegram. Ejemplos:

- confirmación: respondé `sí` o `no`;
- selección: respondé `U1`, `U2`, etc.;
- texto libre: respondé con el texto solicitado.

Esto cubre prompts de aprobación cuando Pi los expone como eventos RPC `extension_ui_request`.

### Mini reportes de avance

Mientras el orquestador trabaja, el bot puede enviar mensajes breves como:

```text
Orquestador trabajando: Pi default
Subtrabajo: usando bash...
Orquestador: cerrando respuesta y preparando resumen final...
```

La intención es dar visibilidad sin llenar el chat con cada token de salida.

## Laboratorios de tests

Los agentes lab corren en workspaces `clone`. El perfil default/direct queda excluido de ejecución lab.

```text
/testlab quick
/testlab2 3tests
/testlab3
/testlab1
/gentest_model_lab
/triagereports
/reports
/report <id>
/report <id> defer
/report <id> work
/report <id> ignore
/syncreports
```

Profundidades válidas: `quick`, `3tests`, `5tests`, `full`.

## Perfiles de agente/modelo

Configurá perfiles seleccionables de Pi con `PI_AGENT_PROFILES`:

```env
PI_AGENT_PROFILES=default|Pi default;codex|GPT Codex|--model provider/model
```

Formato:

```text
id|Nombre visible|argumentos extra opcionales;otro_id|Otro nombre|argumentos extra
```

Cada perfil Pi mantiene su propia sesión RPC persistente por proyecto.

## Seguridad

- Nunca subas `.env`.
- Nunca subas tokens de bot, API keys, registros locales de proyectos ni estado runtime.
- Mantené `ALLOWED_ROOTS` lo más limitado posible.
- Usá `/mode interactive` para operaciones riesgosas.

## Desarrollo

```bash
corepack pnpm build
corepack pnpm test
```

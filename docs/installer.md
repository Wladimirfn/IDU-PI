# Instalador, home CLI y estado por proyecto

`idu-pi` abre una entrada terminal simple para ver estado y elegir acciones sin memorizar comandos. `idu-pi setup` configura adapters globales y prepara estado aislado por proyecto. No es el núcleo: Idu-pi Core sigue siendo el supervisor; CLI, Telegram y MCP son adapters.

## Global config vs Project state

```text
Global Idu-pi config
├─ MCP config del agente Pi
├─ binarios CLI (`idu-pi`, `idu-pi-mcp`)
├─ Telegram adapter config
├─ modelos/perfiles del supervisor
└─ defaults de entorno

Project-local Idu-pi state
├─ projectId / projectPath
├─ reports
├─ lab.db
├─ tasks.jsonl
├─ idu-session-state.json
├─ semantic-audit/
├─ supervisor-learning-rules.json
└─ AgentLab reports
```

El estado mutable de proyectos enrolados vive bajo:

```text
AGENT_WORKSPACE_ROOT/projects/<safeProjectId>/
```

Ejemplo:

```text
AGENT_WORKSPACE_ROOT/
  projects/
    pi-telegram-bridge/
      reports/
      lab.db
      tasks.jsonl
      idu-session-state.json

    sistema-de-mantencion/
      reports/
      lab.db
      tasks.jsonl
      idu-session-state.json
```

Esto evita mezclar DB, reports, cola, sesión o memoria semántica entre proyectos.

## Bootstrap installer seguro

Cuando una terminal nueva responde `idu-pi: The term 'idu-pi' is not recognized`, el comando todavía no puede abrir su propio instalador. Para primera instalación usá el bootstrap externo:

```powershell
git clone https://github.com/Wladimirfn/IDU-PI.git idu-pi
cd idu-pi
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

También puede ejecutarse directo con Node:

```bash
node scripts/install.mjs
```

Antes de tocar nada:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -DryRun
# o
node scripts/install.mjs --dry-run
```

El instalador muestra versión, Node, Git, Corepack, pnpm, Pi agent dir, MCP config, `idu-pi` global, plan, comandos y rutas que tocaría.

Flags:

```text
--yes          acepta confirmaciones; para PATH requiere --add-path
--dry-run      muestra plan, comandos y archivos sin escribir
--no-mcp       omite setup mcp-init
--no-shim      omite shim idu-pi local
--open-wizard  abre node dist/src/cli.js al final
--add-path     agrega el shim al PATH de usuario si falta; con --yes no pregunta
--help         muestra ayuda
```

Acciones que sólo ocurren con confirmación o `--yes`:

1. `corepack enable` sólo si `pnpm` no está disponible
2. `corepack pnpm install --frozen-lockfile --ignore-scripts`
3. `corepack pnpm build`
4. `node dist/src/cli.js -- setup mcp-init`
5. crear shim local `idu-pi.cmd` / `idu-pi.ps1`
6. abrir wizard si se pidió `--open-wizard`

El shim local se crea en:

```text
C:\Users\<user>\AppData\Local\idu-pi\bin
```

Si esa carpeta ya está en `PATH`, `idu-pi` queda disponible y el instalador informa:

```text
PATH ya contiene: C:\Users\<user>\AppData\Local\idu-pi\bin
PATH no modificado porque ya estaba configurado.
```

Si falta, el instalador pregunta si querés agregarla al `PATH` de usuario. Para aceptarlo de forma explícita sin segunda pregunta:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Yes -AddPath
# o
node scripts/install.mjs --yes --add-path
```

Luego cerrá y abrí una terminal nueva antes de usar `idu-pi`.

Si un shim existente cambiaría, crea backup antes de sobrescribir:

```text
idu-pi.backup-YYYYMMDD-HHMMSS.cmd
idu-pi.backup-YYYYMMDD-HHMMSS.ps1
```

Guía corta: [Instalación rápida segura](quickstart-install.md).

## Home CLI

```bash
idu-pi
# o desde el repo
corepack pnpm cli
```

Muestra:

- versión de Idu-pi;
- `cwd`/proyecto candidato;
- estado de `node`, `git` y MCP `idu-pi`;
- si el proyecto actual está enrolado;
- `stateRoot` cuando existe;
- supervisor `active/inactive` cuando hay estado local;
- estado básico de Project Core;
- comandos recomendados;
- pantalla de configuración con package root, Pi agent dir, MCP config, extensión slash y registry;
- submenu Telegram remoto con estado, configuración `.env` con backup, instrucciones de sincronización, ciclo de vida start/stop/restart y logs;
- submenu modelos/perfiles con edición de `PI_AGENT_PROFILES` en `.env` con backup y asignaciones por rol en `stateRoot/model-assignments.json`;
- ayuda si el bin global de pnpm no está en `PATH`.

Si stdin/stdout son interactivos, muestra el logo y un único menú principal:

1. Configurar IDU-Pi
2. Proyecto actual
3. Telegram remoto
4. Modelos y perfiles
5. Supervisor
6. Tareas y cola
7. Diagnóstico
8. Exit

La opción **Configurar IDU-Pi** abre un submenú seguro:

1. Verificar sistema
2. Instalar/actualizar MCP en Pi
3. Instalar/actualizar comandos slash globales
4. Enrolar proyecto actual
5. Activar supervisor en este proyecto
6. Volver

Las opciones que escriben archivos o activan guardrails piden confirmación antes de ejecutar. Si stdin no es interactivo, imprime resumen y termina sin esperar input ni escribir archivos.

## Setup status y wizard

```bash
corepack pnpm cli -- setup status
corepack pnpm cli -- setup wizard
corepack pnpm cli -- setup path-help
# o
idu-pi setup status
idu-pi setup wizard
idu-pi setup path-help
```

Muestra:

- sistema operativo y shell;
- herramientas disponibles (`node`, `npm`, `pnpm`, `git`, `curl`);
- configs detectadas de Pi/Claude Code/OpenCode/Codex/Cursor/Windsurf;
- si MCP `idu-pi` parece configurado;
- acciones recomendadas.

`idu-pi setup` sin subcomando equivale a `setup status`. `idu-pi setup wizard` abre el mismo wizard si la terminal es interactiva; en modo no interactivo muestra instrucciones, no espera input y no escribe archivos.

## Montar MCP y comandos Pi

Recomendado:

```bash
corepack pnpm cli -- setup mcp-init
```

Esto deja Pi listo globalmente: escribe el MCP y también instala el espejo de comandos slash para que `/idu` y el resto de comandos Idu-pi aparezcan al abrir `pi` desde cualquier proyecto.

```text
PI_CODING_AGENT_DIR/mcp.json
PI_CODING_AGENT_DIR/extensions/idu-pi-commands.ts
# o
~/.pi/agent/mcp.json
~/.pi/agent/extensions/idu-pi-commands.ts
```

Agrega o preserva:

```json
{
  "mcpServers": {
    "idu-pi": {
      "command": "node",
      "args": ["C:\\...\\dist\\src\\mcp-server.js"],
      "cwd": "C:\\...\\idu-pi",
      "lifecycle": "lazy",
      "directTools": true
    }
  }
}
```

Reglas:

- preserva otros `mcpServers`;
- no reemplaza `mcpServers["idu-pi"]` si ya existe, salvo `--force`;
- instala/verifica `extensions/idu-pi-commands.ts` para comandos slash globales;
- crea backup `mcp.backup-YYYYMMDD-HHMMSS.json` antes de modificar un config existente;
- crea backup `extensions/idu-pi-commands.backup-YYYYMMDD-HHMMSS.ts` antes de sobrescribir una extensión global existente con contenido distinto;
- `setup mcp-print` imprime config sin escribir;
- `setup mcp-init --dry-run` calcula sin escribir.

Comandos:

```bash
idu-pi setup mcp-print
idu-pi setup mcp-init
idu-pi setup mcp-init --force
idu-pi setup mcp-init --dry-run
```

## Enrolar un proyecto

```bash
idu-pi project enroll "C:\\Users\\elmas\\OneDrive\\Escritorio\\Mis proyectos\\Sistema_de_mantencion"
```

Opcionalmente podés pasar `projectId`:

```bash
idu-pi project enroll "C:\\...\\Sistema_de_mantencion" sistema-de-mantencion
```

El enrolamiento manual:

- valida que la ruta exista y esté dentro de `ALLOWED_ROOTS`;
- registra el proyecto en el registry existente;
- crea `AGENT_WORKSPACE_ROOT/projects/<projectId>/`;
- no corre scan pesado;
- no toca código del proyecto externo.

Normalmente no necesitás enrolar a mano desde CLI: al ejecutar `/idu` dentro de Pi, Idu-pi enrola el proyecto permitido, crea estado aislado, genera Project Core/Constitution draft y ejecuta preparación segura inicial.

Desde MCP la separación es explícita:

- `idu_project_status` sólo lee estado.
- `idu_project_enroll` registra y crea estado aislado, sin drafts.
- `idu_bootstrap_project` crea drafts sólo con `allowCreateDrafts=true`.
- `idu_start` activa proyectos ya registrados, pero no enrola automáticamente.

## Ver estado de proyecto

```bash
idu-pi project status "C:\\...\\Sistema_de_mantencion"
idu-pi project state-path "C:\\...\\Sistema_de_mantencion"
```

`project status` muestra:

- `projectId`;
- `projectPath`;
- `registered/unregistered`;
- `stateRoot`;
- `labDbPath`;
- `reportsDir`;
- disponibilidad MCP;
- siguiente paso recomendado.

## PATH / instalación global

Si `corepack pnpm link --global` falla con:

```text
The configured global bin directory ... is not in PATH
```

usá:

```bash
idu-pi setup path-help
```

La ayuda explica dos entradas:

- primera vez desde el repo: `corepack pnpm cli` o `node dist/src/cli.js`;
- uso normal después del link global: `idu-pi`.

También muestra cómo instalar el bin global:

1. `corepack pnpm setup`
2. cerrar y abrir una terminal nueva
3. `corepack pnpm link --global`

Idu-pi no modifica `PATH` automáticamente.

## Seguridad

El home y el wizard no ejecutan acciones destructivas por mostrarse. Sólo escriben si elegís explícitamente una acción como instalar MCP o enrolar proyecto, y el menú interactivo pide confirmación antes de esas escrituras.

El instalador no ejecuta bootstrap remoto opaco ni scripts de dependencias: usa `pnpm-lock.yaml` con `--frozen-lockfile --ignore-scripts`; pnpm puede descargar paquetes fijados desde el registry/cache configurado. El repo suma defensa local contra `postinstall`: `.npmrc` para npm/compatibles y `pnpm-workspace.yaml` para pnpm 11 (`ignoreScripts`, `minimumReleaseAge`, `strictDepBuilds`, `onlyBuiltDependencies: []`). `package.json` usa versiones exactas; evitá `latest`, `^` y `~`. No usa `irm | iex`, no modifica `PATH` sin confirmación interactiva o `--add-path`, no lee ni muestra secretos de `.env`, no ejecuta Telegram, AgentLabs, IA externa, scans pesados, enrolamiento de proyectos, Project Core, commits ni pushes. Sólo configura adapters globales cuando lo confirmás explícitamente.

Telegram es un adapter, no el núcleo. MCP también es un adapter. El núcleo es Idu-pi Core.

# Instalación rápida segura de Idu-pi

Esta guía es para una máquina nueva donde `idu-pi` todavía no existe en `PATH`.

## Flujo recomendado

```powershell
git clone https://github.com/Wladimirfn/IDU-PI.git idu-pi
cd idu-pi
powershell -ExecutionPolicy Bypass -File scripts/install.ps1
```

Después de completar el instalador, probá:

```powershell
idu-pi
```

Si Windows todavía no encuentra `idu-pi`, usá mientras tanto:

```powershell
node dist/src/cli.js
```

y agregá al `PATH` la ruta que muestra el instalador, normalmente:

```text
C:\Users\<user>\AppData\Local\idu-pi\bin
```

El instalador no modifica `PATH` salvo confirmación interactiva o `--add-path` / `-AddPath` explícito. Si no se autorizó ese cambio, informa: **No modifiqué PATH automáticamente.**

## Dry-run

Antes de escribir o ejecutar acciones, podés inspeccionar el plan:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -DryRun
# o
node scripts/install.mjs --dry-run
```

Dry-run muestra:

- herramientas detectadas;
- comandos que ejecutaría;
- archivos/rutas que tocaría;
- estado de MCP, Pi agent dir y shim;
- ninguna escritura.

## Flags

```text
--yes          acepta confirmaciones del instalador; para PATH requiere --add-path
--dry-run      muestra plan sin escribir
--no-mcp       omite setup mcp-init
--no-shim      omite shim local idu-pi
--open-wizard  abre node dist/src/cli.js al final
--add-path     agrega el shim al PATH de usuario si falta; con --yes no pregunta
--help         muestra ayuda
```

En PowerShell usá los equivalentes:

```powershell
-DryRun
-Yes
-NoMcp
-NoShim
-OpenWizard
-AddPath
-Help
```

## Qué hace

Con confirmación humana, el instalador puede:

1. ejecutar `corepack enable` sólo si `pnpm` no está disponible;
2. ejecutar `corepack pnpm install --frozen-lockfile --ignore-scripts`;
3. ejecutar `corepack pnpm build`;
4. ejecutar `node dist/src/cli.js -- setup mcp-init` para MCP y comandos slash globales de Pi;
5. crear un shim local `idu-pi.cmd` y `idu-pi.ps1`;
6. abrir el wizard con `node dist/src/cli.js` si pasás `--open-wizard`.

## Shim local

El shim vive en:

```text
C:\Users\<user>\AppData\Local\idu-pi\bin
```

Archivos:

```text
idu-pi.cmd
idu-pi.ps1
```

Ambos llaman a:

```text
node "<repo>\dist\src\cli.js"
```

Si el shim ya existe y cambiaría, primero crea backup:

```text
idu-pi.backup-YYYYMMDD-HHMMSS.cmd
idu-pi.backup-YYYYMMDD-HHMMSS.ps1
```

Si el contenido ya es igual, no crea backup.

## PATH

Si la carpeta del shim ya está en `PATH`, el instalador informa:

```text
PATH ya contiene: C:\Users\<user>\AppData\Local\idu-pi\bin
PATH no modificado porque ya estaba configurado.
```

Si falta, en modo interactivo pregunta si querés agregarla al `PATH` de usuario. Para hacerlo sin segunda pregunta:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -Yes -AddPath
# o
node scripts/install.mjs --yes --add-path
```

Después de actualizar el `PATH` de usuario, cerrá y abrí una terminal nueva antes de ejecutar `idu-pi`.

## Garantías de seguridad

- No ejecuta bootstrap remoto opaco ni scripts de dependencias.
- Usa `pnpm-lock.yaml` con `--frozen-lockfile --ignore-scripts`; pnpm puede descargar paquetes fijados desde el registry/cache configurado.
- Mantiene defensa repo-local contra `postinstall`: `.npmrc` para npm/compatibles y `pnpm-workspace.yaml` para pnpm 11 (`ignoreScripts`, `minimumReleaseAge`, `strictDepBuilds`, `onlyBuiltDependencies: []`).
- Usa versiones exactas en `package.json`; evitá `latest`, `^` y `~` para dependencias runtime/dev.
- No usa `irm | iex`.
- No modifica `PATH` sin confirmación interactiva o `--add-path` explícito.
- No lee ni muestra secretos de `.env`.
- No ejecuta Telegram.
- No ejecuta AgentLabs.
- No enrola proyectos automáticamente.
- No crea Project Core.
- No toca código de proyectos externos.
- No hace commit, push, merge ni rebase.

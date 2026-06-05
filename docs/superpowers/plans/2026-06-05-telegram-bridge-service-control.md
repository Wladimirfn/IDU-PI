# Telegram Bridge Service Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Telegram bridge behave like a controllable local service: `/reset` and `/server restart` request a full bridge restart, startup sends Telegram status, and server commands do not claim impossible behavior when the bridge is stopped.

**Architecture:** Add small testable service-control units around the existing bridge lifecycle scripts. Telegram writes a restart intent and launches a deterministic external helper; a new startup notifier consumes the intent after bot initialization and sends status. Keep destructive Idu-pi reset separate.

**Tech Stack:** TypeScript, Node test runner, Telegram bot handlers in `src/index.ts`, Windows PowerShell scripts, existing `.bat` wrappers.

---

## File Structure

- Create: `src/bridge-control.ts` — intent persistence, startup status formatting, bridge-control command construction.
- Modify: `src/bridge-lifecycle.ts` — route restart/off through `scripts/bridge-control.ps1` where appropriate and update replies.
- Modify: `src/telegram-ui.ts` — parse `/server reset` if needed and clarify server command semantics.
- Modify: `src/telegram-command-registry.ts` — expose `/reset`.
- Modify: `src/command-catalog.ts` — document `/reset` and revised `/server` semantics.
- Modify: `src/index.ts` — add `/reset`, revise `/server`, call startup notifier after bot start/init.
- Create: `scripts/bridge-control.ps1` — deterministic external helper for `status|restart|stop`.
- Test: `test/bridge-control.test.ts` — intent/status/helper command behavior.
- Modify: `test/bridge-lifecycle.test.ts` — helper command path and reply text.
- Modify: `test/telegram-ui.test.ts` — `/server reset` parsing and run/off wording expectations.
- Modify: `test/command-catalog.test.ts` if needed by registry/catalog parity.

## Task 1: Add bridge-control intent and status formatting

**Files:**
- Create: `src/bridge-control.ts`
- Create: `test/bridge-control.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/bridge-control.test.ts`:

```ts
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	buildBridgeControlCommand,
	consumeBridgeControlIntent,
	formatBridgeStartupStatus,
	writeBridgeControlIntent,
} from "../src/bridge-control.js";

test("bridge control intent is written and consumed once", () => {
	const dir = mkdtempSync(join(tmpdir(), "bridge-control-"));
	try {
		const path = join(dir, "intent.json");
		writeBridgeControlIntent(path, {
			type: "restart",
			origin: "telegram",
			chatId: 123,
			reason: "/reset",
			notifyOnStartup: true,
			requestedAt: "2026-06-05T00:00:00.000Z",
		});
		assert.match(readFileSync(path, "utf8"), /"chatId": 123/);
		assert.deepEqual(consumeBridgeControlIntent(path), {
			type: "restart",
			origin: "telegram",
			chatId: 123,
			reason: "/reset",
			notifyOnStartup: true,
			requestedAt: "2026-06-05T00:00:00.000Z",
		});
		assert.equal(consumeBridgeControlIntent(path), undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("startup status contains service evidence without destructive reset claims", () => {
	const text = formatBridgeStartupStatus({
		origin: "reset",
		pid: 42,
		projectLabel: "idu-pi",
		currentCwd: "C:/repo",
		agentLabel: "openai-codex",
		rpcRunning: false,
		iduActive: true,
		telegramCommandCount: 88,
		now: new Date("2026-06-05T00:00:00.000Z"),
	});
	assert.match(text, /Bridge iniciado/i);
	assert.match(text, /Origen: reset/i);
	assert.match(text, /PID: 42/i);
	assert.match(text, /Proyecto: idu-pi/i);
	assert.match(text, /Idu-pi: activo/i);
	assert.match(text, /Comandos Telegram: 88/i);
	assert.doesNotMatch(text, /stateRoot borrado/i);
});

test("bridge control command launches deterministic helper", () => {
	const command = buildBridgeControlCommand("restart", "C:\\bridge");
	assert.equal(command.file, "cmd.exe");
	assert.deepEqual(command.args, [
		"/c",
		"start",
		'"pi-telegram-bridge-control"',
		"cmd.exe",
		"/c",
		"powershell",
		"-NoProfile",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		"C:\\bridge\\scripts\\bridge-control.ps1",
		"restart",
	]);
	assert.equal(command.cwd, "C:\\bridge");
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
corepack pnpm build && node --test dist/test/bridge-control.test.js
```

Expected: FAIL because `src/bridge-control.ts` does not exist.

- [ ] **Step 3: Implement minimal bridge-control module**

Create `src/bridge-control.ts`:

```ts
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type BridgeControlAction = "status" | "restart" | "stop";

export type BridgeControlCommand = {
	file: string;
	args: string[];
	cwd: string;
};

export type BridgeControlIntent = {
	type: "restart" | "stop";
	origin: "telegram" | "manual" | "scheduled-task" | "unknown";
	chatId?: number;
	reason?: string;
	notifyOnStartup: boolean;
	requestedAt: string;
};

export type BridgeStartupStatusInput = {
	origin: BridgeControlIntent["origin"] | "reset";
	pid: number;
	projectLabel: string;
	currentCwd: string;
	agentLabel: string;
	rpcRunning: boolean;
	iduActive: boolean;
	telegramCommandCount: number;
	now: Date;
};

const powershellArgs = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass"];

function cmdStartTitle(title: string): string {
	return `"${title}"`;
}

export function buildBridgeControlCommand(
	action: BridgeControlAction,
	root: string,
): BridgeControlCommand {
	return {
		file: "cmd.exe",
		args: [
			"/c",
			"start",
			cmdStartTitle("pi-telegram-bridge-control"),
			"cmd.exe",
			"/c",
			...powershellArgs,
			"-File",
			join(root, "scripts", "bridge-control.ps1"),
			action,
		],
		cwd: root,
	};
}

export function launchBridgeControl(action: BridgeControlAction, root: string): void {
	const command = buildBridgeControlCommand(action, root);
	const child = spawn(command.file, command.args, {
		cwd: command.cwd,
		detached: true,
		stdio: "ignore",
		windowsHide: false,
	});
	child.unref();
}

export function writeBridgeControlIntent(
	path: string,
	intent: BridgeControlIntent,
): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(intent, null, 2)}\n`, "utf8");
}

export function consumeBridgeControlIntent(
	path: string,
): BridgeControlIntent | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		rmSync(path, { force: true });
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return undefined;
		}
		const record = parsed as Record<string, unknown>;
		if (record.type !== "restart" && record.type !== "stop") return undefined;
		if (
			record.origin !== "telegram" &&
			record.origin !== "manual" &&
			record.origin !== "scheduled-task" &&
			record.origin !== "unknown"
		) {
			return undefined;
		}
		if (typeof record.notifyOnStartup !== "boolean") return undefined;
		if (typeof record.requestedAt !== "string") return undefined;
		return {
			type: record.type,
			origin: record.origin,
			chatId: typeof record.chatId === "number" ? record.chatId : undefined,
			reason: typeof record.reason === "string" ? record.reason : undefined,
			notifyOnStartup: record.notifyOnStartup,
			requestedAt: record.requestedAt,
		};
	} catch {
		try {
			rmSync(path, { force: true });
		} catch {
			// best effort cleanup only
		}
		return undefined;
	}
}

export function formatBridgeStartupStatus(input: BridgeStartupStatusInput): string {
	return [
		"✅ Bridge iniciado",
		"",
		`Estado: activo`,
		`Origen: ${input.origin}`,
		`PID: ${input.pid}`,
		`Proyecto: ${input.projectLabel}`,
		`Proyecto target: ${input.currentCwd}`,
		`Pi/orquestador: ${input.rpcRunning ? "iniciado" : "en espera"}`,
		`Agente: ${input.agentLabel}`,
		`Idu-pi: ${input.iduActive ? "activo" : "inactivo"}`,
		`Comandos Telegram: ${input.telegramCommandCount}`,
		`Hora: ${input.now.toISOString()}`,
	].join("\n");
}
```

- [ ] **Step 4: Run the test to verify GREEN**

Run:

```bash
corepack pnpm build && node --test dist/test/bridge-control.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/bridge-control.ts test/bridge-control.test.ts
git commit -m "feat(bridge): add service control intent"
```

## Task 2: Add deterministic PowerShell bridge-control helper

**Files:**
- Create: `scripts/bridge-control.ps1`
- Modify: `test/bridge-lifecycle.test.ts`
- Modify: `src/bridge-lifecycle.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Update `test/bridge-lifecycle.test.ts` with a new test:

```ts
test("restart lifecycle uses bridge-control helper", () => {
	const command = buildBridgeLifecycleCommand("restart", "C:\\bridge");
	assert.equal(command.file, "cmd.exe");
	assert.deepEqual(command.args, [
		"/c",
		"start",
		'"pi-telegram-bridge-control"',
		"cmd.exe",
		"/c",
		"powershell",
		"-NoProfile",
		"-ExecutionPolicy",
		"Bypass",
		"-File",
		"C:\\bridge\\scripts\\bridge-control.ps1",
		"restart",
	]);
});
```

- [ ] **Step 2: Run failing lifecycle test**

```bash
corepack pnpm build && node --test dist/test/bridge-lifecycle.test.js
```

Expected: FAIL because restart still launches `start-bridge.ps1` directly.

- [ ] **Step 3: Update lifecycle command**

Modify `src/bridge-lifecycle.ts` so `restart` uses `buildBridgeControlCommand("restart", root)` from `src/bridge-control.ts`, while `run` keeps `start-bridge.ps1` and `off` keeps stop behavior until Task 4 finalizes semantics.

Code shape:

```ts
import { spawn } from "node:child_process";
import { join } from "node:path";
import { buildBridgeControlCommand } from "./bridge-control.js";

export type BridgeLifecycleAction = "run" | "restart" | "off";

export function buildBridgeLifecycleCommand(
	action: BridgeLifecycleAction,
	root: string,
): BridgeLifecycleCommand {
	if (action === "restart") return buildBridgeControlCommand("restart", root);
	// existing run/off code remains
}
```

- [ ] **Step 4: Create helper script**

Create `scripts/bridge-control.ps1`:

```powershell
param(
  [ValidateSet('status', 'restart', 'stop')]
  [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $Root
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogFile = Join-Path $LogDir 'bridge-control.log'

function Log($Message) {
  $line = "$(Get-Date -Format o) $Message"
  Add-Content -Path $LogFile -Value $line
  Write-Host $Message
}

function Get-BridgeProcesses {
  $distIndex = [System.IO.Path]::GetFullPath((Join-Path $Root 'dist/src/index.js'))
  $distIndexSlash = $distIndex.Replace('\', '/')
  $rootText = ([string]$Root).TrimEnd('\')
  $rootSlash = $rootText.Replace('\', '/')

  Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and
      $_.Name -match '^(node|node\.exe)$' -and
      $_.CommandLine -and (
        $_.CommandLine.Contains($distIndex) -or
        $_.CommandLine.Contains($distIndexSlash) -or
        ($_.CommandLine.Contains($rootText) -and $_.CommandLine.Contains('dist/src/index.js')) -or
        ($_.CommandLine.Contains($rootSlash) -and $_.CommandLine.Contains('dist/src/index.js'))
      )
    }
}

function Stop-BridgeProcesses {
  $matches = @(Get-BridgeProcesses)
  if ($matches.Count -eq 0) {
    Log 'No bridge processes found.'
    return
  }
  foreach ($process in $matches) {
    Log "Stopping bridge PID $($process.ProcessId)"
    Stop-Process -Id $process.ProcessId -Force
  }
}

if ($Action -eq 'status') {
  $matches = @(Get-BridgeProcesses)
  Log "Bridge process count: $($matches.Count)"
  foreach ($process in $matches) { Log "PID $($process.ProcessId): $($process.CommandLine)" }
  exit 0
}

if ($Action -eq 'stop') {
  Stop-BridgeProcesses
  exit 0
}

if ($Action -eq 'restart') {
  Log 'Restart requested.'
  Start-Sleep -Seconds 2
  Stop-BridgeProcesses
  Log 'Starting bridge via scripts/start-bridge.ps1'
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'scripts/start-bridge.ps1')
  exit $LASTEXITCODE
}
```

- [ ] **Step 5: Run lifecycle tests**

```bash
corepack pnpm build && node --test dist/test/bridge-lifecycle.test.js dist/test/bridge-control.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/bridge-lifecycle.ts scripts/bridge-control.ps1 test/bridge-lifecycle.test.ts
git commit -m "feat(bridge): add deterministic restart helper"
```

## Task 3: Add Telegram startup status notification seam

**Files:**
- Modify: `src/index.ts`
- Modify: `src/bridge-control.ts`
- Modify: `test/bridge-control.test.ts`

- [ ] **Step 1: Write failing formatter/input test**

Append to `test/bridge-control.test.ts`:

```ts
test("startup status can be built from a consumed restart intent", () => {
	const text = formatBridgeStartupStatus({
		origin: "telegram",
		pid: 99,
		projectLabel: "idu-pi",
		currentCwd: "C:/repo",
		agentLabel: "codex",
		rpcRunning: true,
		iduActive: false,
		telegramCommandCount: 91,
		now: new Date("2026-06-05T00:00:00.000Z"),
	});
	assert.match(text, /Origen: telegram/);
	assert.match(text, /Pi\/orquestador: iniciado/);
	assert.match(text, /Idu-pi: inactivo/);
});
```

- [ ] **Step 2: Run focused tests**

```bash
corepack pnpm build && node --test dist/test/bridge-control.test.js
```

Expected: PASS if Task 1 formatter already supports this; if not, fix formatter only.

- [ ] **Step 3: Wire startup notification in `src/index.ts`**

After bot initialization/startup succeeds, call a helper that:

```ts
const intent = consumeBridgeControlIntent(bridgeControlIntentPath());
if (intent?.notifyOnStartup && intent.chatId) {
	await bot.api.sendMessage(intent.chatId, formatBridgeStartupStatus({
		origin: intent.origin,
		pid: process.pid,
		projectLabel: activeProjectLabel(),
		currentCwd,
		agentLabel: agentRouter.activeRuntime().profile.label,
		rpcRunning: agentRouter.activeRuntime().session.running,
		iduActive: currentIduSessionState().active,
		telegramCommandCount: PUBLIC_TELEGRAM_HANDLER_COMMANDS.length,
		now: new Date(),
	}));
}
```

If `currentIduSessionState()` does not exist, use the existing session state reader from `src/idu-session.ts` or add a tiny wrapper in `index.ts` that reads the same state already used by `/idu_status`.

- [ ] **Step 4: Run focused test and typecheck**

```bash
corepack pnpm build && node --test dist/test/bridge-control.test.js
```

Expected: PASS and build succeeds.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/index.ts src/bridge-control.ts test/bridge-control.test.ts
git commit -m "feat(bridge): notify telegram on startup"
```

## Task 4: Wire `/reset` and revise `/server` semantics

**Files:**
- Modify: `src/telegram-ui.ts`
- Modify: `src/telegram-command-registry.ts`
- Modify: `src/command-catalog.ts`
- Modify: `src/index.ts`
- Modify: `test/telegram-ui.test.ts`
- Modify: `test/command-catalog.test.ts` if registry/catalog parity fails

- [ ] **Step 1: Write failing parser test**

Update `test/telegram-ui.test.ts`:

```ts
test("parseServerCommand accepts reset as restart alias", () => {
	assert.equal(parseServerCommand("/server reset"), "restart");
	assert.equal(parseServerCommand("/server restart"), "restart");
});
```

- [ ] **Step 2: Run failing parser test**

```bash
corepack pnpm build && node --test dist/test/telegram-ui.test.js
```

Expected: FAIL because `reset` is not parsed.

- [ ] **Step 3: Update parser**

Modify `src/telegram-ui.ts`:

```ts
export type ServerCommand = "run" | "restart" | "off" | "status";

export function parseServerCommand(text: string): ServerCommand | undefined {
	const [, rawArg = "status"] =
		text.trim().match(/^\/server(?:\s+(\S+))?/iu) ?? [];
	const arg = rawArg.toLowerCase();
	if (arg === "reset") return "restart";
	if (arg === "run" || arg === "restart" || arg === "off" || arg === "status")
		return arg;
	return undefined;
}
```

- [ ] **Step 4: Add `/reset` registry/catalog entries**

Modify `src/telegram-command-registry.ts` to include:

```ts
"reset",
```

Modify `src/command-catalog.ts` server entry to say:

```ts
help: "/reset o /server restart - reiniciar bridge completo; /server status - ver estado; /server off - apagar bridge",
usage: ["/reset", "/server status", "/server restart", "/server off"],
```

- [ ] **Step 5: Wire handlers in `src/index.ts`**

Add a shared helper inside `index.ts`:

```ts
async function requestBridgeRestart(ctx: Context, reason: string): Promise<void> {
	writeBridgeControlIntent(bridgeControlIntentPath(), {
		type: "restart",
		origin: "telegram",
		chatId: ctx.chat?.id,
		reason,
		notifyOnStartup: true,
		requestedAt: new Date().toISOString(),
	});
	await ctx.reply("Reinicio completo del bridge solicitado. Si todo sale bien, voy a volver con un status de arranque.");
	clearPendingUiRequest();
	agentRouter.stopActive();
	launchBridgeControl("restart", root);
}
```

Then add:

```ts
bot.command("reset", async (ctx) => {
	if (!(await guard(ctx))) return;
	await requestBridgeRestart(ctx, "/reset");
});
```

Update `/server`:

```ts
if (command === "run") {
	const runtime = agentRouter.startActive();
	await ctx.reply(
		`Bridge ya está activo; /server run sólo prepara la sesión Pi interna.\nAgente: ${runtime.profile.label}\nWorkspace: ${runtime.cwd}\nSi el bridge estuviera apagado, Telegram no podría recibir este comando.`,
	);
	return;
}
if (command === "restart") {
	await requestBridgeRestart(ctx, "/server restart");
	return;
}
if (command === "off") {
	await ctx.reply("Apagando bridge completo. Telegram no puede volver a iniciarlo salvo que uses start-pi-telegram-bridge.bat, scheduled task o watchdog.");
	clearPendingUiRequest();
	agentRouter.stopActive();
	launchBridgeControl("stop", root);
	return;
}
```

Use the actual project root variable already available in `index.ts`; if no `root` variable exists, derive it consistently with existing lifecycle code.

- [ ] **Step 6: Run focused tests**

```bash
corepack pnpm build && node --test dist/test/telegram-ui.test.js dist/test/command-catalog.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/telegram-ui.ts src/telegram-command-registry.ts src/command-catalog.ts src/index.ts test/telegram-ui.test.ts test/command-catalog.test.ts
git commit -m "feat(bridge): add telegram reset control"
```

## Task 5: Full verification, postflight, review, and push

**Files:**
- No new files unless tests reveal required fixes.

- [ ] **Step 1: Run LSP diagnostics**

Run diagnostics on changed TS files:

```text
lsp_diagnostics for src/bridge-control.ts, src/bridge-lifecycle.ts, src/telegram-ui.ts, src/index.ts, src/command-catalog.ts, src/telegram-command-registry.ts, tests changed
```

Expected: 0 diagnostics.

- [ ] **Step 2: Run full local gate**

```bash
corepack pnpm build && corepack pnpm test && git diff --check
```

Expected: all tests pass, 0 failures, whitespace check clean.

- [ ] **Step 3: Run Idu-pi postflight**

Use expected files:

```text
src/bridge-control.ts
src/bridge-lifecycle.ts
src/telegram-ui.ts
src/index.ts
src/command-catalog.ts
src/telegram-command-registry.ts
scripts/bridge-control.ps1
test/bridge-control.test.ts
test/bridge-lifecycle.test.ts
test/telegram-ui.test.ts
test/command-catalog.test.ts
docs/superpowers/specs/2026-06-05-telegram-bridge-service-control-design.md
docs/superpowers/plans/2026-06-05-telegram-bridge-service-control.md
```

Expected: advisory may warn because service control is high-risk; no blocker from unexpected files except local `context.md`, which remains uncommitted and intentionally ignored.

- [ ] **Step 4: Fresh reviewer**

Ask a fresh reviewer to audit:

```text
Review Telegram bridge service-control diff. Check that /reset and /server restart request full bridge restart through deterministic helper, startup notification is safe, /server run does not claim impossible stopped-bridge startup, /server off warns correctly, process matching is repo-scoped, no destructive stateRoot/repo reset, no broad Pi/Node kill, no AgentLab/web/dependency behavior.
```

Expected: PASS or fix concrete blockers.

- [ ] **Step 5: Push after PASS**

```bash
git status --short
git push
```

Expected: branch `feat/idu-context-pressure` pushed. `context.md` remains local-only.

---

## Self-Review

Spec coverage:
- `/reset` full bridge restart: Task 4.
- Startup status: Task 3.
- Deterministic helper: Task 2.
- `/server run` impossible behavior clarified: Task 4.
- Recovery prompt fallback: covered in committed design spec, no runtime implementation needed.
- No destructive Idu-pi reset: Task 4 handler semantics and Task 5 review.
- Tests: Tasks 1-5.

Placeholder scan:
- No TBD/TODO placeholders are present.
- One implementation note requires using the actual root variable in `src/index.ts`; this is deliberate because the current file already owns runtime root/config context and the worker must bind to the existing variable rather than invent a duplicate.

Type consistency:
- `BridgeControlAction`, `BridgeControlIntent`, `buildBridgeControlCommand`, `launchBridgeControl`, `writeBridgeControlIntent`, `consumeBridgeControlIntent`, and `formatBridgeStartupStatus` are introduced in Task 1 and reused consistently later.

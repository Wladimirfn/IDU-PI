#!/usr/bin/env node
import { execFileSync, execSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
	readFileSync(join(packageRoot, "package.json"), "utf8"),
);
const args = parseArgs(process.argv.slice(2));

if (args.help) {
	console.log(formatHelp());
	process.exit(0);
}

const detection = detectInstallState();
const plan = buildPlan(detection);
console.log(formatInstaller(detection, plan));

if (args.dryRun) {
	console.log("");
	console.log("Dry-run: no escribí archivos ni ejecuté comandos.");
	process.exit(0);
}

if (!detection.node.found) {
	console.error("");
	console.error(
		"Node no está disponible. Instalá Node.js LTS desde https://nodejs.org/ y volvé a ejecutar este instalador.",
	);
	process.exit(1);
}

const approved = args.yes || (await askContinue());
if (!approved) {
	console.log("Cancelado. No escribí archivos ni ejecuté acciones.");
	process.exit(0);
}

await runInstaller(plan);

function parseArgs(argv) {
	const parsed = {
		yes: false,
		dryRun: false,
		noMcp: false,
		noShim: false,
		openWizard: false,
		addPath: false,
		help: false,
	};
	for (const arg of argv) {
		if (arg === "--yes") parsed.yes = true;
		else if (arg === "--dry-run") parsed.dryRun = true;
		else if (arg === "--no-mcp") parsed.noMcp = true;
		else if (arg === "--no-shim") parsed.noShim = true;
		else if (arg === "--open-wizard") parsed.openWizard = true;
		else if (arg === "--add-path") parsed.addPath = true;
		else if (arg === "--help" || arg === "-h") parsed.help = true;
		else throw new Error(`Flag no reconocido: ${arg}`);
	}
	return parsed;
}

function formatHelp() {
	return [
		"Idu-pi secure bootstrap installer",
		"",
		"Uso:",
		"  node scripts/install.mjs [--yes] [--dry-run] [--no-mcp] [--no-shim] [--open-wizard] [--add-path]",
		"",
		"Flags:",
		"  --yes          acepta confirmaciones del instalador; para PATH requiere --add-path",
		"  --dry-run      muestra plan, archivos y comandos sin escribir",
		"  --no-mcp       omite setup mcp-init",
		"  --no-shim      omite shim local idu-pi",
		"  --open-wizard  al final muestra el estado (cli.js status): CLIs y perfiles detectados",
		"  --add-path     configura el PATH de usuario si falta el shim (sólo Windows); en POSIX imprime la línea a agregar",
		"  --help         muestra esta ayuda",
	].join("\n");
}

function detectInstallState() {
	const env = process.env;
	const mockTools = parseMockTools(env.IDU_PI_INSTALL_MOCK_TOOLS);
	const userHome = env.USERPROFILE || env.HOME || homedir();
	const agentDir = resolve(
		env.PI_CODING_AGENT_DIR?.trim() || join(userHome, ".pi", "agent"),
	);
	const shimDir = resolve(
		env.IDU_PI_INSTALL_SHIM_DIR?.trim() || defaultShimDir(userHome),
	);
	const pathEntries = (env.PATH ?? env.Path ?? "")
		.split(delimiter)
		.map((entry) => normalizePath(entry))
		.filter(Boolean);
	return {
		version: packageJson.version ?? "unknown",
		packageRoot,
		agentDir,
		mcpConfigPath: join(agentDir, "mcp.json"),
		shimDir,
		shimInPath: pathEntries.includes(normalizePath(shimDir)),
		node: detectTool("node", ["--version"], mockTools),
		git: detectTool("git", ["--version"], mockTools),
		corepack: detectTool("corepack", ["--version"], mockTools),
		pnpm: detectTool("corepack", ["pnpm", "--version"], mockTools, "pnpm"),
		iduGlobal: detectIduGlobal(mockTools),
		mcpPresent: existsSync(join(agentDir, "mcp.json")),
	};
}

function parseMockTools(raw) {
	if (!raw) return {};
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

function detectTool(command, commandArgs, mocks, key = command) {
	if (Object.hasOwn(mocks, key)) {
		const value = mocks[key];
		if (value === false) return { found: false };
		return {
			found: true,
			version: typeof value === "string" ? value : "mocked",
		};
	}
	try {
		const output = runCapture(command, commandArgs).trim();
		return { found: true, version: output.split(/\r?\n/u)[0] };
	} catch {
		return { found: false };
	}
}

function detectIduGlobal(mocks) {
	if (Object.hasOwn(mocks, "idu-pi")) {
		return { found: Boolean(mocks["idu-pi"]) };
	}
	const command = process.platform === "win32" ? "where" : "which";
	try {
		const output = execFileSync(command, ["idu-pi"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return { found: Boolean(output), version: output.split(/\r?\n/u)[0] };
	} catch {
		return { found: false };
	}
}

/**
 * Where the local `idu-pi` launcher goes when IDU_PI_INSTALL_SHIM_DIR is unset.
 *
 * The Windows default predates Linux support and used to be applied on every
 * platform, so a Linux install dropped a Windows-shaped tree
 * (`$HOME/AppData/Local/...`) into the user's home. POSIX uses ~/.local/bin,
 * which Ubuntu's default ~/.profile already adds to PATH when it exists.
 */
function defaultShimDir(userHome) {
	if (process.platform === "win32") {
		return join(userHome, "AppData", "Local", "idu-pi", "bin");
	}
	return join(userHome, ".local", "bin");
}

/** Files the shim step writes on this platform. Mirrors installShim(). */
function shimPaths(shimDir) {
	if (process.platform === "win32") {
		return [join(shimDir, "idu-pi.cmd"), join(shimDir, "idu-pi.ps1")];
	}
	return [join(shimDir, "idu-pi")];
}

/** Single-quote for POSIX sh, so a path with spaces or quotes stays one word. */
function shQuote(value) {
	return `'${String(value).replace(/'/gu, `'\\''`)}'`;
}

function buildPlan(detection) {
	const cliPath = join("dist", "src", "cli.js");
	const steps = [
		{
			name: "Instalar dependencias",
			preCommands: detection.pnpm.found ? [] : [["corepack", ["enable"]]],
			command: [
				"corepack",
				["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"],
			],
			touches: [join(packageRoot, "node_modules")],
			enabled: true,
		},
		{
			name: "Compilar",
			command: ["corepack", ["pnpm", "build"]],
			touches: [join(packageRoot, "dist")],
			enabled: true,
		},
		{
			name: "Configurar MCP Pi",
			// Merges idu-pi into mcp.json with a backup; keeps an existing entry.
			command: ["node", [cliPath, "--", "setup", "mcp-init"]],
			touches: [detection.mcpConfigPath],
			enabled: !args.noMcp,
			skipReason: "MCP Pi: omitido por --no-mcp",
		},
		{
			name: "Crear shim idu-pi local",
			touches: shimPaths(detection.shimDir),
			enabled: !args.noShim,
			skipReason: "Shim idu-pi: omitido por --no-shim",
		},
		{
			// cli.js with no arguments starts the stdio MCP server and waits on stdin,
			// so this step runs `status` instead.
			name: "Mostrar estado",
			command: ["node", [cliPath, "status"]],
			touches: [],
			enabled: args.openWizard,
			skipReason: "Estado: omitido salvo --open-wizard",
		},
	];
	return steps;
}

function formatInstaller(detection, plan) {
	return [
		"IDU-PI",
		`version: ${detection.version}`,
		"",
		"Instalador seguro",
		"",
		"Detectado:",
		`- Node: ${formatTool(detection.node)}`,
		`- Git: ${formatTool(detection.git)}`,
		`- Corepack: ${formatTool(detection.corepack)}`,
		`- pnpm: ${formatTool(detection.pnpm)}`,
		`- Pi agent dir: ${detection.agentDir}`,
		`- MCP config: ${detection.mcpPresent ? "present" : "missing"}`,
		`- idu-pi global: ${detection.iduGlobal.found ? "present" : "missing"}`,
		`- shim PATH: ${detection.shimInPath ? "present" : "missing"}`,
		"",
		"Plan:",
		...plan.map(
			(step, index) =>
				`${index + 1}. ${step.name}${step.enabled ? "" : ` (${step.skipReason})`}`,
		),
		"",
		"Comandos que ejecutaría:",
		...plannedCommands(plan).map((line) => `- ${line}`),
		"",
		"Archivos/rutas que tocaría:",
		...plannedTouches(plan).map((line) => `- ${line}`),
		"",
		"Seguridad:",
		"- No ejecuta bootstrap remoto opaco ni scripts de dependencias.",
		"- Usa pnpm-lock.yaml con --frozen-lockfile --ignore-scripts; pnpm puede descargar paquetes fijados desde el registry/cache configurado.",
		"- No lanza workers ni delega tareas: sólo instala el CLI y sus shims.",
		"- No enrola proyectos ni crea Project Core.",
		args.addPath
			? "- PATH de usuario: se actualizará sólo porque pasaste --add-path."
			: "- PATH de usuario: sólo se modifica si lo confirmás en modo interactivo.",
		...(detection.node.found
			? []
			: ["", "Instalá Node.js LTS y volvé a ejecutar este instalador."]),
	].join("\n");
}

function plannedCommands(plan) {
	const commands = [];
	const seen = new Set();
	for (const step of plan) {
		if (!step.enabled || step.combinedWithPrevious) continue;
		for (const command of [
			...(step.preCommands ?? []),
			...(step.command ? [step.command] : []),
		]) {
			const rendered = renderCommand(command);
			if (!seen.has(rendered)) {
				seen.add(rendered);
				commands.push(rendered);
			}
		}
	}
	return commands.length ? commands : ["ninguno"];
}

function plannedTouches(plan) {
	const touches = [];
	const seen = new Set();
	for (const step of plan) {
		if (!step.enabled) continue;
		for (const path of step.touches ?? []) {
			if (!seen.has(path)) {
				seen.add(path);
				touches.push(path);
			}
		}
	}
	return touches.length ? touches : ["ninguno"];
}

function formatTool(status) {
	return status.found
		? `found${status.version ? ` (${status.version})` : ""}`
		: "missing";
}

async function askContinue() {
	if (!process.stdin.isTTY) {
		console.log("");
		console.log("stdin no es interactivo; no ejecuto acciones sin --yes.");
		return false;
	}
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = (await rl.question("¿Continuar? (s/N) "))
			.trim()
			.toLowerCase();
		return ["s", "si", "sí", "y", "yes"].includes(answer);
	} finally {
		rl.close();
	}
}

async function askAddPath(shimDir) {
	if (args.addPath) return true;
	if (!process.stdin.isTTY) return false;
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		const answer = (
			await rl.question(
				`La carpeta del shim no está en PATH:\n${shimDir}\n¿Querés agregarla al PATH de usuario? (s/N) `,
			)
		)
			.trim()
			.toLowerCase();
		return ["s", "si", "sí", "y", "yes"].includes(answer);
	} finally {
		rl.close();
	}
}

async function runInstaller(plan) {
	for (const step of plan) {
		if (!step.enabled) {
			console.log(step.skipReason);
			continue;
		}
		if (step.name === "Crear shim idu-pi local") {
			installShim();
			continue;
		}
		if (step.combinedWithPrevious) continue;
		for (const command of step.preCommands ?? []) runCommand(command);
		if (!step.command) continue;
		runCommand(step.command);
	}
	if (args.noShim) {
		console.log("PATH no modificado porque --no-shim omite el shim local.");
		return;
	}
	const state = detectInstallState();
	if (state.shimInPath) {
		console.log(`PATH ya contiene: ${state.shimDir}`);
		console.log("PATH no modificado porque ya estaba configurado.");
		return;
	}
	if (await askAddPath(state.shimDir)) {
		if (!addShimToUserPath(state.shimDir)) {
			// POSIX: never edit the user's shell rc automatically.
			console.log("No modifico tu shell rc automáticamente.");
			console.log("Agregá esta línea a tu ~/.profile, ~/.bashrc o config de zsh/fish:");
			console.log(`  export PATH="$PATH:${state.shimDir}"`);
			console.log("Luego abrí una terminal nueva y ejecutá: idu-pi");
			return;
		}
		console.log("PATH de usuario actualizado.");
		console.log("Cerrá y abrí una terminal nueva, luego ejecutá: idu-pi");
		return;
	}
	console.log("No modifiqué PATH automáticamente.");
	console.log(`Agrega esta ruta al PATH: ${state.shimDir}`);
	console.log(
		`Mientras tanto usá: node ${join(packageRoot, "dist", "src", "cli.js")}`,
	);
}

function addShimToUserPath(shimDir) {
	const markerFile = process.env.IDU_PI_INSTALL_TEST_USER_PATH_FILE;
	if (markerFile) {
		const current = process.env.IDU_PI_INSTALL_TEST_USER_PATH ?? "";
		const next = appendPathEntry(current, shimDir);
		writeFileSync(markerFile, next, "utf8");
		return true;
	}
	if (process.platform !== "win32") {
		// Editing a shell rc file is not reversible from here: the installer does
		// not know whether the user runs bash, zsh or fish, and cannot undo the
		// line on uninstall. Report the unsupported case instead of throwing, so a
		// Linux install with --add-path finishes with instructions rather than a
		// stack trace.
		return false;
	}
	const current = execFileSync(
		"powershell",
		[
			"-NoProfile",
			"-Command",
			"[Environment]::GetEnvironmentVariable('Path', 'User')",
		],
		{ encoding: "utf8" },
	).trim();
	const next = appendPathEntry(current, shimDir);
	if (next === current) return true;
	execFileSync(
		"powershell",
		[
			"-NoProfile",
			"-Command",
			"[Environment]::SetEnvironmentVariable('Path', $env:IDU_PI_INSTALL_NEXT_USER_PATH, 'User')",
		],
		{
			env: { ...process.env, IDU_PI_INSTALL_NEXT_USER_PATH: next },
			stdio: ["ignore", "ignore", "pipe"],
		},
	);
	return true;
}

function appendPathEntry(current, entry) {
	const entries = current
		.split(delimiter)
		.map((value) => value.trim())
		.filter(Boolean);
	const normalizedEntry = normalizePath(entry);
	if (entries.some((value) => normalizePath(value) === normalizedEntry)) {
		return current;
	}
	return [...entries, entry].join(delimiter);
}

function runCommand(commandTuple) {
	const [command, commandArgs] = commandTuple;
	console.log(`> ${renderCommand(commandTuple)}`);
	if (process.env.IDU_PI_INSTALL_TEST_SKIP_COMMANDS === "1") return;
	try {
		if (process.platform === "win32") {
			execSync(renderShellCommand(commandTuple), {
				cwd: packageRoot,
				stdio: "inherit",
			});
			return;
		}
		execFileSync(command, commandArgs, {
			cwd: packageRoot,
			stdio: "inherit",
		});
	} catch {
		throw new Error(`Falló comando: ${renderCommand(commandTuple)}`);
	}
}

function installShim() {
	const state = detectInstallState();
	const cliPath = join(packageRoot, "dist", "src", "cli.js");
	mkdirSync(state.shimDir, { recursive: true });

	if (process.platform !== "win32") {
		// POSIX has no .cmd/.ps1 equivalent: without this branch the installer wrote
		// two files the shell cannot execute, so `idu-pi` never resolved on Linux
		// even though the CLI itself already ran there.
		const shimPath = join(state.shimDir, "idu-pi");
		const content = `#!/bin/sh\nexec node ${shQuote(cliPath)} "$@"\n`;
		writeIfChangedWithBackup(shimPath, content, "");
		// writeFileSync does not carry the exec bit; 0o755 is what makes the shim
		// runnable without an explicit `sh` prefix.
		chmodSync(shimPath, 0o755);
		console.log(`Shim idu-pi instalado/verificado en: ${state.shimDir}`);
		return;
	}

	const cmdPath = join(state.shimDir, "idu-pi.cmd");
	const ps1Path = join(state.shimDir, "idu-pi.ps1");
	const cmdContent = `@echo off\r\nnode "${cliPath}" %*\r\n`;
	const ps1Content = `& node "${cliPath}" @args\n`;
	writeIfChangedWithBackup(cmdPath, cmdContent, ".cmd");
	writeIfChangedWithBackup(ps1Path, ps1Content, ".ps1");
	console.log(`Shim idu-pi instalado/verificado en: ${state.shimDir}`);
}

function writeIfChangedWithBackup(path, content, extension) {
	if (existsSync(path)) {
		const current = readFileSync(path, "utf8");
		if (current === content) return;
		const backupPath = join(
			dirname(path),
			`idu-pi.backup-${timestamp(new Date())}${extension}`,
		);
		writeFileSync(backupPath, current, "utf8");
	}
	writeFileSync(path, content, "utf8");
}

function runCapture(command, commandArgs) {
	if (process.platform === "win32") {
		return execSync(renderShellCommand([command, commandArgs]), {
			cwd: packageRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
	}
	return execFileSync(command, commandArgs, {
		cwd: packageRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	});
}

function renderCommand(commandTuple) {
	const [command, commandArgs] = commandTuple;
	return [command, ...commandArgs].join(" ");
}

function renderShellCommand(commandTuple) {
	const [command, commandArgs] = commandTuple;
	return [command, ...commandArgs].map(shellQuote).join(" ");
}

function shellQuote(value) {
	return /^[A-Za-z0-9_./:-]+$/u.test(value)
		? value
		: `"${value.replace(/"/gu, '\\"')}"`;
}

function timestamp(date) {
	const pad = (value) => String(value).padStart(2, "0");
	return [
		date.getFullYear(),
		pad(date.getMonth() + 1),
		pad(date.getDate()),
		"-",
		pad(date.getHours()),
		pad(date.getMinutes()),
		pad(date.getSeconds()),
	].join("");
}

function normalizePath(path) {
	const normalized = resolve(path.trim());
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

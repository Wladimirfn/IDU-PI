import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { IduConfig, IduProfile, ProfilesConfig } from "./types.js";

export const IDU_HOME = join(homedir(), ".idu");
export const IDU_CONFIG_PATH = join(IDU_HOME, "config.json");
export const IDU_PROFILES_PATH = join(IDU_HOME, "profiles.json");
export const IDU_RUNTIME_DIR = join(IDU_HOME, "runtime");
export const IDU_SESSIONS_DIR = join(IDU_HOME, "sessions");
export const IDU_LOCKS_DIR = join(IDU_HOME, "locks");
export const IDU_LOGS_DIR = join(IDU_HOME, "logs");

export function ensureIduDirectories(): void {
	const dirs = [IDU_HOME, IDU_RUNTIME_DIR, IDU_SESSIONS_DIR, IDU_LOCKS_DIR, IDU_LOGS_DIR];
	for (const dir of dirs) {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	}
}

export const DEFAULT_PROFILES: ProfilesConfig = {
	profiles: {
		"cheap-explore": {
			harness: "opencode",
			provider: "minimax",
			model: "MiniMax-M3",
			permissions: "read-only",
			description: "Exploración económica de repositorios grandes y lectura de código",
			streams: true,
			timeoutMs: 1800000,
			idleTimeoutMs: 300000,
			hardCapMs: 7200000,
			startupGraceMs: 300000,
		},
		"cheap-debug": {
			harness: "opencode",
			provider: "opencode-go",
			model: "deepseek-v4-flash",
			permissions: "workspace",
			description: "Ejecución de tests locales, búsqueda de errores y reproducción de bugs",
			streams: true,
			timeoutMs: 1800000,
			idleTimeoutMs: 300000,
			hardCapMs: 7200000,
			startupGraceMs: 300000,
		},
		coding: {
			harness: "codex",
			provider: "openai",
			model: "gpt-5.6-luna",
			permissions: "workspace",
			description: "Generación de código robusto, implementación de módulos y refactor directo",
			streams: false,
			timeoutMs: 3600000,
			hardCapMs: 14400000,
		},
		architecture: {
			harness: "claude",
			provider: "anthropic",
			model: "opus",
			permissions: "read-only",
			description: "Diseño arquitectónico, revisión de contratos de interfaz y análisis de blast radius",
			streams: true,
			timeoutMs: 3600000,
			idleTimeoutMs: 300000,
			hardCapMs: 14400000,
			startupGraceMs: 300000,
		},
		"deep-refactor": {
			harness: "claude",
			provider: "anthropic",
			model: "sonnet",
			permissions: "workspace",
			description: "Refactorizaciones complejas preservando compatibilidad y comportamiento",
			streams: true,
			timeoutMs: 3600000,
			idleTimeoutMs: 300000,
			hardCapMs: 14400000,
			startupGraceMs: 300000,
		},
		fast: {
			harness: "pi",
			provider: "minimax",
			model: "MiniMax-M3",
			permissions: "workspace",
			description: "Micro-tareas rápidas, transformaciones de texto y scripts atómicos",
			streams: false,
			timeoutMs: 180000,
		},
		kimi: {
			harness: "kimi",
			permissions: "workspace",
			description: "Kimi Code CLI autónomo para refactorización profunda y comprensión de código",
			streams: false,
			timeoutMs: 1800000,
		},
		qwen: {
			harness: "qwen",
			permissions: "workspace",
			description: "Qwen Code CLI oficial con motor Qwen 2.5 Coder",
			streams: false,
			timeoutMs: 1800000,
		},
		antigravity: {
			harness: "antigravity",
			model: "gemini-3.8-flash-high",
			permissions: "workspace",
			description: "Google DeepMind Antigravity CLI agent (agy)",
			streams: true,
			timeoutMs: 1800000,
			idleTimeoutMs: 300000,
			hardCapMs: 7200000,
		},
		"antigravity-advisory": {
			harness: "antigravity",
			model: "gemini-3.8-flash-high",
			permissions: "read-only",
			description: "Antigravity (agy) en modo consulta: auditoria y dictamen, sin escritura",
			streams: true,
			timeoutMs: 3600000,
			idleTimeoutMs: 300000,
			hardCapMs: 14400000,
		},
		commandcode: {
			harness: "commandcode",
			model: "deepseek/deepseek-v4.1-flash",
			permissions: "workspace",
			description: "Command Code CLI (cmdc --yolo) para implementacion delegada con sesiones continuas",
			streams: false,
			timeoutMs: 1800000,
			idleTimeoutMs: 300000,
			hardCapMs: 7200000,
		},
		mcode: {
			harness: "mcode",
			// Full provider/model in `model`, no separate `provider` field:
			// buildWorkerArgs joins them, so declaring both would produce
			// "minimax/minimax/MiniMax-...". Same shape as `commandcode`.
			model: "minimax/MiniMax-M3.1-Flash-Preview",
			permissions: "workspace",
			description: "minimax Code CLI (mcode exec) como segundo implementador, nativo a este protocolo",
			streams: false,
			timeoutMs: 1800000,
			idleTimeoutMs: 300000,
			hardCapMs: 7200000,
		},
	},
};

const DEFAULT_CONFIG: IduConfig = {
	version: "2.1.0",
	oneOrchestratorRule: {
		enabled: true,
		allowRecursiveDelegation: false,
	},
	clis: {
		claude: { command: "claude", argsTemplate: ["-p", "{task}"] },
		opencode: { command: "opencode", argsTemplate: ["run", "--auto", "{task}"] },
		codex: { command: "codex", argsTemplate: ["exec", "{task}"] },
		pi: { command: "pi", argsTemplate: ["-p", "{task}"] },
		kimi: { command: "kimi", argsTemplate: ["-p", "{task}"] },
		qwen: { command: "qwen", argsTemplate: ["-p", "{task}"] },
		antigravity: { command: "agy", argsTemplate: ["-p", "{task}"] },
		commandcode: { command: "cmdc", argsTemplate: ["--output-format", "json", "--yolo", "--skip-onboarding", "-p", "{task}"] },
		mcode: { command: "mcode", argsTemplate: ["exec", "--output-format", "json", "{task}"] },
	},
	defaultTimeoutMs: 300_000,
	maxConcurrentWorkers: 4,
};

export function loadIduConfig(): IduConfig {
	ensureIduDirectories();
	if (!existsSync(IDU_CONFIG_PATH)) {
		return DEFAULT_CONFIG;
	}
	try {
		const raw = readFileSync(IDU_CONFIG_PATH, "utf8");
		const parsed = JSON.parse(raw) as IduConfig;
		warnAboutRetiredRuleFlags(parsed);
		return {
			...DEFAULT_CONFIG,
			...parsed,
			clis: {
				...DEFAULT_CONFIG.clis,
				...(parsed.clis ?? {}),
			},
			// oneOrchestratorRule is deliberately NOT merged from the file. Both
			// of its keys used to switch the guard off, and the file lives in a
			// home directory every delegated worker can write to. Taking the
			// value from the file made a one-line bypass the cheapest way in.
			oneOrchestratorRule: { ...DEFAULT_CONFIG.oneOrchestratorRule },
		};
	} catch (err) {
		console.error("Error loading IDU config, using default:", err);
		return DEFAULT_CONFIG;
	}
}

/**
 * `oneOrchestratorRule` is retired in full.
 *
 * `allowRecursiveDelegation` was the direct switch and `enabled` wrapped the
 * whole condition, so either one disabled the guard from `~/.idu/config.json`.
 * The guard now fires on `IDU_WORKER === "true"` and reads no config at all.
 *
 * The keys are still accepted so existing configs keep parsing, and this warns
 * rather than leaving the block to rot into a switch nobody reads and everybody
 * assumes is still live. Silently ignoring a knob that used to work is how you
 * find out about it from a support ticket.
 */
function warnAboutRetiredRuleFlags(config: IduConfig): void {
	const rule = config.oneOrchestratorRule as
		| { enabled?: unknown; allowRecursiveDelegation?: unknown }
		| undefined;
	if (!rule) return;

	// Only when a key holds a value that used to mean something. The default
	// block { enabled: true, allowRecursiveDelegation: false } is what a
	// generated config always contained, and warning about it would tell every
	// user on every command that they had configured something they never did.
	// Warn only where the setting was actually load-bearing and is now ignored.
	const relaxingEnabled = rule.enabled === false;
	const relaxingRecursion = rule.allowRecursiveDelegation === true;
	if (!relaxingEnabled && !relaxingRecursion) return;

	console.warn(
		"[warn] oneOrchestratorRule is no longer read, so this setting is being ignored. " +
			"The orchestrator guard fires on worker identity alone and cannot be switched off " +
			"from the config file. The whole oneOrchestratorRule block can be dropped. " +
			"See SECURITY.md for what the guard does and does not hold.",
	);
}

export function loadProfilesConfig(): ProfilesConfig {
	ensureIduDirectories();
	if (!existsSync(IDU_PROFILES_PATH)) {
		return DEFAULT_PROFILES;
	}
	try {
		const raw = readFileSync(IDU_PROFILES_PATH, "utf8");
		const parsed = JSON.parse(raw) as ProfilesConfig;
		return {
			profiles: {
				...DEFAULT_PROFILES.profiles,
				...(parsed.profiles ?? {}),
			},
		};
	} catch (err) {
		console.error("Error loading IDU profiles, using default:", err);
		return DEFAULT_PROFILES;
	}
}

export function getProfile(name: string): IduProfile | null {
	const { profiles } = loadProfilesConfig();
	return profiles[name] ?? null;
}

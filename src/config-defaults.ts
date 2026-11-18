import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { IduConfig, ProfilesConfig } from "./types.js";

export const IDU_HOME = process.env.IDU_HOME || join(homedir(), ".idu");
export const IDU_CONFIG_PATH = join(IDU_HOME, "config.json");

/**
 * Runtime-resolvable home path: unlike IDU_HOME (fixed at import time),
 * this re-reads IDU_HOME from the environment on every call, so tests and
 * embedded callers can isolate the home directory per invocation.
 */
export function getIduHome(): string {
	return process.env.IDU_HOME || IDU_HOME;
}

/** Runtime-resolvable config path honoring live `IDU_HOME` overrides. */
export function getIduConfigPath(): string {
	return join(getIduHome(), "config.json");
}

/** Runtime-resolvable profiles path honoring live `IDU_HOME` overrides. */
export function getIduProfilesPath(): string {
	return join(getIduHome(), "profiles.json");
}

export const IDU_PROFILES_PATH = join(IDU_HOME, "profiles.json");
export const IDU_RUNTIME_DIR = join(IDU_HOME, "runtime");
export const IDU_SESSIONS_DIR = join(IDU_HOME, "sessions");
export const IDU_LOCKS_DIR = join(IDU_HOME, "locks");
export const IDU_LOGS_DIR = join(IDU_HOME, "logs");

export function ensureIduDirectories(): void {
	const home = getIduHome();
	const dirs = [
		home,
		join(home, "runtime"),
		join(home, "sessions"),
		join(home, "locks"),
		join(home, "logs"),
	];
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
			model: "gemini-4-argon-high",
			permissions: "workspace",
			description: "Google DeepMind Antigravity CLI agent (agy)",
			streams: true,
			timeoutMs: 1800000,
			idleTimeoutMs: 300000,
			hardCapMs: 7200000,
		},
		"antigravity-advisory": {
			harness: "antigravity",
			model: "gemini-4-argon-high",
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
			model: "minimax/MiniMax-M3.1-Flash-Preview",
			permissions: "workspace",
			description: "minimax Code CLI (mcode exec) como segundo implementador, nativo a este protocolo",
			streams: true,
			timeoutMs: 1800000,
			idleTimeoutMs: 300000,
			hardCapMs: 7200000,
		},
	},
};

export const DEFAULT_CONFIG: IduConfig = {
	version: "2.2.0",
	oneOrchestratorRule: {
		enabled: true,
		allowRecursiveDelegation: false,
	},
	clis: {
		claude: { command: "claude", argsTemplate: ["-p", "{task}"] },
		opencode: { command: "opencode", argsTemplate: ["run", "--auto", "{task}"] },
		codex: { command: "codex", argsTemplate: ["exec", "--json", "--skip-git-repo-check", "{task}"] },
		pi: { command: "pi", argsTemplate: ["--mode", "json", "-p", "{task}"] },
		"gentle-shell": { command: "gentle-shell", argsTemplate: ["--mode", "json", "-p", "{task}"] },
		kimi: { command: "kimi", argsTemplate: ["--output-format", "stream-json", "-p", "{task}"] },
		qwen: { command: "qwen", argsTemplate: ["-o", "stream-json", "-p", "{task}"] },
		antigravity: { command: "agy", argsTemplate: ["-p", "{task}"] },
		commandcode: {
			command: "cmdc",
			argsTemplate: ["--output-format", "json", "--yolo", "--skip-onboarding", "--no-auto-update", "-p", "{task}"],
		},
		mcode: { command: "mcode", argsTemplate: ["exec", "--output-format", "stream-json", "{task}"] },
	},
	defaultTimeoutMs: 300_000,
	maxConcurrentWorkers: 4,
};

/** Parses one ProfilesConfig JSON file, merging `DEFAULT_PROFILES` unless `replaceDefaults === true`. */
export function parseProfilesConfigFile(filePath: string): ProfilesConfig {
	if (!existsSync(filePath)) {
		return {
			profiles: { ...DEFAULT_PROFILES.profiles },
		};
	}
	try {
		const raw = readFileSync(filePath, "utf8");
		const parsed = JSON.parse(raw) as ProfilesConfig;
		if (parsed.replaceDefaults === true) {
			return {
				...parsed,
				profiles: parsed.profiles ?? {},
				replaceDefaults: true,
			};
		}
		return {
			...parsed,
			profiles: {
				...DEFAULT_PROFILES.profiles,
				...(parsed.profiles ?? {}),
			},
		};
	} catch (err) {
		console.error(`Error loading IDU profiles from ${filePath}, using default:`, err);
		return {
			profiles: { ...DEFAULT_PROFILES.profiles },
		};
	}
}

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

const DEFAULT_CONFIG: IduConfig = {
	version: "1.0.0",
	oneOrchestratorRule: {
		enabled: true,
		allowRecursiveDelegation: false,
	},
	clis: {},
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
		return {
			...DEFAULT_CONFIG,
			...parsed,
			oneOrchestratorRule: {
				...DEFAULT_CONFIG.oneOrchestratorRule,
				...(parsed.oneOrchestratorRule ?? {}),
			},
		};
	} catch (err) {
		console.error("Error loading IDU config, using default:", err);
		return DEFAULT_CONFIG;
	}
}

export function loadProfilesConfig(): ProfilesConfig {
	ensureIduDirectories();
	if (!existsSync(IDU_PROFILES_PATH)) {
		return { profiles: {} };
	}
	try {
		const raw = readFileSync(IDU_PROFILES_PATH, "utf8");
		return JSON.parse(raw) as ProfilesConfig;
	} catch (err) {
		console.error("Error loading IDU profiles, using empty:", err);
		return { profiles: {} };
	}
}

export function getProfile(name: string): IduProfile | null {
	const { profiles } = loadProfilesConfig();
	return profiles[name] ?? null;
}

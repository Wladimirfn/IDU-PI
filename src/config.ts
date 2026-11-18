import { existsSync, readFileSync } from "node:fs";
import {
	DEFAULT_CONFIG,
	DEFAULT_PROFILES,
	ensureIduDirectories,
	getIduConfigPath,
	getIduHome,
	getIduProfilesPath,
	IDU_CONFIG_PATH,
	IDU_HOME,
	IDU_LOCKS_DIR,
	IDU_LOGS_DIR,
	IDU_PROFILES_PATH,
	IDU_RUNTIME_DIR,
	IDU_SESSIONS_DIR,
} from "./config-defaults.js";
import { resolveAgentProfile, resolveEffectiveFleet } from "./fleets.js";
import type { IduConfig, IduProfile, ProfilesConfig, ResolveProfilesOptions } from "./types.js";

export {
	DEFAULT_CONFIG,
	DEFAULT_PROFILES,
	ensureIduDirectories,
	getIduConfigPath,
	getIduHome,
	getIduProfilesPath,
	IDU_CONFIG_PATH,
	IDU_HOME,
	IDU_LOCKS_DIR,
	IDU_LOGS_DIR,
	IDU_PROFILES_PATH,
	IDU_RUNTIME_DIR,
	IDU_SESSIONS_DIR,
};

export function loadIduConfig(): IduConfig {
	ensureIduDirectories();
	const configPath = getIduConfigPath();
	if (!existsSync(configPath)) {
		return DEFAULT_CONFIG;
	}
	try {
		const raw = readFileSync(configPath, "utf8");
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

export function loadProfilesConfig(options?: ResolveProfilesOptions): ProfilesConfig {
	return resolveEffectiveFleet(options).config;
}

export function getProfile(name: string, options?: ResolveProfilesOptions): IduProfile | null {
	const { profiles } = loadProfilesConfig(options);
	return resolveAgentProfile(profiles, name)?.profile ?? null;
}

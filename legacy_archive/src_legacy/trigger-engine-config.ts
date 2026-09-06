import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export const TRIGGER_ENGINE_CONFIG_FILENAME = "trigger-engine-config.json";

export type TriggerEngineConfig = {
	version: 1;
	enabled: boolean;
	updatedAt: string;
	source?: string;
};

export type SaveTriggerEngineConfigInput = {
	enabled: boolean;
	updatedAt?: string;
	source?: string;
};

export type SaveTriggerEngineConfigResult = {
	path: string;
	config: TriggerEngineConfig;
};

export type TriggerEngineConfigStatus = {
	path: string;
	exists: boolean;
	enabled: boolean;
	updatedAt?: string;
	source?: string;
};

export type TriggerEngineConfigResult = {
	path: string;
	state: TriggerEngineConfig;
	previous: TriggerEngineConfig | null;
	changed: boolean;
};

const DEFAULT_UPDATED_AT = new Date(0).toISOString();

export function triggerEngineConfigPath(stateRoot: string): string {
	return join(resolve(stateRoot), TRIGGER_ENGINE_CONFIG_FILENAME);
}

export function readTriggerEngineConfig(
	stateRoot: string,
): TriggerEngineConfig {
	return readTriggerEngineConfigFile(stateRoot) ?? defaultTriggerEngineConfig();
}

function readTriggerEngineConfigFile(
	stateRoot: string,
): TriggerEngineConfig | null {
	const path = triggerEngineConfigPath(stateRoot);
	if (!existsSync(path)) return null;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
			string,
			unknown
		>;
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			typeof parsed.enabled !== "boolean"
		) {
			return null;
		}
		return {
			version: 1,
			enabled: parsed.enabled,
			updatedAt:
				typeof parsed.updatedAt === "string"
					? parsed.updatedAt
					: DEFAULT_UPDATED_AT,
			source: typeof parsed.source === "string" ? parsed.source : undefined,
		};
	} catch {
		return null;
	}
}

export function saveTriggerEngineConfig(
	stateRoot: string,
	input: SaveTriggerEngineConfigInput,
): SaveTriggerEngineConfigResult {
	const path = triggerEngineConfigPath(stateRoot);
	const config = buildTriggerEngineConfig(input);
	writeTriggerEngineConfig(path, config);
	return { path, config };
}

export function getTriggerEngineConfigStatus(
	stateRoot: string,
): TriggerEngineConfigStatus {
	const path = triggerEngineConfigPath(stateRoot);
	const config = readTriggerEngineConfigFile(stateRoot);
	if (!config) {
		return {
			path,
			exists: false,
			enabled: false,
		};
	}
	return {
		path,
		exists: true,
		enabled: config.enabled,
		updatedAt: config.updatedAt,
		source: config.source,
	};
}

export function enableTriggerEngineConfig(
	stateRoot: string,
	options: { now?: Date; source?: string } = {},
): TriggerEngineConfigResult {
	return setTriggerEngineConfig(stateRoot, true, options);
}

export function disableTriggerEngineConfig(
	stateRoot: string,
	options: { now?: Date; source?: string } = {},
): TriggerEngineConfigResult {
	return setTriggerEngineConfig(stateRoot, false, options);
}

export function formatTriggerEngineConfigStatus(
	status: TriggerEngineConfigStatus,
): string {
	if (!status.exists) {
		return [
			"Trigger engine",
			"",
			`path: ${status.path}`,
			"state: disabled (default — no file present)",
		].join("\n");
	}
	return [
		"Trigger engine",
		"",
		`path: ${status.path}`,
		`state: ${status.enabled ? "enabled" : "disabled"}`,
		`updatedAt: ${status.updatedAt ?? "—"}`,
		...(status.source ? [`source: ${status.source}`] : []),
	].join("\n");
}

export function formatTriggerEngineConfigResult(
	result: TriggerEngineConfigResult,
): string {
	return [
		"Trigger engine",
		"",
		`path: ${result.path}`,
		`state: ${result.state.enabled ? "enabled" : "disabled"}`,
		`updatedAt: ${result.state.updatedAt}`,
		`changed: ${result.changed ? "yes" : "no"}`,
		...(result.previous
			? [
					`previous: enabled=${result.previous.enabled}, updatedAt=${result.previous.updatedAt}`,
				]
			: []),
	].join("\n");
}

function setTriggerEngineConfig(
	stateRoot: string,
	enabled: boolean,
	options: { now?: Date; source?: string },
): TriggerEngineConfigResult {
	const path = triggerEngineConfigPath(stateRoot);
	const previous = readTriggerEngineConfigFile(stateRoot);
	const state = buildTriggerEngineConfig({
		enabled,
		updatedAt: (options.now ?? new Date()).toISOString(),
		source: options.source,
	});
	writeTriggerEngineConfig(path, state);
	return {
		path,
		state,
		previous,
		changed: previous === null || previous.enabled !== state.enabled,
	};
}

function buildTriggerEngineConfig(
	input: SaveTriggerEngineConfigInput,
): TriggerEngineConfig {
	return {
		version: 1,
		enabled: input.enabled,
		updatedAt: input.updatedAt ?? new Date().toISOString(),
		source: input.source,
	};
}

function writeTriggerEngineConfig(
	path: string,
	config: TriggerEngineConfig,
): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmpPath = `${path}.tmp`;
	writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	renameSync(tmpPath, path);
}

function defaultTriggerEngineConfig(): TriggerEngineConfig {
	return {
		version: 1,
		enabled: false,
		updatedAt: DEFAULT_UPDATED_AT,
	};
}

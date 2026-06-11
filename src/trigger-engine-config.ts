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

const DEFAULT_UPDATED_AT = new Date(0).toISOString();

export function triggerEngineConfigPath(stateRoot: string): string {
	return join(resolve(stateRoot), TRIGGER_ENGINE_CONFIG_FILENAME);
}

export function readTriggerEngineConfig(
	stateRoot: string,
): TriggerEngineConfig {
	const path = triggerEngineConfigPath(stateRoot);
	if (!existsSync(path)) return defaultTriggerEngineConfig();
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
			return defaultTriggerEngineConfig();
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
		return defaultTriggerEngineConfig();
	}
}

export function saveTriggerEngineConfig(
	stateRoot: string,
	input: SaveTriggerEngineConfigInput,
): SaveTriggerEngineConfigResult {
	const path = triggerEngineConfigPath(stateRoot);
	const config: TriggerEngineConfig = {
		version: 1,
		enabled: input.enabled,
		updatedAt: input.updatedAt ?? new Date().toISOString(),
		source: input.source,
	};
	mkdirSync(dirname(path), { recursive: true });
	const tmpPath = `${path}.tmp`;
	writeFileSync(tmpPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	renameSync(tmpPath, path);
	return { path, config };
}

function defaultTriggerEngineConfig(): TriggerEngineConfig {
	return {
		version: 1,
		enabled: false,
		updatedAt: DEFAULT_UPDATED_AT,
	};
}

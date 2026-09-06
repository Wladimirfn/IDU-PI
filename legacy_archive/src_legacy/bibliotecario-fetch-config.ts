import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export const BIBLIOTECARIO_FETCH_CONFIG_FILENAME =
	"bibliotecario-fetch-config.json";
const ENV_OVERRIDE_KEY = "IDU_PI_BIBLIOTECARIO_FETCH";

export type BibliotecarAllowlistEntry = {
	host: string;
	pathPrefix: string;
};

export type BibliotecarFetchConfig = {
	version: 1;
	enabled: boolean;
	allowlist: BibliotecarAllowlistEntry[];
	rawDocsStored: boolean;
	updatedAt: string;
	source?: string;
};

export type SaveBibliotecarFetchConfigInput = {
	enabled: boolean;
	allowlist?: BibliotecarAllowlistEntry[];
	rawDocsStored?: boolean;
	source?: string;
	updatedAt?: string;
};

export type SaveBibliotecarFetchConfigResult = {
	path: string;
	config: BibliotecarFetchConfig;
};

const DEFAULT_UPDATED_AT = new Date(0).toISOString();

export function bibliotecarioFetchConfigPath(stateRoot: string): string {
	return join(
		resolve(stateRoot),
		"bibliotecario",
		BIBLIOTECARIO_FETCH_CONFIG_FILENAME,
	);
}

function readConfigFile(stateRoot: string): BibliotecarFetchConfig | null {
	const path = bibliotecarioFetchConfigPath(stateRoot);
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf8");
		if (!raw.trim()) return null;
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			typeof parsed.enabled === "boolean"
		) {
			return {
				version: 1,
				enabled: parsed.enabled,
				allowlist: Array.isArray(parsed.allowlist)
					? (parsed.allowlist as BibliotecarAllowlistEntry[]).filter(
							(entry) =>
								typeof entry?.host === "string" &&
								typeof entry?.pathPrefix === "string",
						)
					: [],
				rawDocsStored:
					typeof parsed.rawDocsStored === "boolean"
						? parsed.rawDocsStored
						: false,
				updatedAt:
					typeof parsed.updatedAt === "string"
						? parsed.updatedAt
						: DEFAULT_UPDATED_AT,
				...(typeof parsed.source === "string" ? { source: parsed.source } : {}),
			};
		}
	} catch {
		// Lenient parse-or-default
	}
	return null;
}

export function readBibliotecarFetchConfig(
	stateRoot: string,
): BibliotecarFetchConfig {
	const fromFile = readConfigFile(stateRoot);
	if (fromFile) return fromFile;
	const envOverride = process.env[ENV_OVERRIDE_KEY] === "1";
	return {
		version: 1,
		enabled: envOverride,
		allowlist: [],
		rawDocsStored: false,
		updatedAt: DEFAULT_UPDATED_AT,
	};
}

export function saveBibliotecarFetchConfig(
	stateRoot: string,
	input: SaveBibliotecarFetchConfigInput,
): SaveBibliotecarFetchConfigResult {
	const path = bibliotecarioFetchConfigPath(stateRoot);
	const config: BibliotecarFetchConfig = {
		version: 1,
		enabled: input.enabled,
		allowlist: input.allowlist ?? [],
		rawDocsStored: input.rawDocsStored ?? false,
		updatedAt: input.updatedAt ?? new Date().toISOString(),
		...(input.source ? { source: input.source } : {}),
	};
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
	writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
	renameSync(tmp, path);
	return { path, config };
}

export function isBibliotecarFetchAllowed(
	cfg: BibliotecarFetchConfig,
	url: string,
): boolean {
	if (!cfg.enabled) return false;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	const host = parsed.hostname;
	const path = parsed.pathname;
	return cfg.allowlist.some(
		(entry) => entry.host === host && path.startsWith(entry.pathPrefix),
	);
}

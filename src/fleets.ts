import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
	DEFAULT_PROFILES,
	ensureIduDirectories,
	getIduHome,
	getIduProfilesPath,
	parseProfilesConfigFile,
} from "./config-defaults.js";
import { writeJsonAtomic } from "./json-file.js";
import { stripEffortVariantSuffix } from "./effort.js";
import { canonicalHarnessName } from "./session-policy.js";
import type {
	FleetRegistry,
	FleetSummary,
	IduProfile,
	ProfilesConfig,
	ReasoningEffort,
	ResolveProfilesOptions,
} from "./types.js";

export {
	getHarnessEffortSpec,
	inspectProfileEffort,
	parseReasoningEffortInput,
	REASONING_EFFORT_LEVELS,
	resolveHarnessEffortArg,
	stripEffortVariantSuffix,
	type EffortInspection,
} from "./effort.js";

export const DEFAULT_FLEET_NAME = "default";

export const CANONICAL_ROLES = [
	"Trabajo",
	"Auditoría",
	"Diseño",
	"Arquitectura",
	"Consultas",
	"Exploración",
	"Iconografía",
	"Voz",
	"Música",
] as const;

export interface RoleSlotDefaults {
	role: string;
	prefix: string;
	permissions: "read-only" | "workspace";
	concept: string;
	timeoutMs: number;
	idleTimeoutMs: number;
	hardCapMs: number;
}

export const ROLE_SLOT_DEFAULTS: Record<string, RoleSlotDefaults> = {
	Trabajo: {
		role: "Trabajo",
		prefix: "work",
		permissions: "workspace",
		concept: "implementación de código, fixes y refactors",
		timeoutMs: 3600000,
		idleTimeoutMs: 600000,
		hardCapMs: 14400000,
	},
	Auditoría: {
		role: "Auditoría",
		prefix: "audit",
		permissions: "read-only",
		concept: "revisión adversarial de bugs, seguridad y concurrencia",
		timeoutMs: 3600000,
		idleTimeoutMs: 600000,
		hardCapMs: 14400000,
	},
	Consultas: {
		role: "Consultas",
		prefix: "consult",
		permissions: "read-only",
		concept: "consultas técnicas complejas y dictámenes de tradeoffs",
		timeoutMs: 3600000,
		idleTimeoutMs: 600000,
		hardCapMs: 14400000,
	},
	Arquitectura: {
		role: "Arquitectura",
		prefix: "arch",
		permissions: "read-only",
		concept: "diseño arquitectónico, revisión de contratos y blast radius",
		timeoutMs: 3600000,
		idleTimeoutMs: 600000,
		hardCapMs: 14400000,
	},
	Exploración: {
		role: "Exploración",
		prefix: "explore",
		permissions: "read-only",
		concept: "mapeo de repositorio, localización de símbolos y lectura paralela",
		timeoutMs: 1800000,
		idleTimeoutMs: 300000,
		hardCapMs: 7200000,
	},
	Diseño: {
		role: "Diseño",
		prefix: "design",
		permissions: "workspace",
		concept: "interfaces HTML/3D, motion, composición y video",
		timeoutMs: 3600000,
		idleTimeoutMs: 600000,
		hardCapMs: 14400000,
	},
	Iconografía: {
		role: "Iconografía",
		prefix: "icon",
		permissions: "workspace",
		concept: "sets de iconos SVG originales con la identidad del proyecto",
		timeoutMs: 1800000,
		idleTimeoutMs: 600000,
		hardCapMs: 7200000,
	},
	Voz: {
		role: "Voz",
		prefix: "voice",
		permissions: "workspace",
		concept: "narraciones WAV por escena con Voicebox",
		timeoutMs: 3600000,
		idleTimeoutMs: 600000,
		hardCapMs: 14400000,
	},
	Música: {
		role: "Música",
		prefix: "music",
		permissions: "workspace",
		concept: "banda sonora con el motor Lofi Live AI",
		timeoutMs: 3600000,
		idleTimeoutMs: 600000,
		hardCapMs: 14400000,
	},
};

/** Legacy model-anchored agent keys mapped to role-slot names (Option 1). */
export const LEGACY_AGENT_ALIASES: Record<string, string> = {
	"work-glm": "work-1",
	"work-deepseek": "work-2",
	"work-mimo": "work-3",
	"explore-deepseek": "explore-1",
	"explore-glm": "explore-2",
	"explore-mimo": "explore-3",
	"consult-openai": "consult-1",
	"consult-mimo": "consult-2",
	"consult-claude": "consult-3",
	"consult-gemini38": "consult-4",
	"arch-gemini": "arch-1",
	"arch-claude": "arch-2",
	"arch-sol": "arch-3",
	"arch-deepseek": "arch-4",
	"audit-gemini": "audit-1",
	"audit-claude": "audit-2",
	"audit-deepseek": "audit-3",
	"audit-mimo": "audit-4",
	"audit-minimax": "audit-5",
	"design-opencode": "design-1",
	"design-gentle": "design-2",
	iconographer: "icon-1",
	"iconographer-mimo": "icon-2",
	"voice-narrator": "voice-1",
	"music-composer": "music-1",
};

const REVERSE_AGENT_ALIASES: Record<string, string[]> = Object.entries(LEGACY_AGENT_ALIASES).reduce(
	(acc, [legacy, canonical]) => {
		if (!acc[canonical]) acc[canonical] = [];
		acc[canonical].push(legacy);
		return acc;
	},
	{} as Record<string, string[]>,
);

export const ALL_SUPPORTED_HARNESSES = [
	"pi",
	"gentle-shell",
	"opencode",
	"mcode",
	"kimi",
	"qwen",
	"commandcode",
	"codex",
	"claude",
	"antigravity",
] as const;

export function getIduFleetsDir(): string {
	return join(getIduHome(), "fleets");
}

export function getIduFleetsRegistryPath(): string {
	return join(getIduHome(), "fleets.json");
}

export function normalizeFleetSlug(rawName: string): string {
	const cleaned = rawName
		.trim()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9._-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^[-.]+|[-.]+$/g, "");
	if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.length > 64) {
		throw new Error(
			`Nombre de perfil inválido "${rawName}". Usa letras, números, guiones o puntos (1-64 caracteres).`,
		);
	}
	return cleaned;
}

export function getFleetFilePath(fleetName: string): string {
	const slug = normalizeFleetSlug(fleetName);
	if (slug === DEFAULT_FLEET_NAME) {
		return getIduProfilesPath();
	}
	return join(getIduFleetsDir(), `${slug}.json`);
}

export function normalizeRoleLabel(raw: string): string {
	const key = raw
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
	if (key.startsWith("trabajo") || key.startsWith("work")) return "Trabajo";
	if (key.startsWith("auditoria") || key.startsWith("audit")) return "Auditoría";
	if (key.startsWith("diseno") || key.startsWith("design")) return "Diseño";
	if (key.startsWith("arquitectura") || key.startsWith("arch")) return "Arquitectura";
	if (key.startsWith("consult")) return "Consultas";
	if (key.startsWith("explor")) return "Exploración";
	if (key.startsWith("icon")) return "Iconografía";
	if (key.startsWith("voz") || key.startsWith("voice")) return "Voz";
	if (key.startsWith("musica") || key.startsWith("music")) return "Música";
	return raw.trim() || "Otros";
}

/** Infers canonical role name from explicit `ROL ...` description header or slot naming convention. */
export function inferProfileRole(name: string, profile: Pick<IduProfile, "description">): string {
	const desc = profile.description ?? "";
	const match = desc.match(/^ROL\s+([^:(\r\n]+)/i);
	if (match?.[1]) {
		return normalizeRoleLabel(match[1]);
	}
	const lower = name.toLowerCase();
	if (lower.startsWith("work")) return "Trabajo";
	if (lower.startsWith("audit")) return "Auditoría";
	if (lower.startsWith("design")) return "Diseño";
	if (lower.startsWith("arch")) return "Arquitectura";
	if (lower.startsWith("consult")) return "Consultas";
	if (lower.startsWith("explore")) return "Exploración";
	if (lower.startsWith("icon")) return "Iconografía";
	if (lower.startsWith("voice")) return "Voz";
	if (lower.startsWith("music")) return "Música";
	return "Otros";
}

/** Extracts priority ordinal `(1)`, `(2º)`, or numeric slot suffix (`work-2` -> 2). */
export function extractRoleRank(description = "", slotName = ""): number {
	const match = description.match(/ROL\s+[^:(\r\n]+\(\s*(\d+)/i);
	if (match?.[1]) {
		const n = Number.parseInt(match[1], 10);
		if (Number.isFinite(n) && n > 0) return n;
	}
	if (/\(principal\)/i.test(description)) return 1;
	const suffixMatch = slotName.match(/-(\d+)$/);
	if (suffixMatch?.[1]) {
		const n = Number.parseInt(suffixMatch[1], 10);
		if (Number.isFinite(n) && n > 0) return n;
	}
	if (/^ROL\s+[^:(\r\n]+:/i.test(description)) return 1;
	return 999;
}

export function nextAvailableSlotName(role: string, profiles: Record<string, IduProfile>): string {
	const canonicalRole = normalizeRoleLabel(role);
	const prefix = ROLE_SLOT_DEFAULTS[canonicalRole]?.prefix ?? "agent";
	let n = 1;
	while (profiles[`${prefix}-${n}`]) {
		n++;
	}
	return `${prefix}-${n}`;
}

export function normalizeProjectPathKey(dir: string): string {
	const resolved = resolve(dir);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function readFleetRegistry(): FleetRegistry {
	const regPath = getIduFleetsRegistryPath();
	if (!existsSync(regPath)) return {};
	try {
		const parsed = JSON.parse(readFileSync(regPath, "utf8")) as FleetRegistry;
		return {
			...(typeof parsed.activeFleet === "string" && parsed.activeFleet.trim()
				? { activeFleet: parsed.activeFleet.trim() }
				: {}),
			...(parsed.projectBindings && typeof parsed.projectBindings === "object"
				? { projectBindings: { ...parsed.projectBindings } }
				: {}),
		};
	} catch {
		return {};
	}
}

export function writeFleetRegistry(registry: FleetRegistry): void {
	ensureIduDirectories();
	writeJsonAtomic(getIduFleetsRegistryPath(), registry);
}

export interface EffectiveFleetResolution {
	fleetName: string;
	source: "explicit" | "env" | "project-local" | "project-binding" | "active" | "default";
	filePath: string;
	config: ProfilesConfig;
}

export function listFleets(): FleetSummary[] {
	ensureIduDirectories();
	const registry = readFleetRegistry();
	const activeName = registry.activeFleet ? normalizeFleetSlug(registry.activeFleet) : DEFAULT_FLEET_NAME;
	const defaultPath = getIduProfilesPath();
	const defaultCfg = parseProfilesConfigFile(defaultPath);
	const summaries: FleetSummary[] = [
		{
			name: DEFAULT_FLEET_NAME,
			path: defaultPath,
			isActive: activeName === DEFAULT_FLEET_NAME,
			isDefault: true,
			agentCount: Object.keys(defaultCfg.profiles).length,
			replaceDefaults: Boolean(defaultCfg.replaceDefaults),
			description: defaultCfg.description ?? "Perfil base global (~/.idu/profiles.json)",
			updatedAt: defaultCfg.updatedAt,
		},
	];

	const fleetsDir = getIduFleetsDir();
	if (existsSync(fleetsDir)) {
		const files = readdirSync(fleetsDir)
			.filter((f) => f.endsWith(".json"))
			.sort();
		for (const file of files) {
			const slug = file.slice(0, -5);
			if (slug === DEFAULT_FLEET_NAME) continue;
			const fullPath = join(fleetsDir, file);
			const cfg = parseProfilesConfigFile(fullPath);
			summaries.push({
				name: slug,
				path: fullPath,
				isActive: activeName === slug,
				isDefault: false,
				agentCount: Object.keys(cfg.profiles).length,
				replaceDefaults: Boolean(cfg.replaceDefaults),
				description: cfg.description,
				updatedAt: cfg.updatedAt,
			});
		}
	}

	return summaries;
}

function readNamedFleetOrThrow(rawName: string): { slug: string; filePath: string; config: ProfilesConfig } {
	const slug = normalizeFleetSlug(rawName);
	const filePath = getFleetFilePath(slug);
	if (slug !== DEFAULT_FLEET_NAME && !existsSync(filePath)) {
		const available = listFleets().map((f) => f.name).join(", ");
		throw new Error(`Perfil de flota "${rawName}" no encontrado en ${getIduFleetsDir()}. Disponibles: ${available}`);
	}
	return { slug, filePath, config: parseProfilesConfigFile(filePath) };
}

/**
 * Resolves the effective fleet config following deterministic precedence:
 * 1. Explicit `options.fleet`
 * 2. `process.env.IDU_FLEET`
 * 3. `<workingDir>/.idu/profiles.json` or `<workingDir>/.idu/fleet`
 * 4. Registered project binding in `~/.idu/fleets.json`
 * 5. Global `activeFleet` in `~/.idu/fleets.json`
 * 6. Default `~/.idu/profiles.json` (merged with `DEFAULT_PROFILES` unless `replaceDefaults: true`)
 */
export function resolveEffectiveFleet(options: ResolveProfilesOptions = {}): EffectiveFleetResolution {
	ensureIduDirectories();

	const explicitFleet = options.fleet?.trim();
	if (explicitFleet && !explicitFleet.startsWith("local:")) {
		const loaded = readNamedFleetOrThrow(explicitFleet);
		return {
			fleetName: loaded.slug,
			source: "explicit",
			filePath: loaded.filePath,
			config: loaded.config,
		};
	}

	const envFleet = process.env.IDU_FLEET?.trim();
	if (envFleet) {
		const loaded = readNamedFleetOrThrow(envFleet);
		return {
			fleetName: loaded.slug,
			source: "env",
			filePath: loaded.filePath,
			config: loaded.config,
		};
	}

	const workingDir = options.workingDir?.trim();
	if (workingDir) {
		// Never treat the user's global IDU_HOME (for example `~\\.idu` when CWD is `~`)
		// as a project-local fleet override.
		const localIduDir = join(workingDir, ".idu");
		const isGlobalIduHome = normalizeProjectPathKey(localIduDir) === normalizeProjectPathKey(getIduHome());
		const localProfilesPath = join(localIduDir, "profiles.json");
		if (!isGlobalIduHome && existsSync(localProfilesPath)) {
			return {
				fleetName: `local:${basename(resolve(workingDir))}`,
				source: "project-local",
				filePath: localProfilesPath,
				config: parseProfilesConfigFile(localProfilesPath),
			};
		}
		const localFleetMarker = join(localIduDir, "fleet");
		if (!isGlobalIduHome && existsSync(localFleetMarker)) {
			const markerName = readFileSync(localFleetMarker, "utf8").trim();
			if (markerName) {
				const slug = normalizeFleetSlug(markerName);
				const filePath = getFleetFilePath(slug);
				if (slug === DEFAULT_FLEET_NAME || existsSync(filePath)) {
					return {
						fleetName: slug,
						source: "project-local",
						filePath,
						config: parseProfilesConfigFile(filePath),
					};
				}
			}
		}
	}

	const registry = readFleetRegistry();
	if (workingDir && registry.projectBindings) {
		const boundName = registry.projectBindings[normalizeProjectPathKey(workingDir)];
		if (boundName) {
			const slug = normalizeFleetSlug(boundName);
			const filePath = getFleetFilePath(slug);
			if (slug === DEFAULT_FLEET_NAME || existsSync(filePath)) {
				return {
					fleetName: slug,
					source: "project-binding",
					filePath,
					config: parseProfilesConfigFile(filePath),
				};
			}
		}
	}

	if (registry.activeFleet) {
		const slug = normalizeFleetSlug(registry.activeFleet);
		const filePath = getFleetFilePath(slug);
		if (slug === DEFAULT_FLEET_NAME || existsSync(filePath)) {
			return {
				fleetName: slug,
				source: slug === DEFAULT_FLEET_NAME ? "default" : "active",
				filePath,
				config: parseProfilesConfigFile(filePath),
			};
		}
	}

	const defaultPath = getIduProfilesPath();
	return {
		fleetName: DEFAULT_FLEET_NAME,
		source: "default",
		filePath: defaultPath,
		config: parseProfilesConfigFile(defaultPath),
	};
}

/** Looks up an agent slot in a fleet, falling back to legacy/canonical aliases when needed. */
export function resolveAgentProfile<T>(
	profiles: Record<string, T>,
	requestedName: string,
): { resolvedName: string; profile: T; aliasedFrom?: string } | null {
	if (profiles[requestedName]) {
		return { resolvedName: requestedName, profile: profiles[requestedName] };
	}
	const canonical = LEGACY_AGENT_ALIASES[requestedName];
	if (canonical && profiles[canonical]) {
		return { resolvedName: canonical, profile: profiles[canonical], aliasedFrom: requestedName };
	}
	const reverseCandidates = REVERSE_AGENT_ALIASES[requestedName] ?? [];
	for (const legacyKey of reverseCandidates) {
		if (profiles[legacyKey]) {
			return { resolvedName: legacyKey, profile: profiles[legacyKey], aliasedFrom: requestedName };
		}
	}
	return null;
}

export function createFleet(options: {
	name: string;
	fromFleet?: string;
	empty?: boolean;
	description?: string;
	migrateAliases?: boolean;
	activate?: boolean;
}): FleetSummary {
	ensureIduDirectories();
	const slug = normalizeFleetSlug(options.name);
	if (slug === DEFAULT_FLEET_NAME) {
		throw new Error(`"${DEFAULT_FLEET_NAME}" es el perfil base del sistema y ya existe.`);
	}
	const filePath = getFleetFilePath(slug);
	if (existsSync(filePath)) {
		throw new Error(`El perfil "${slug}" ya existe en ${filePath}.`);
	}

	let baseConfig: ProfilesConfig;
	if (options.empty) {
		baseConfig = {
			name: slug,
			...(options.description ? { description: options.description } : {}),
			replaceDefaults: true,
			profiles: {},
			updatedAt: new Date().toISOString(),
		};
	} else {
		const source = resolveEffectiveFleet({ fleet: options.fromFleet });
		const clonedProfiles: Record<string, IduProfile> = {};
		for (const [k, v] of Object.entries(source.config.profiles)) {
			clonedProfiles[k] = { ...v };
		}
		const rawCfg: ProfilesConfig = {
			name: slug,
			description: options.description ?? `Copia de ${source.fleetName}`,
			replaceDefaults: source.config.replaceDefaults ?? true,
			profiles: clonedProfiles,
			updatedAt: new Date().toISOString(),
		};
		baseConfig = options.migrateAliases ? migrateProfilesToCanonicalSlots(rawCfg).migrated : rawCfg;
	}

	mkdirSync(getIduFleetsDir(), { recursive: true });
	writeJsonAtomic(filePath, baseConfig);

	if (options.activate) {
		useFleet(slug);
	}

	const registry = readFleetRegistry();
	return {
		name: slug,
		path: filePath,
		isActive: (registry.activeFleet ?? DEFAULT_FLEET_NAME) === slug,
		isDefault: false,
		agentCount: Object.keys(baseConfig.profiles).length,
		replaceDefaults: Boolean(baseConfig.replaceDefaults),
		description: baseConfig.description,
		updatedAt: baseConfig.updatedAt,
	};
}

export function useFleet(name: string): { activeFleet: string; summary: FleetSummary } {
	const loaded = readNamedFleetOrThrow(name);
	const registry = readFleetRegistry();
	if (loaded.slug === DEFAULT_FLEET_NAME) {
		delete registry.activeFleet;
	} else {
		registry.activeFleet = loaded.slug;
	}
	writeFleetRegistry(registry);
	return {
		activeFleet: loaded.slug,
		summary: {
			name: loaded.slug,
			path: loaded.filePath,
			isActive: true,
			isDefault: loaded.slug === DEFAULT_FLEET_NAME,
			agentCount: Object.keys(loaded.config.profiles).length,
			replaceDefaults: Boolean(loaded.config.replaceDefaults),
			description: loaded.config.description,
			updatedAt: loaded.config.updatedAt,
		},
	};
}

export function bindProjectFleet(name: string, workingDir: string): { fleetName: string; projectPath: string } {
	const loaded = readNamedFleetOrThrow(name);
	const key = normalizeProjectPathKey(workingDir);
	const registry = readFleetRegistry();
	registry.projectBindings = { ...(registry.projectBindings ?? {}), [key]: loaded.slug };
	writeFleetRegistry(registry);
	return { fleetName: loaded.slug, projectPath: resolve(workingDir) };
}

export function unbindProjectFleet(workingDir: string): { removed: boolean; projectPath: string } {
	const key = normalizeProjectPathKey(workingDir);
	const registry = readFleetRegistry();
	const had = Boolean(registry.projectBindings && key in registry.projectBindings);
	if (registry.projectBindings) {
		delete registry.projectBindings[key];
		if (Object.keys(registry.projectBindings).length === 0) {
			delete registry.projectBindings;
		}
	}
	writeFleetRegistry(registry);
	return { removed: had, projectPath: resolve(workingDir) };
}

export function renameFleet(oldName: string, newName: string): FleetSummary {
	const oldSlug = normalizeFleetSlug(oldName);
	const newSlug = normalizeFleetSlug(newName);
	if (oldSlug === DEFAULT_FLEET_NAME || newSlug === DEFAULT_FLEET_NAME) {
		throw new Error(`No se puede renombrar hacia o desde "${DEFAULT_FLEET_NAME}".`);
	}
	const oldPath = getFleetFilePath(oldSlug);
	const newPath = getFleetFilePath(newSlug);
	if (!existsSync(oldPath)) {
		throw new Error(`El perfil "${oldSlug}" no existe.`);
	}
	if (existsSync(newPath)) {
		throw new Error(`Ya existe un perfil llamado "${newSlug}".`);
	}
	const cfg = parseProfilesConfigFile(oldPath);
	cfg.name = newSlug;
	cfg.updatedAt = new Date().toISOString();
	writeJsonAtomic(newPath, cfg);
	rmSync(oldPath, { force: true });

	const registry = readFleetRegistry();
	if (registry.activeFleet === oldSlug) {
		registry.activeFleet = newSlug;
	}
	if (registry.projectBindings) {
		for (const [k, v] of Object.entries(registry.projectBindings)) {
			if (v === oldSlug) registry.projectBindings[k] = newSlug;
		}
	}
	writeFleetRegistry(registry);

	return {
		name: newSlug,
		path: newPath,
		isActive: (registry.activeFleet ?? DEFAULT_FLEET_NAME) === newSlug,
		isDefault: false,
		agentCount: Object.keys(cfg.profiles).length,
		replaceDefaults: Boolean(cfg.replaceDefaults),
		description: cfg.description,
		updatedAt: cfg.updatedAt,
	};
}

export function deleteFleet(name: string): { deleted: string; activeFleet: string } {
	const slug = normalizeFleetSlug(name);
	if (slug === DEFAULT_FLEET_NAME) {
		throw new Error(`No se puede eliminar el perfil base "${DEFAULT_FLEET_NAME}".`);
	}
	const filePath = getFleetFilePath(slug);
	if (!existsSync(filePath)) {
		throw new Error(`El perfil "${slug}" no existe.`);
	}
	rmSync(filePath, { force: true });

	const registry = readFleetRegistry();
	if (registry.activeFleet === slug) {
		delete registry.activeFleet;
	}
	if (registry.projectBindings) {
		for (const [k, v] of Object.entries(registry.projectBindings)) {
			if (v === slug) delete registry.projectBindings[k];
		}
		if (Object.keys(registry.projectBindings).length === 0) {
			delete registry.projectBindings;
		}
	}
	writeFleetRegistry(registry);

	return {
		deleted: slug,
		activeFleet: registry.activeFleet ?? DEFAULT_FLEET_NAME,
	};
}

export interface ParsedModelSpec {
	raw: string;
	provider: string | null;
	modelId: string;
	display: string;
	effortSuffix?: ReasoningEffort;
}

/**
 * Parses manual or catalog model specs such as:
 * - `nan/kimi-k3.1-pro`
 * - `custom_provider:nan/kimi-k3.1-pro`
 * - `openai/gpt-6.1-terra`
 * - `anthropic/opus` or `opus`
 * - `openrouter/qwen/qwen3-coder:free`
 * - `opencode-go/deepseek-v4.1-flash#max`
 */
export function parseModelSpec(rawInput: string, fallbackProvider?: string | null): ParsedModelSpec {
	const trimmed = rawInput.trim();
	if (!trimmed) {
		throw new Error("El modelo no puede estar vacío.");
	}
	const stripped = stripEffortVariantSuffix(trimmed);
	const effortSuffix = stripped.effortSuffix;
	const unwrapped = stripped.model.replace(/^custom_provider:/i, "");
	const slashIdx = unwrapped.indexOf("/");
	if (slashIdx !== -1) {
		const provider = unwrapped.slice(0, slashIdx).trim().toLowerCase();
		const modelId = unwrapped.slice(slashIdx + 1).trim();
		if (!modelId) {
			throw new Error(`Formato de modelo inválido: "${rawInput}".`);
		}
		return {
			raw: trimmed,
			provider,
			modelId,
			display: `${provider}/${modelId}`,
			...(effortSuffix ? { effortSuffix } : {}),
		};
	}

	const lower = unwrapped.toLowerCase();
	let inferredProvider = fallbackProvider?.trim().toLowerCase() || null;
	if (!inferredProvider) {
		if (lower === "opus" || lower === "sonnet" || lower === "haiku" || lower.startsWith("claude-")) {
			inferredProvider = "anthropic";
		} else if (lower.startsWith("gemini-")) {
			inferredProvider = "antigravity";
		} else if (lower.startsWith("gpt-")) {
			inferredProvider = "openai";
		}
	}

	return {
		raw: trimmed,
		provider: inferredProvider,
		modelId: unwrapped,
		display: inferredProvider ? `${inferredProvider}/${unwrapped}` : unwrapped,
		...(effortSuffix ? { effortSuffix } : {}),
	};
}

/** Converts canonical `{ provider, modelId }` into exact CLI-specific `{ provider?, model, streams }` fields. */
export function formatProfileFieldsForHarness(
	rawHarness: string,
	spec: ParsedModelSpec,
): { harness: string; provider?: string; model: string; streams: boolean } {
	const harness = canonicalHarnessName(rawHarness.trim().toLowerCase());
	const prov = spec.provider?.toLowerCase() ?? null;
	const id = spec.modelId;

	switch (harness) {
		case "claude":
			return { harness: "claude", provider: "anthropic", model: id, streams: true };
		case "antigravity":
			return { harness: "antigravity", model: id, streams: true };
		case "pi":
		case "gentle-shell":
		case "qwen":
			return {
				harness,
				...(prov ? { provider: prov } : {}),
				model: id,
				streams: false,
			};
		case "opencode":
			if (prov === "nan") {
				return { harness: "opencode", provider: "nan", model: id, streams: false };
			}
			return {
				harness: "opencode",
				model: prov ? `${prov}/${id}` : id,
				streams: false,
			};
		case "mcode":
			if (!prov) {
				return { harness: "mcode", model: id, streams: false };
			}
			if (prov === "minimax") {
				return { harness: "mcode", model: `minimax/${id}`, streams: false };
			}
			return {
				harness: "mcode",
				model: `custom_provider:${prov}/${id}`,
				streams: false,
			};
		case "kimi":
		case "commandcode":
			return {
				harness,
				model: prov ? `${prov}/${id}` : id,
				streams: false,
			};
		case "codex":
			return {
				harness: "codex",
				...(prov ? { provider: prov } : {}),
				model: id,
				streams: false,
			};
		default:
			return {
				harness,
				...(prov ? { provider: prov } : {}),
				model: id,
				streams: false,
			};
	}
}

export interface HarnessCompatibilityInfo {
	harness: string;
	compatible: boolean;
	available: boolean;
	reason?: string;
}

export function checkHarnessModelCompatibility(
	rawHarness: string,
	spec: ParsedModelSpec,
	available = true,
): HarnessCompatibilityInfo {
	const harness = canonicalHarnessName(rawHarness.trim().toLowerCase());
	const prov = spec.provider?.toLowerCase() ?? null;
	const modelLower = spec.modelId.toLowerCase();

	if (prov === "nan") {
		if (harness === "claude") {
			return {
				harness,
				compatible: false,
				available,
				reason: "Claude Code solo habla Anthropic /v1/messages; no soporta Nan.",
			};
		}
		if (harness === "antigravity") {
			return {
				harness,
				compatible: false,
				available,
				reason: "Antigravity (agy) usa OAuth propio; no acepta BYOK Nan.",
			};
		}
		return { harness, compatible: true, available };
	}

	if (prov === "anthropic") {
		if (harness === "claude" || harness === "opencode") {
			return { harness, compatible: true, available };
		}
		return {
			harness,
			compatible: false,
			available,
			reason: `${harness} no enruta proveedor anthropic nativo.`,
		};
	}

	if (prov === "antigravity") {
		return harness === "antigravity"
			? { harness, compatible: true, available }
			: { harness, compatible: false, available, reason: "Los modelos antigravity corren solo en agy." };
	}

	if (prov === "openai" || prov === "openai-codex") {
		if (harness === "opencode" || harness === "codex" || harness === "pi" || harness === "commandcode") {
			return { harness, compatible: true, available };
		}
		return {
			harness,
			compatible: false,
			available,
			reason: `${harness} no soporta proveedor ${prov}.`,
		};
	}

	if (prov === "minimax") {
		if (harness === "mcode" && /minimax-m3\.1-flash/i.test(modelLower)) {
			return {
				harness,
				compatible: false,
				available,
				reason: "mcode restringe la ruta nativa minimax-m3.1-flash; usá cmdc.",
			};
		}
		if (harness === "mcode" || harness === "commandcode" || harness === "pi" || harness === "opencode") {
			return { harness, compatible: true, available };
		}
		return { harness, compatible: false, available, reason: `${harness} no enruta minimax nativo.` };
	}

	if (prov === "xiaomi" || prov === "deepseek" || prov === "command-code") {
		if (harness === "commandcode" || harness === "opencode" || harness === "pi") {
			return { harness, compatible: true, available };
		}
		return { harness, compatible: false, available, reason: `${harness} no enruta gateway ${prov}.` };
	}

	if (prov === "openrouter" || prov === "groq" || prov === "nvidia") {
		if (harness === "pi" || (prov === "openrouter" && harness === "opencode")) {
			return { harness, compatible: true, available };
		}
		return { harness, compatible: false, available, reason: `${harness} no tiene soporte directo para ${prov}.` };
	}

	return { harness, compatible: true, available };
}

export function listCompatibleHarnessesForModel(
	spec: ParsedModelSpec,
	installedClis: Array<{ name: string; available: boolean }>,
): HarnessCompatibilityInfo[] {
	const byName = new Map(installedClis.map((c) => [canonicalHarnessName(c.name), c.available]));
	return ALL_SUPPORTED_HARNESSES.map((harness) =>
		checkHarnessModelCompatibility(harness, spec, byName.get(harness) ?? false),
	);
}

const STALE_MODEL_RE =
	/\b(?:hy4|glm[\s-]?5\.3|deepseek|mimo|kimi[\s-]?k3|opus|sonnet|haiku|gemini|gpt-[0-9]|terra|sol|minimax)\b/i;

function formatOrdinalLabel(rank: number): string {
	if (rank <= 1) return "1º";
	return `${rank}º`;
}

function extractCleanCapabilityPhrase(role: string, existingDescription?: string): string {
	const fallback = ROLE_SLOT_DEFAULTS[role]?.concept ?? "ejecución especializada";
	if (!existingDescription?.trim()) return fallback;

	let body = existingDescription.replace(/^ROL\s+[^:(\r\n]+(?:\([^)]*\))?:\s*/i, "").trim();
	// Strip trailing runtime sentence like `pi + DeepSeek V4 Flash (nan)` or `opencode + deepseek-v4.1-flash · effort: max.`
	body = body
		.replace(/\s+(?:pi|opencode|mcode|kimi|qwen|gentle-shell|cmdc|commandcode|claude|codex|antigravity|agy)\s*\+\s+.+\.?\s*$/i, "")
		.trim();
	// Strip trailing parenthetical containing metrics, benchmark tags, or migration notes.
	body = body
		.replace(/\s*\((?:[^)]*(?:\d+%|\d+\.\d+s|tok|score|bench|migrado|test|manual|auto-optimize|effort|lane|suscripci)[^)]*)\)\.?\s*$/i, "")
		.trim()
		.replace(/\.+$/, "");

	if (!body || STALE_MODEL_RE.test(body)) {
		return fallback;
	}
	return body;
}

export interface DescriptionBenchmarkSummary {
	taskId: string;
	resolved: boolean;
	regressionsClean: boolean;
	durationMs: number;
	totalTokens: number | null;
	score: number;
	testedCount?: number;
	recommended?: boolean;
}

export function buildDynamicProfileDescription(params: {
	slotName: string;
	role: string;
	rank?: number;
	existingDescription?: string;
	harness: string;
	provider?: string;
	model?: string;
	effort?: ReasoningEffort;
	benchmark?: DescriptionBenchmarkSummary;
	manualNote?: string;
}): string {
	const canonicalRole = normalizeRoleLabel(params.role);
	const rank = params.rank && params.rank < 999 ? params.rank : extractRoleRank(params.existingDescription, params.slotName);
	const headerRank = rank < 999 ? ` (${formatOrdinalLabel(rank)})` : "";
	const header = `ROL ${canonicalRole.toUpperCase()}${headerRank}:`;
	const capability = extractCleanCapabilityPhrase(canonicalRole, params.existingDescription);

	const rawModel = (params.model ?? "default").replace(/^custom_provider:/, "");
	const modelDisplay =
		params.provider && !rawModel.startsWith(`${params.provider}/`)
			? `${rawModel} (${params.provider})`
			: rawModel;
	const effortTag =
		params.effort && !rawModel.toLowerCase().includes(`#${params.effort}`)
			? ` · effort: ${params.effort}`
			: "";
	const runtimeTag = `${params.harness} + ${modelDisplay}${effortTag}`;

	if (params.benchmark) {
		const b = params.benchmark;
		const statusLabel = b.resolved && b.regressionsClean ? "100%" : b.resolved ? "resuelto c/regresión" : "parcial";
		const sec = `${(b.durationMs / 1000).toFixed(1)}s`;
		const tok = b.totalTokens !== null ? `, ${Math.round(b.totalTokens / 1000)}k tok` : "";
		const rec =
			b.recommended && b.testedCount && b.testedCount > 1
				? `, recomendada entre ${b.testedCount} terminales`
				: b.recommended
					? ", terminal recomendada"
					: "";
		return `${header} ${capability} (${b.taskId}: ${statusLabel}, ${sec}${tok}, score ${b.score}${rec}). ${runtimeTag}.`;
	}

	const note = params.manualNote?.trim() || "configuración manual";
	return `${header} ${capability} (${note}). ${runtimeTag}.`;
}

/** Renames legacy model-anchored keys (`work-mimo`, etc.) to clean role-slot keys (`work-3`, etc.). */
export function migrateProfilesToCanonicalSlots(
	config: ProfilesConfig,
	options: { refreshDescriptions?: boolean } = {},
): { migrated: ProfilesConfig; renamed: Array<{ from: string; to: string }> } {
	const nextProfiles: Record<string, IduProfile> = {};
	const renamed: Array<{ from: string; to: string }> = [];

	for (const [key, prof] of Object.entries(config.profiles)) {
		const targetKey = LEGACY_AGENT_ALIASES[key] ?? key;
		if (targetKey !== key) {
			if (!nextProfiles[targetKey] && !config.profiles[targetKey]) {
				renamed.push({ from: key, to: targetKey });
			} else {
				// Avoid clobbering an already-present canonical key.
				nextProfiles[key] = { ...prof };
				continue;
			}
		}

		const copy: IduProfile = { ...prof };
		if (options.refreshDescriptions) {
			const role = inferProfileRole(targetKey, copy);
			const rank = extractRoleRank(copy.description, targetKey);
			const parsed = parseModelSpec(copy.model ?? "default", copy.provider);
			copy.description = buildDynamicProfileDescription({
				slotName: targetKey,
				role,
				rank,
				existingDescription: copy.description,
				harness: canonicalHarnessName(copy.harness),
				provider: parsed.provider ?? copy.provider,
				model: parsed.modelId,
				effort: copy.effort ?? parsed.effortSuffix,
				manualNote: "slot desacoplado de modelo",
			});
		}
		nextProfiles[targetKey] = copy;
	}

	return {
		migrated: {
			...config,
			profiles: nextProfiles,
			updatedAt: new Date().toISOString(),
		},
		renamed,
	};
}

/** Updates or creates one agent slot in a fleet file atomically, creating a timestamped backup first. */
export function upsertFleetAgent(params: {
	fleet?: string;
	workingDir?: string;
	slotName: string;
	profile: IduProfile;
	backup?: boolean;
}): { fleetName: string; filePath: string; backupPath: string | null; slotName: string; profile: IduProfile } {
	ensureIduDirectories();
	const resolved = resolveEffectiveFleet({ fleet: params.fleet, workingDir: params.workingDir });
	const rawOnDisk: ProfilesConfig = existsSync(resolved.filePath)
		? (JSON.parse(readFileSync(resolved.filePath, "utf8")) as ProfilesConfig)
		: {
				...(resolved.fleetName !== DEFAULT_FLEET_NAME ? { name: resolved.fleetName } : {}),
				replaceDefaults: resolved.config.replaceDefaults ?? false,
				profiles: {},
			};

	let backupPath: string | null = null;
	if (params.backup !== false && existsSync(resolved.filePath)) {
		backupPath = `${resolved.filePath}.bak-${Date.now()}`;
		copyFileSync(resolved.filePath, backupPath);
	}

	const nextCfg: ProfilesConfig = {
		...rawOnDisk,
		profiles: {
			...(rawOnDisk.profiles ?? {}),
			[params.slotName]: params.profile,
		},
		updatedAt: new Date().toISOString(),
	};
	writeJsonAtomic(resolved.filePath, nextCfg);
	return {
		fleetName: resolved.fleetName,
		filePath: resolved.filePath,
		backupPath,
		slotName: params.slotName,
		profile: params.profile,
	};
}

export function deleteFleetAgent(params: {
	fleet?: string;
	workingDir?: string;
	slotName: string;
	backup?: boolean;
}): { fleetName: string; filePath: string; backupPath: string | null; removed: boolean } {
	ensureIduDirectories();
	const resolved = resolveEffectiveFleet({ fleet: params.fleet, workingDir: params.workingDir });
	if (!existsSync(resolved.filePath)) {
		return { fleetName: resolved.fleetName, filePath: resolved.filePath, backupPath: null, removed: false };
	}
	const rawOnDisk = JSON.parse(readFileSync(resolved.filePath, "utf8")) as ProfilesConfig;
	if (!rawOnDisk.profiles || !(params.slotName in rawOnDisk.profiles)) {
		return { fleetName: resolved.fleetName, filePath: resolved.filePath, backupPath: null, removed: false };
	}

	let backupPath: string | null = null;
	if (params.backup !== false) {
		backupPath = `${resolved.filePath}.bak-${Date.now()}`;
		copyFileSync(resolved.filePath, backupPath);
	}

	delete rawOnDisk.profiles[params.slotName];
	rawOnDisk.updatedAt = new Date().toISOString();
	writeJsonAtomic(resolved.filePath, rawOnDisk);
	return { fleetName: resolved.fleetName, filePath: resolved.filePath, backupPath, removed: true };
}

/** Writes a project-local `.idu/fleet` pointer file in `workingDir`. */
export function writeLocalFleetMarker(fleetName: string, workingDir: string): string {
	const loaded = readNamedFleetOrThrow(fleetName);
	const dir = join(resolve(workingDir), ".idu");
	mkdirSync(dir, { recursive: true });
	const marker = join(dir, "fleet");
	writeFileSync(marker, `${loaded.slug}\n`, "utf8");
	return marker;
}

export function getCanonicalDefaultFallbackProfiles(): Record<string, IduProfile> {
	return { ...DEFAULT_PROFILES.profiles };
}

/** Migrates a fleet file on disk from legacy model-anchored keys (`work-mimo`, etc.) to canonical role slots (`work-3`, etc.) with backup. */
export function migrateFleetFile(options: {
	fleet?: string;
	workingDir?: string;
	refreshDescriptions?: boolean;
} = {}): {
	fleetName: string;
	filePath: string;
	backupPath: string | null;
	renamed: Array<{ from: string; to: string }>;
} {
	ensureIduDirectories();
	const resolved = resolveEffectiveFleet({ fleet: options.fleet, workingDir: options.workingDir });
	const rawOnDisk: ProfilesConfig = existsSync(resolved.filePath)
		? (JSON.parse(readFileSync(resolved.filePath, "utf8")) as ProfilesConfig)
		: resolved.config;

	const { migrated, renamed } = migrateProfilesToCanonicalSlots(rawOnDisk, {
		refreshDescriptions: options.refreshDescriptions,
	});
	if (renamed.length === 0 && !options.refreshDescriptions) {
		return {
			fleetName: resolved.fleetName,
			filePath: resolved.filePath,
			backupPath: null,
			renamed: [],
		};
	}

	let backupPath: string | null = null;
	if (existsSync(resolved.filePath)) {
		backupPath = `${resolved.filePath}.bak-${Date.now()}`;
		copyFileSync(resolved.filePath, backupPath);
	}
	writeJsonAtomic(resolved.filePath, migrated);
	return {
		fleetName: resolved.fleetName,
		filePath: resolved.filePath,
		backupPath,
		renamed,
	};
}

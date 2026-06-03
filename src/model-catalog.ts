import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ModelCatalogSource =
	| "pi-registry"
	| "gentle-routing"
	| "profile"
	| "custom"
	| "snapshot";

export type ModelCatalogInputModel = {
	provider: string;
	id: string;
	name?: string;
	inputCost?: number;
	outputCost?: number;
};

export type UnifiedModelCatalogEntry = {
	canonicalId: string;
	provider: string;
	modelId: string;
	label: string;
	aliases: string[];
	sources: ModelCatalogSource[];
	costLabel?: string;
};

export type UnifiedModelCatalog = {
	entries: UnifiedModelCatalogEntry[];
	limitations: string[];
};

export type PiModelCatalogSnapshot = {
	version: 1;
	generatedAt: string;
	source: "pi-model-registry";
	models: ModelCatalogInputModel[];
};

const SAFE_MODEL_SEGMENT_RE = /^[A-Za-z0-9._~:@%+-]+$/u;

export function normalizeModelCatalogId(value: string): string | undefined {
	const trimmed = value.trim();
	const [provider, ...modelSegments] = trimmed.split("/");
	if (!provider || modelSegments.length === 0) return undefined;
	if (!SAFE_MODEL_SEGMENT_RE.test(provider)) return undefined;
	if (
		modelSegments.some(
			(segment) =>
				!segment ||
				segment === "." ||
				segment === ".." ||
				!SAFE_MODEL_SEGMENT_RE.test(segment),
		)
	) {
		return undefined;
	}
	return `${provider}/${modelSegments.join("/")}`;
}

export function resolvePiModelCatalogSnapshotPath(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const override = env.IDU_PI_MODEL_CATALOG_PATH?.trim();
	if (override) return override;
	const home = env.USERPROFILE?.trim() || env.HOME?.trim() || homedir();
	return join(home, ".pi", "idu-pi", "model-catalog.json");
}

export function readPiModelCatalogSnapshot(
	path: string,
): PiModelCatalogSnapshot | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		return parsePiModelCatalogSnapshot(parsed);
	} catch {
		return undefined;
	}
}

export function parsePiModelCatalogSnapshot(
	value: unknown,
): PiModelCatalogSnapshot | undefined {
	if (!isRecord(value)) return undefined;
	if (value.version !== 1) return undefined;
	if (value.source !== "pi-model-registry") return undefined;
	if (typeof value.generatedAt !== "string" || !value.generatedAt.trim()) {
		return undefined;
	}
	if (!Array.isArray(value.models)) return undefined;
	const models = value.models.flatMap((model) => {
		const sanitized = sanitizeSnapshotModel(model);
		return sanitized ? [sanitized] : [];
	});
	return {
		version: 1,
		generatedAt: value.generatedAt,
		source: "pi-model-registry",
		models,
	};
}

export function buildUnifiedModelCatalog(input: {
	piModels?: ModelCatalogInputModel[];
	snapshotModels?: ModelCatalogInputModel[];
	gentleModelIds?: string[];
	profileModelIds?: string[];
	customModelIds?: string[];
}): UnifiedModelCatalog {
	const byId = new Map<string, UnifiedModelCatalogEntry>();
	const add = (
		canonicalId: string | undefined,
		source: ModelCatalogSource,
		label?: string,
		costLabel?: string,
	) => {
		if (!canonicalId) return;
		const [provider, ...rest] = canonicalId.split("/");
		const modelId = rest.join("/");
		if (!provider || !modelId) return;
		const current = byId.get(canonicalId) ?? {
			canonicalId,
			provider,
			modelId,
			label: label?.trim() || modelId,
			aliases: [],
			sources: [],
		};
		for (const alias of [label, modelId]) {
			const normalized = alias?.trim();
			if (normalized && !current.aliases.includes(normalized)) {
				current.aliases.push(normalized);
			}
		}
		if (costLabel && !current.costLabel) current.costLabel = costLabel;
		if (!current.sources.includes(source)) current.sources.push(source);
		byId.set(canonicalId, current);
	};
	for (const model of input.piModels ?? []) {
		add(
			normalizeModelCatalogId(`${model.provider}/${model.id}`),
			"pi-registry",
			model.name,
			formatCostLabel(model),
		);
	}
	for (const model of input.snapshotModels ?? []) {
		add(
			normalizeModelCatalogId(`${model.provider}/${model.id}`),
			"snapshot",
			model.name,
			formatCostLabel(model),
		);
	}
	for (const modelId of input.gentleModelIds ?? []) {
		add(normalizeModelCatalogId(modelId), "gentle-routing");
	}
	for (const modelId of input.profileModelIds ?? []) {
		add(normalizeModelCatalogId(modelId), "profile");
	}
	for (const modelId of input.customModelIds ?? []) {
		add(normalizeModelCatalogId(modelId), "custom");
	}
	return {
		entries: sortEntries([...byId.values()]),
		limitations: [],
	};
}

export function groupModelCatalogByProvider(
	entries: UnifiedModelCatalogEntry[],
): Array<{ provider: string; models: UnifiedModelCatalogEntry[] }> {
	const groups = new Map<string, UnifiedModelCatalogEntry[]>();
	for (const entry of entries) {
		groups.set(entry.provider, [...(groups.get(entry.provider) ?? []), entry]);
	}
	return [...groups.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([provider, models]) => ({
			provider,
			models: sortEntries(models),
		}));
}

function sortEntries(
	entries: UnifiedModelCatalogEntry[],
): UnifiedModelCatalogEntry[] {
	return [...entries].sort(
		(left, right) =>
			left.provider.localeCompare(right.provider) ||
			left.label.localeCompare(right.label) ||
			left.canonicalId.localeCompare(right.canonicalId),
	);
}

function sanitizeSnapshotModel(
	value: unknown,
): ModelCatalogInputModel | undefined {
	if (!isRecord(value)) return undefined;
	if (typeof value.provider !== "string" || typeof value.id !== "string") {
		return undefined;
	}
	const provider = value.provider.trim();
	const id = value.id.trim();
	if (!normalizeModelCatalogId(`${provider}/${id}`)) return undefined;
	const model: ModelCatalogInputModel = { provider, id };
	if (typeof value.name === "string" && value.name.trim()) {
		model.name = value.name.trim();
	}
	if (typeof value.inputCost === "number" && Number.isFinite(value.inputCost)) {
		model.inputCost = value.inputCost;
	}
	if (
		typeof value.outputCost === "number" &&
		Number.isFinite(value.outputCost)
	) {
		model.outputCost = value.outputCost;
	}
	return model;
}

function formatCostLabel(model: ModelCatalogInputModel): string | undefined {
	if (model.inputCost === undefined && model.outputCost === undefined) {
		return undefined;
	}
	const input = model.inputCost === undefined ? "?" : `$${model.inputCost}`;
	const output = model.outputCost === undefined ? "?" : `$${model.outputCost}`;
	return `${input}/${output}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

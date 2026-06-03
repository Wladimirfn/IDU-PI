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

export function buildUnifiedModelCatalog(input: {
	piModels?: ModelCatalogInputModel[];
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

function formatCostLabel(model: ModelCatalogInputModel): string | undefined {
	if (model.inputCost === undefined && model.outputCost === undefined) {
		return undefined;
	}
	const input = model.inputCost === undefined ? "?" : `$${model.inputCost}`;
	const output = model.outputCost === undefined ? "?" : `$${model.outputCost}`;
	return `${input}/${output}`;
}

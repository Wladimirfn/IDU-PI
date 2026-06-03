import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildUnifiedModelCatalog,
	groupModelCatalogByProvider,
	normalizeModelCatalogId,
} from "../src/model-catalog.js";

test("unified catalog deduplicates by provider/model id and preserves sources", () => {
	const catalog = buildUnifiedModelCatalog({
		piModels: [
			{ provider: "openai", id: "gpt-5.4", name: "GPT-5.4" },
			{ provider: "minimax", id: "MiniMax-M2.7", name: "MiniMax M2.7" },
		],
		gentleModelIds: ["openai/gpt-5.4", "opencode/minimax-m2.5-free"],
		profileModelIds: ["openai/gpt-5.4"],
		customModelIds: ["openai/gpt-5.4"],
	});

	assert.equal(catalog.entries.length, 3);
	const openai = catalog.entries.find(
		(entry) => entry.canonicalId === "openai/gpt-5.4",
	);
	assert.deepEqual([...(openai?.sources ?? [])].sort(), [
		"custom",
		"gentle-routing",
		"pi-registry",
		"profile",
	]);
	assert.deepEqual(openai?.aliases, ["GPT-5.4", "gpt-5.4"]);
	assert.ok(
		catalog.entries.some(
			(entry) => entry.canonicalId === "minimax/MiniMax-M2.7",
		),
	);
	assert.ok(
		catalog.entries.some(
			(entry) => entry.canonicalId === "opencode/minimax-m2.5-free",
		),
	);
});

test("catalog groups providers without hardcoding MiniMax or OpenCode", () => {
	const catalog = buildUnifiedModelCatalog({
		piModels: [
			{ provider: "minimax", id: "MiniMax-M2.7", name: "MiniMax M2.7" },
			{ provider: "opencode", id: "gpt-5.4", name: "GPT-5.4 via OpenCode" },
		],
	});
	const providers = groupModelCatalogByProvider(catalog.entries).map(
		(group) => group.provider,
	);
	assert.deepEqual(providers, ["minimax", "opencode"]);
});

test("normalizeModelCatalogId accepts provider/model and rejects unsafe text", () => {
	assert.equal(normalizeModelCatalogId("openai/gpt-5.4"), "openai/gpt-5.4");
	assert.equal(
		normalizeModelCatalogId(" minimax/MiniMax-M2.7 "),
		"minimax/MiniMax-M2.7",
	);
	assert.equal(
		normalizeModelCatalogId("openrouter/meta/llama-3.1-405b"),
		"openrouter/meta/llama-3.1-405b",
	);
	assert.equal(normalizeModelCatalogId("not a model"), undefined);
	assert.equal(normalizeModelCatalogId("openai/gpt 5.4"), undefined);
	assert.equal(normalizeModelCatalogId("openai/../secret"), undefined);
});

test("catalog keeps dynamic provider names and sorts models inside provider groups", () => {
	const catalog = buildUnifiedModelCatalog({
		piModels: [
			{ provider: "custom-provider", id: "zeta", name: "Zeta" },
			{ provider: "custom-provider", id: "alpha", name: "Alpha" },
		],
	});
	const [group] = groupModelCatalogByProvider(catalog.entries);
	assert.equal(group?.provider, "custom-provider");
	assert.deepEqual(
		group?.models.map((entry) => entry.canonicalId),
		["custom-provider/alpha", "custom-provider/zeta"],
	);
});

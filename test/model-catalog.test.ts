import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	buildUnifiedModelCatalog,
	groupModelCatalogByProvider,
	normalizeModelCatalogId,
	readPiModelCatalogSnapshot,
	resolvePiModelCatalogSnapshotPath,
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

test("readPiModelCatalogSnapshot accepts valid snapshots and drops invalid model entries", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-model-catalog-"));
	try {
		const path = join(root, "model-catalog.json");
		writeFileSync(
			path,
			JSON.stringify({
				version: 1,
				generatedAt: "2026-06-03T00:00:00.000Z",
				source: "pi-model-registry",
				models: [
					{
						provider: "minimax",
						id: "MiniMax-M2.7",
						name: "MiniMax M2.7",
						inputCost: 0.1,
						outputCost: 0.2,
					},
					{ provider: "openrouter", id: "meta/llama-3.1-405b" },
					{ provider: "openai", id: "../secret" },
					{ provider: "bad provider", id: "model" },
					{ provider: "openai", id: "gpt-5.4", inputCost: Number.NaN },
				],
			}),
			"utf8",
		);
		const snapshot = readPiModelCatalogSnapshot(path);
		assert.equal(snapshot?.version, 1);
		assert.equal(snapshot?.source, "pi-model-registry");
		assert.deepEqual(
			snapshot?.models.map((model) => `${model.provider}/${model.id}`),
			[
				"minimax/MiniMax-M2.7",
				"openrouter/meta/llama-3.1-405b",
				"openai/gpt-5.4",
			],
		);
		assert.equal(snapshot?.models[0]?.name, "MiniMax M2.7");
		assert.equal(snapshot?.models[0]?.inputCost, 0.1);
		assert.equal(snapshot?.models[2]?.inputCost, undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("readPiModelCatalogSnapshot rejects invalid outer snapshot shapes", () => {
	const root = mkdtempSync(join(tmpdir(), "idu-model-catalog-invalid-"));
	try {
		const path = join(root, "model-catalog.json");
		for (const value of [
			{
				version: 2,
				generatedAt: "now",
				source: "pi-model-registry",
				models: [],
			},
			{ version: 1, generatedAt: "now", source: "other", models: [] },
			{ version: 1, generatedAt: "now", source: "pi-model-registry" },
		]) {
			writeFileSync(path, JSON.stringify(value), "utf8");
			assert.equal(readPiModelCatalogSnapshot(path), undefined);
		}
		writeFileSync(path, "{not json", "utf8");
		assert.equal(readPiModelCatalogSnapshot(path), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("snapshot models merge with other catalog sources and dedupe", () => {
	const catalog = buildUnifiedModelCatalog({
		snapshotModels: [
			{ provider: "minimax", id: "MiniMax-M2.7", name: "MiniMax M2.7" },
		],
		gentleModelIds: ["minimax/MiniMax-M2.7"],
		profileModelIds: ["minimax/MiniMax-M2.7"],
	});
	assert.equal(catalog.entries.length, 1);
	assert.equal(catalog.entries[0]?.canonicalId, "minimax/MiniMax-M2.7");
	assert.deepEqual([...(catalog.entries[0]?.sources ?? [])].sort(), [
		"gentle-routing",
		"profile",
		"snapshot",
	]);
});

test("resolvePiModelCatalogSnapshotPath supports override and defaults under home", () => {
	assert.equal(
		resolvePiModelCatalogSnapshotPath({
			IDU_PI_MODEL_CATALOG_PATH: "C:/tmp/model-catalog.json",
		}),
		"C:/tmp/model-catalog.json",
	);
	assert.equal(
		resolvePiModelCatalogSnapshotPath({ USERPROFILE: "C:/Users/test" }).replace(
			/\\/gu,
			"/",
		),
		"C:/Users/test/.pi/idu-pi/model-catalog.json",
	);
});

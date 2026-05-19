import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	cleanAgentOutput,
	LabReportStore,
	type LabRunRecord,
	stripEngramNoise,
	summarizeOutput,
} from "../src/lab-reports.js";

const tempRoots: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-telegram-lab-"));
	tempRoots.push(dir);
	return dir;
}

after(async () => {
	await Promise.all(
		tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

function record(id: string): LabRunRecord {
	return {
		id,
		projectId: "p",
		projectPath: "C:/p",
		agentId: "spark",
		agentLabel: "Spark",
		workspace: "C:/w",
		durationLabel: "1m",
		durationMs: 60_000,
		status: "completed",
		summary: `summary ${id}`,
		startedAt: "2026-01-01T00:00:00.000Z",
		finishedAt: "2026-01-01T00:01:00.000Z",
	};
}

test("LabReportStore appends, lists newest first, and gets by id", () => {
	const store = new LabReportStore(tempDir());
	store.append(record("a"));
	store.append(record("b"));

	assert.deepEqual(
		store.list().map((entry) => entry.id),
		["b", "a"],
	);
	assert.equal(store.get("a")?.summary, "summary a");
	assert.equal(store.get("missing"), undefined);
});

test("cleanAgentOutput removes tool noise before summaries", () => {
	const output =
		"[tool:mem_context] iniciando...\nHallazgo real importante\n[tool:bash] iniciando...\nSugerencia útil";
	assert.equal(
		cleanAgentOutput(output),
		"Hallazgo real importante\nSugerencia útil",
	);
	assert.equal(
		summarizeOutput(output),
		"Hallazgo real importante Sugerencia útil",
	);
});

test("summarizeOutput hides Engram adapter noise from visible summaries", () => {
	const output =
		"Engram: mem_context no devolvió contexto.\nResumen usuario: falló por DATABASE_URL faltante.\nHay fallas reales de regresión.";
	assert.equal(
		stripEngramNoise(output),
		"Resumen usuario: falló por DATABASE_URL faltante.\nHay fallas reales de regresión.",
	);
	assert.equal(
		summarizeOutput(output),
		"Resumen usuario: falló por DATABASE_URL faltante. Hay fallas reales de regresión.",
	);
});

test("LabReportStore tracks triage and approved Engram records separately", () => {
	const store = new LabReportStore(tempDir());
	store.append({
		...record("a"),
		triageStatus: "pending",
		engramStatus: "pending",
	});
	store.append({
		...record("b"),
		triageStatus: "triaged",
		engramStatus: "approved",
	});
	store.append({
		...record("c"),
		status: "skipped",
		triageStatus: "skipped",
		engramStatus: "skipped",
	});

	store.update("a", { triageStatus: "triaged", triageSummary: "important" });

	assert.equal(store.get("a")?.triageSummary, "important");
	assert.deepEqual(
		store.pendingTriage().map((entry) => entry.id),
		[],
	);
	assert.deepEqual(
		store.pendingEngram().map((entry) => entry.id),
		["b"],
	);
});

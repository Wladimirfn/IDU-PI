/**
 * Regression test: pin that `readColaDeAccionesFeed` surfaces a
 * valid NEW-FORMAT `agentlabs/runs/run-<unix>-<hex>.json` file as an
 * `agentlab` event with `source` pointing at the new-format filename.
 *
 * Before commit 65fd1f3 (REQ-FRS-2), `cola-acciones-feed.ts` filtered
 * `agentlabs/runs/` files through a local regex that only matched the
 * legacy `agentlab-review-run-<YYYYMMDD>-<HHMMSS>.json` shape. A
 * dispatch-issued run with filename `run-<unix>-<hex>.json` was
 * silently dropped from the live feed — exactly the file shape that
 * `dispatchAgentLabReviewRun` writes today.
 *
 * After the run-selector unification, the filter is
 * `isAgentLabRunFilename` from `agentlab-run-selector.ts`, which
 * accepts both legacy and new-format filenames. This test pins that
 * the new-format filename reaches the feed.
 *
 * Test also covers a sibling contract: a file with the SAME filename
 * shape but UNREADABLE body (no `generatedAt`) is filtered out by
 * `normalizeAgentLabRuns` and does NOT appear in the feed. That
 * protects the contract: filename recognition is necessary but not
 * sufficient — body shape still gates inclusion.
 */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { readColaDeAccionesFeed } from "../src/cola-acciones-feed.js";

function freshStateRoot(): string {
	return mkdtempSync(join(tmpdir(), "cola-acciones-feed-new-format-"));
}

function writeRunFile(
	stateRoot: string,
	filename: string,
	body: Record<string, unknown>,
): string {
	const runDir = join(stateRoot, "agentlabs", "runs");
	mkdirSync(runDir, { recursive: true });
	const fullPath = join(runDir, filename);
	writeFileSync(fullPath, JSON.stringify(body), "utf8");
	return fullPath;
}

const createdRoots: string[] = [];
after(() => {
	for (const root of createdRoots) {
		rmSync(root, { recursive: true, force: true });
	}
});

function trackedStateRoot(): string {
	const root = freshStateRoot();
	createdRoots.push(root);
	return root;
}

test("readColaDeAccionesFeed surfaces new-format run-<unix>-<hex>.json as agentlab event", () => {
	const stateRoot = trackedStateRoot();
	const newFormatFilename = "run-1700000000-abc123de.json";
	const generatedAt = "2026-07-04T12:00:00.000Z";
	writeRunFile(stateRoot, newFormatFilename, {
		warning: "Revisión AgentLab. No aplica cambios.",
		projectId: "test-project",
		generatedAt,
		runs: [
			{
				specialty: "code_quality",
				status: "completed",
				rawSummary: "Reviewed run-selector unification; no regressions.",
			},
		],
	});

	const feed = readColaDeAccionesFeed(stateRoot);
	const agentlabEvents = feed.filter((event) => event.kind === "agentlab");

	assert.ok(
		agentlabEvents.length >= 1,
		"expected at least one agentlab event from the new-format run file",
	);
	const fromNewFormat = agentlabEvents.find(
		(event) => event.source === `agentlabs/runs/${newFormatFilename}`,
	);
	assert.ok(
		fromNewFormat,
		`expected an event with source=agentlabs/runs/${newFormatFilename}; got sources=${JSON.stringify(agentlabEvents.map((e) => e.source))}`,
	);
	assert.equal(fromNewFormat.kind, "agentlab");
	assert.equal(fromNewFormat.ts, generatedAt);
	assert.match(fromNewFormat.summary, /agentlab code_quality/);
});

test("readColaDeAccionesFeed does not surface malformed new-format run files", () => {
	const stateRoot = trackedStateRoot();
	const malformedFilename = "run-1700000001-fedcba98.json";
	// Valid filename shape (matches isAgentLabRunFilename) but missing
	// `generatedAt` — normalizeAgentLabRuns drops this file, so it MUST
	// NOT appear in the feed.
	writeRunFile(stateRoot, malformedFilename, {
		warning: "Revisión AgentLab. No aplica cambios.",
		projectId: "test-project",
		runs: [],
	});

	const feed = readColaDeAccionesFeed(stateRoot);
	const fromMalformed = feed.find(
		(event) =>
			event.kind === "agentlab" &&
			event.source === `agentlabs/runs/${malformedFilename}`,
	);
	assert.equal(
		fromMalformed,
		undefined,
		"malformed new-format run files must not leak into the feed",
	);
});

test("readColaDeAccionesFeed still surfaces legacy agentlab-review-run-* files", () => {
	const stateRoot = trackedStateRoot();
	const legacyFilename = "agentlab-review-run-20260704-120000.json";
	const generatedAt = "2026-07-04T12:00:00.000Z";
	writeRunFile(stateRoot, legacyFilename, {
		warning: "Revisión AgentLab. No aplica cambios.",
		projectId: "test-project",
		generatedAt,
		runs: [],
	});

	const feed = readColaDeAccionesFeed(stateRoot);
	const fromLegacy = feed.find(
		(event) => event.source === `agentlabs/runs/${legacyFilename}`,
	);
	assert.ok(
		fromLegacy,
		`expected legacy-format run to appear in feed; sources=${JSON.stringify(feed.map((e) => e.source))}`,
	);
	assert.equal(fromLegacy.kind, "agentlab");
});

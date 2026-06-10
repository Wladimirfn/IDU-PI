// cli-skill-rating.test.ts
// B1 thin slice: REQ-B1-4 — idu-skill-rating CLI command wrapper.
// Tests cover: valid call returns the recommendation, invalid score
// exits non-zero with a clear validation message, and unknown proposal
// id exits non-zero with a "proposal not found" message.

import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSkillRating, formatSkillRating } from "../src/cli-skill-rating.js";
import { applyMigrations } from "../src/lab-db/migrations/runner.js";
import { LabDbRepository } from "../src/lab-db-repository.js";

function readScore(dbPath: string, proposalId: string): number | null {
	// Best-effort: read the score via sqlite3 directly. Mirrors the
	// pattern used in lab-db-repository-bibliotecario.test.ts.
	const raw = execFileSync(
		"sqlite3",
		[
			"-json",
			dbPath,
			`SELECT score FROM bibliotecario_proposals WHERE id = '${proposalId.replace(/'/gu, "''")}';`,
		],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	).trim();
	if (!raw) return null;
	const rows = JSON.parse(raw) as Array<{ score: number | null }>;
	return rows[0]?.score ?? null;
}

describe("cli-skill-rating", () => {
	let tempDir: string;
	let dbPath: string;
	let repo: LabDbRepository;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "cli-skill-rating-"));
		dbPath = join(tempDir, "lab.db");
		applyMigrations(dbPath);
		repo = new LabDbRepository(dbPath);
		repo.appendProposal({
			id: "prop-1",
			kind: "skill-improvement",
			payload: '{"skillId":"skill-1"}',
			status: "proposed",
		});
	});

	it("valid score calls recordSkillRating and prints the recommendation", () => {
		const result = runSkillRating(["prop-1", "7"], { stateRoot: tempDir });

		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(result.proposalId, "prop-1");
		assert.equal(result.score, 7);
		assert.equal(result.recommendation, "promote");

		// The formatted output must include proposalId, score, recommendation.
		const formatted = formatSkillRating(result);
		assert.match(formatted, /proposalId:.*prop-1/iu);
		assert.match(formatted, /score:.*7/iu);
		assert.match(formatted, /recommendation:.*promote/iu);

		// The DB row was updated.
		assert.equal(readScore(dbPath, "prop-1"), 7);

		// The lab_write event landed in events.jsonl.
		const eventsPath = join(tempDir, "events.jsonl");
		assert.ok(existsSync(eventsPath), "events.jsonl must exist");
		const events = readFileSync(eventsPath, "utf-8")
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		const updateEvent = events.find(
			(e) =>
				e.kind === "lab_write" &&
				(e.payload as Record<string, unknown>).table ===
					"bibliotecario_proposals" &&
				(e.payload as Record<string, unknown>).operation === "update",
		);
		assert.ok(updateEvent, "lab_write update event must be present");
	});

	it("score 11 exits non-zero and prints 'score must be in 0..10, got 11'", () => {
		const result = runSkillRating(["prop-1", "11"], { stateRoot: tempDir });

		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.notEqual(result.exitCode, 0, "exit code must be non-zero");
		assert.match(result.error, /score must be in 0\.\.10, got 11/iu);

		const formatted = formatSkillRating(result);
		assert.match(formatted, /score must be in 0\.\.10, got 11/iu);
	});

	it("unknown proposal id exits non-zero and prints 'proposal not found: <id>'", () => {
		const result = runSkillRating(["prop-missing", "5"], {
			stateRoot: tempDir,
		});

		assert.equal(result.ok, false);
		if (result.ok) return;
		assert.notEqual(result.exitCode, 0, "exit code must be non-zero");
		assert.match(result.error, /proposal not found: prop-missing/iu);

		const formatted = formatSkillRating(result);
		assert.match(formatted, /proposal not found: prop-missing/iu);
	});
});

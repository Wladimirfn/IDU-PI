// skill-rating-record.test.ts
// B1 thin slice: REQ-B1-3 + REQ-B1-5 — recordSkillRating end-to-end.
// Tests cover: score column update, lab_write event, skill_archive_reason
// event on archive recommendation, no archive event on defer/promote,
// and validation of out-of-range scores.

import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordSkillRating } from "../src/skill-rating.js";
import { LabDbRepository } from "../src/lab-db-repository.js";
import { applyMigrations } from "../src/lab-db/migrations/runner.js";
import { runSql } from "../src/lab-db.js";

function readEvents(stateRoot: string): Array<Record<string, unknown>> {
	const path = join(stateRoot, "events.jsonl");
	if (!existsSync(path)) return [];
	const content = readFileSync(path, "utf-8");
	const lines = content.split("\n").filter((line) => line.trim().length > 0);
	return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

function readScore(dbPath: string, proposalId: string): number | null {
	const raw = runSql(
		dbPath,
		`SELECT score FROM bibliotecario_proposals WHERE id = '${proposalId.replace(/'/gu, "''")}';`,
	);
	const rows = JSON.parse(raw) as Array<{ score: number | null }>;
	return rows[0]?.score ?? null;
}

describe("skill-rating-record", () => {
	let tempDir: string;
	let dbPath: string;
	let repo: LabDbRepository;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "skill-rating-record-"));
		dbPath = join(tempDir, "lab.db");
		// Run all migrations so the bibliotecario_proposals table is present
		// and the score column exists.
		applyMigrations(dbPath);
		repo = new LabDbRepository(dbPath);
		// Seed one proposal row we can rate.
		repo.appendProposal({
			id: "prop-1",
			kind: "skill-improvement",
			payload: '{"skillId":"skill-1"}',
			status: "proposed",
		});
	});

	it("updates the bibliotecario_proposals.score column on a real lab.db", () => {
		// Sanity: pre-state
		assert.equal(readScore(dbPath, "prop-1"), null);

		const result = recordSkillRating({
			proposalId: "prop-1",
			score: 7,
			stateRoot: tempDir,
		});

		assert.equal(result.proposalId, "prop-1");
		assert.equal(result.score, 7);
		assert.equal(result.recommendation, "promote");
		// Post-state: the score column was updated.
		assert.equal(readScore(dbPath, "prop-1"), 7);
	});

	it("emits a lab_write event with payload.table=bibliotecario_proposals and payload.operation=update", () => {
		recordSkillRating({
			proposalId: "prop-1",
			score: 7,
			stateRoot: tempDir,
		});

		const events = readEvents(tempDir);
		const labWriteEvents = events.filter((e) => e.kind === "lab_write");
		// At least one lab_write event was emitted. The appendProposal call
		// from beforeEach emits an "insert" lab_write; recordSkillRating
		// emits an "update" lab_write.
		assert.ok(
			labWriteEvents.length >= 2,
			"at least two lab_write events should exist",
		);

		const updateEvent = labWriteEvents.find(
			(e) =>
				e.payload &&
				(e.payload as Record<string, unknown>).table ===
					"bibliotecario_proposals" &&
				(e.payload as Record<string, unknown>).operation === "update",
		);
		assert.ok(
			updateEvent,
			"a lab_write event with table=bibliotecario_proposals and operation=update must be emitted",
		);
		assert.equal(
			(updateEvent.payload as Record<string, unknown>).rowId,
			"prop-1",
			"the lab_write event must carry rowId=prop-1",
		);
	});

	it("emits a second skill_archive_reason event when score is 3 (archive)", () => {
		recordSkillRating({
			proposalId: "prop-1",
			score: 3,
			stateRoot: tempDir,
		});

		const events = readEvents(tempDir);
		const archiveEvents = events.filter(
			(e) => e.kind === "skill_archive_reason",
		);
		assert.equal(
			archiveEvents.length,
			1,
			"exactly one skill_archive_reason event",
		);

		const archive = archiveEvents[0];
		assert.equal(archive.kind, "skill_archive_reason");
		const payload = archive.payload as Record<string, unknown>;
		assert.equal(payload.proposalId, "prop-1");
		assert.equal(payload.score, 3);
	});

	it("emits only the lab_write event (no skill_archive_reason) when score is 5 (defer)", () => {
		recordSkillRating({
			proposalId: "prop-1",
			score: 5,
			stateRoot: tempDir,
		});

		const events = readEvents(tempDir);
		const archiveEvents = events.filter(
			(e) => e.kind === "skill_archive_reason",
		);
		assert.equal(
			archiveEvents.length,
			0,
			"no skill_archive_reason event must be emitted for defer",
		);

		// The lab_write event is still emitted.
		const updateEvents = events.filter(
			(e) =>
				e.kind === "lab_write" &&
				(e.payload as Record<string, unknown>).operation === "update" &&
				(e.payload as Record<string, unknown>).table ===
					"bibliotecario_proposals",
		);
		assert.ok(
			updateEvents.length >= 1,
			"the lab_write update event must still be emitted for defer",
		);
	});

	it("throws when the score is 11 (out of range)", () => {
		assert.throws(
			() =>
				recordSkillRating({
					proposalId: "prop-1",
					// 11 is invalid; force the call site to assert the validator.
					score: 11 as never,
					stateRoot: tempDir,
				}),
			/score must be in 0\.\.10/iu,
		);
	});
});

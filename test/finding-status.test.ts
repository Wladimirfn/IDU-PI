// test/finding-status.test.ts
//
// Tests for updateFindingStatus (the writer that didn't exist) and
// formatFindingCloseMessage (the return-loop Telegram message).

import { test, describe } from "node:test";
import { strictEqual, ok, throws } from "node:assert";
import { makeTempDir } from "./helpers/temp.js";
import { join } from "node:path";
import {
	initLabDb,
	recordBugFinding,
	updateFindingStatus,
	runSql,
	type FindingStatus,
} from "../src/lab-db.js";
import { formatFindingCloseMessage } from "../src/escalation-delivery.js";

function makeTestDb(): string {
	const dir = makeTempDir("finding-status-");
	const dbPath = join(dir, "lab.db");
	initLabDb(dbPath);
	return dbPath;
}

function seedFinding(dbPath: string, id: string): void {
	recordBugFinding(dbPath, {
		id,
		projectId: "test-project",
		title: "Test finding for status update",
		description: "A test description about something that needs fixing.",
		severity: "critical",
		confidence: "high",
	});
}

describe("updateFindingStatus", () => {
	test("with reason: updates status and writes event", () => {
		const dbPath = makeTestDb();
		seedFinding(dbPath, "test-finding-1");

		const result = updateFindingStatus(
			dbPath,
			"test-finding-1",
			"fixed",
			"operator",
			"Fixed in commit abc123 — removed the duplicate switch statement.",
		);

		strictEqual(result.oldStatus, "new");
		strictEqual(result.newStatus, "fixed");
		strictEqual(result.note, "Fixed in commit abc123 — removed the duplicate switch statement.");
		strictEqual(result.title, "Test finding for status update");

		// Verify event was written
		const events = JSON.parse(
			runSql(dbPath, `SELECT * FROM finding_status_events WHERE finding_id = 'test-finding-1'`),
		);
		ok(events.length >= 2, "Should have birth + transition events");
		const transition = events.find((e: { new_status: string }) => e.new_status === "fixed");
		ok(transition, "Should have a 'fixed' transition event");
		strictEqual(transition.note, "Fixed in commit abc123 — removed the duplicate switch statement.");
	});

	test("without reason: throws (MANDATORY)", () => {
		const dbPath = makeTestDb();
		seedFinding(dbPath, "test-finding-2");

		throws(
			() => updateFindingStatus(dbPath, "test-finding-2", "fixed", "operator", ""),
			/Reason is required/,
		);
		throws(
			() => updateFindingStatus(dbPath, "test-finding-2", "fixed", "operator", "   "),
			/Reason is required/,
		);
	});

	test("non-existent finding: throws", () => {
		const dbPath = makeTestDb();
		throws(
			() => updateFindingStatus(dbPath, "does-not-exist", "fixed", "operator", "reason"),
			/Finding not found/,
		);
	});

	test("same status: idempotent (no new event written)", () => {
		const dbPath = makeTestDb();
		seedFinding(dbPath, "test-finding-3");

		// First update: new → ignored
		updateFindingStatus(dbPath, "test-finding-3", "ignored", "operator", "Not relevant.");
		const eventsAfterFirst = JSON.parse(
			runSql(dbPath, `SELECT COUNT(*) as count FROM finding_status_events WHERE finding_id = 'test-finding-3'`),
		) as Array<{ count: number }>;

		// Second call with SAME status: should be no-op
		updateFindingStatus(dbPath, "test-finding-3", "ignored", "operator", "Still not relevant.");
		const eventsAfterSecond = JSON.parse(
			runSql(dbPath, `SELECT COUNT(*) as count FROM finding_status_events WHERE finding_id = 'test-finding-3'`),
		) as Array<{ count: number }>;

		strictEqual(
			eventsAfterSecond[0].count,
			eventsAfterFirst[0].count,
			"No new event for same status (idempotent)",
		);
	});
});

describe("formatFindingCloseMessage", () => {
	test("produces correct format with all fields", () => {
		const msg = formatFindingCloseMessage({
			findingId: "bf-test-123",
			title: "Duplicate specialty-to-role mapping",
			filePath: "src/agentlab-review-runner.ts",
			note: "Resolved by consolidating both switch statements into one.",
			oldStatus: "new",
			newStatus: "fixed",
		});

		ok(msg !== null);
		ok(msg!.startsWith("✅"), "Should have green check for 'fixed'");
		ok(msg!.includes("src/agentlab-review-runner.ts"), "Should show file");
		ok(msg!.includes("Duplicate specialty-to-role mapping"), "Should show title");
		ok(msg!.includes("bf-test-123"), "Should show finding ID");
		ok(msg!.includes("Resolved by consolidating"), "Should show reason");
	});

	test("uses 🔶 for non-fixed status", () => {
		const msg = formatFindingCloseMessage({
			findingId: "bf-test-456",
			title: "Some issue",
			filePath: "src/a.ts",
			note: "Deferring to next sprint.",
			oldStatus: "new",
			newStatus: "deferred",
		});

		ok(msg!.startsWith("🔶"), "Should have orange diamond for non-fixed");
	});

	test("hard cut at 800 chars", () => {
		const msg = formatFindingCloseMessage({
			findingId: "bf-long",
			title: "T".repeat(200),
			filePath: "x".repeat(200),
			note: "R".repeat(500),
			oldStatus: "new",
			newStatus: "fixed",
		});

		ok(msg!.length <= 800, `Should be ≤800, got ${msg!.length}`);
	});

	test("null for empty title", () => {
		const msg = formatFindingCloseMessage({
			findingId: "bf-empty",
			title: "",
			filePath: "src/a.ts",
			note: "reason",
			oldStatus: "new",
			newStatus: "fixed",
		});

		strictEqual(msg, null);
	});
});

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
import { formatFindingCloseMessage, formatBugFindingDetail } from "../src/escalation-delivery.js";
import type { BugFinding } from "../src/lab-db.js";

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

// Issue #459: formatBugFindingDetail is the formatter behind the bot
// command `/idu_bug_finding_show <id>` and the CLI command
// `idu-bug-finding-show`. It must return the entire row verbatim;
// the only outer bound is `replyLong` chunking at Telegram's
// 4096-char limit. There is NO internal truncation.
describe("formatBugFindingDetail", () => {
	const baseFinding: BugFinding = {
		id: "bf-idu-pi-v2:abc123",
		projectId: "pi-telegram-bridge",
		title: "reverse check missing",
		description: "short description",
		severity: "medium",
		confidence: "high",
		status: "new",
		evidence: "comment truncated in alert",
		suspectedCause: "",
		affectedFiles: ["scripts/check-protocol-tool-drift.mjs"],
		dedupeKey: "protocol-drift:reverse-check",
		specialty: "tools",
		recurrenceCount: 1,
	};

	test("includes every column from the BugFinding row", () => {
		const out = formatBugFindingDetail(baseFinding);

		ok(out.includes("bf-idu-pi-v2:abc123"), "shows the id");
		ok(out.includes("pi-telegram-bridge"), "shows the project");
		ok(out.includes("medium"), "shows severity");
		ok(out.includes("high"), "shows confidence");
		ok(out.includes("new"), "shows status");
		ok(out.includes("reverse check missing"), "shows title");
		ok(out.includes("short description"), "shows description");
		ok(out.includes("comment truncated in alert"), "shows evidence");
		ok(
			out.includes("scripts/check-protocol-tool-drift.mjs"),
			"shows affected files",
		);
		ok(out.includes("protocol-drift:reverse-check"), "shows dedupe key");
	});

	test("preserves description byte-by-byte when longer than the per-finding alert cut", () => {
		// Per-finding cut at the 03:48 3-finding run is ~190 chars
		// (see test/lab-db.test.ts for the calculation). The formatter
		// must NOT slice at that boundary.
		const caveat =
			" — caveat: if the alias column is missing, returns 0 instead of failing. Not visible in the truncated alert body.";
		const filler = "Body text. ";
		const description = filler.repeat(34) + caveat;
		const finding: BugFinding = { ...baseFinding, description };

		const out = formatBugFindingDetail(finding);

		ok(
			out.includes(description),
			"full description must appear verbatim — no internal truncation at the per-finding alert cut",
		);
		// The caveat lives at the end of the description. It is the
		// operator's triage signal — verify it appears verbatim
		// inside the Description section, not at the absolute end
		// of the formatted output (which has more fields after it).
		const descStart = out.indexOf("Description:");
		const descEnd = out.indexOf("\n\nEvidence:");
		ok(descStart >= 0 && descEnd > descStart, "Description section framed");
		const descBlock = out.substring(descStart, descEnd);
		ok(
			descBlock.includes(description),
			"Description block must contain the full text verbatim",
		);
		ok(
			descBlock.endsWith(caveat),
			"the caveat at the end of the Description block must be preserved verbatim",
		);
	});

	test("marks missing optional fields with (empty) instead of dropping them", () => {
		const finding: BugFinding = {
			...baseFinding,
			suspectedCause: "",
			evidence: "",
			dedupeKey: "",
			specialty: "",
		};
		const out = formatBugFindingDetail(finding);

		ok(out.includes("Evidence: (empty)"), "evidence labelled when missing");
		ok(
			out.includes("Suspected cause: (empty)"),
			"suspectedCause labelled when missing",
		);
		ok(
			out.includes("Specialty: (empty)"),
			"specialty labelled when missing",
		);
		ok(
			out.includes("Recurrence key: (empty)"),
			"dedupeKey labelled when missing",
		);
	});
});

// The bot-side behavior of /idu_bug_finding_show is verified
// end-to-end through `parseBugFindingShowArgs` in
// test/bug-finding-show-args.test.ts. Wiring tests that grep
// `src/index.ts` for `bot.command("idu_bug_finding_show"` and
// match against `commandArg(...)` inside the handler block used
// to live here. They were removed in #468 because they proved
// spelling, not behavior: a discarded `commandArg(...)` call
// still matched the regex, and a rename or formatter line-break
// could fail the regex without failing the behavior. See the
// parser test file for the real coverage.

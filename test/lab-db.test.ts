import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	formatInitLabDbResult,
	getBugFinding,
	initLabDb,
	listOpenFindings,
	recordBugFinding,
} from "../src/lab-db.js";

const tempRoots: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-telegram-lab-db-"));
	tempRoots.push(dir);
	return dir;
}

after(async () => {
	await Promise.all(
		tempRoots.map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

test("initLabDb creates sqlite database with bug tracking schema", () => {
	const dbPath = join(tempDir(), "reports", "lab.db");

	const result = initLabDb(dbPath);

	assert.equal(existsSync(dbPath), true);
	assert.equal(result.created, true);
	assert.match(formatInitLabDbResult(result), /lab.db/);
});

test("recordBugFinding stores open findings for lab context", () => {
	const dbPath = join(tempDir(), "reports", "lab.db");
	initLabDb(dbPath);

	recordBugFinding(dbPath, {
		id: "bug-1",
		projectId: "pi-telegram-bridge",
		title: "Cancel does not interrupt busy prompt",
		description: "Telegram commands were blocked while Pi was busy.",
		severity: "high",
		confidence: "high",
		status: "accepted",
		evidence: "/cancel did not respond",
		affectedFiles: ["src/index.ts"],
		dedupeKey: "cancel-busy-prompt",
	});

	const findings = listOpenFindings(dbPath, "pi-telegram-bridge");

	assert.equal(findings.length, 1);
	assert.equal(findings[0].id, "bug-1");
	assert.equal(findings[0].title, "Cancel does not interrupt busy prompt");
	assert.deepEqual(findings[0].affectedFiles, ["src/index.ts"]);
});

// Issue #459: the alert truncated the caveat. The data is whole
// in `bug_findings`; the row's `id` is in the alert. This is the
// third option the owner picked: a command that retrieves the
// complete row on demand.
test("getBugFinding returns the full row by id", () => {
	const dbPath = join(tempDir(), "reports", "lab.db");
	initLabDb(dbPath);

	recordBugFinding(dbPath, {
		id: "bf-idu-pi-v2:abc123",
		projectId: "pi-telegram-bridge",
		title: "reverse check missing in check-protocol-tool-drift",
		description:
			"Comment promises 'if any of these ever becomes a real registered tool... this script fails', but the truncated body does not show that branch.",
		severity: "medium",
		confidence: "high",
		status: "new",
		evidence:
			"Comment: 'the declaration is load-bearing in BOTH directions... the reverse check below' (truncated, not visible)",
		affectedFiles: ["scripts/check-protocol-tool-drift.mjs"],
		dedupeKey: "protocol-drift:reverse-check-missing",
	});

	const row = getBugFinding(dbPath, "bf-idu-pi-v2:abc123");

	assert.ok(row, "must return the row when the id exists");
	assert.equal(row!.id, "bf-idu-pi-v2:abc123");
	assert.equal(row!.title, "reverse check missing in check-protocol-tool-drift");
	// The caveat the alert cut — preserved verbatim in the row.
	assert.ok(
		row!.description.includes(
			"the truncated body does not show that branch",
		),
		"description must be preserved verbatim — the alert truncated it",
	);
	assert.ok(
		row!.evidence.includes("truncated, not visible"),
		"evidence must be preserved verbatim — the alert truncated it",
	);
	assert.deepEqual(row!.affectedFiles, ["scripts/check-protocol-tool-drift.mjs"]);
});

test("getBugFinding returns null when the id is missing", () => {
	const dbPath = join(tempDir(), "reports", "lab.db");
	initLabDb(dbPath);

	const row = getBugFinding(dbPath, "bf-not-here");
	assert.equal(row, null);
});

// Issue #459 audit bar (owner, PR #467 thread): the alert truncates
// the description at DESC_BUDGET = 800 in escalation-delivery.ts:427.
// The full text must survive the round trip through `bug_findings`.
// This test seeds a description longer than the cut and verifies
// byte-by-byte that the row preserves it, including the caveat
// text that the alert cut.
test("getBugFinding returns the full description byte-by-byte when longer than the alert cut", () => {
	const dbPath = join(tempDir(), "reports", "lab.db");
	initLabDb(dbPath);

	const DESC_BUDGET = 800;
	// Build a description that is > DESC_BUDGET and ends with the
	// caveat text the alert cut ("if X is missing", "truncated",
	// "not visible") — exactly the pattern from the #459 alert.
	const caveat =
		" — caveat: if the alias column is missing from the table, the script returns 0 instead of failing. Not visible in the truncated alert body; verify against the column list before triaging.";
	const filler =
		"Description body. The reverse check below depends on every declared tool being registered. ";
	const description = filler.repeat(40) + caveat;
	assert.ok(
		description.length > DESC_BUDGET,
		`description must exceed DESC_BUDGET (${DESC_BUDGET}); got ${description.length}`,
	);

	recordBugFinding(dbPath, {
		id: "bf-idu-pi-v2:longdesc",
		projectId: "pi-telegram-bridge",
		title: "description length exceeds alert cut",
		description,
		severity: "medium",
		confidence: "high",
		status: "new",
		evidence: caveat,
		affectedFiles: ["scripts/check-protocol-tool-drift.mjs"],
		dedupeKey: "protocol-drift:longdesc",
	});

	const row = getBugFinding(dbPath, "bf-idu-pi-v2:longdesc");

	assert.ok(row, "must return the row when the id exists");
	// Byte-by-byte: the description must come back identical, not
	// sliced at any budget boundary.
	assert.equal(
		row!.description,
		description,
		"description must be preserved verbatim — no internal truncation at the alert cut",
	);
	assert.equal(
		row!.description.length,
		description.length,
		"description length must match — alert-cut truncation must not have leaked into the read path",
	);
	assert.ok(
		row!.description.length > DESC_BUDGET,
		"the read path must return text longer than the alert cut — that is the whole point of #459",
	);
	// The caveat lives at the end of the description; it is what the
	// alert cut. The operator relies on this exact substring to
	// triage the finding correctly.
	assert.ok(
		row!.description.endsWith(caveat),
		"the caveat text at the end of the description must be preserved verbatim",
	);
	assert.ok(
		row!.evidence.endsWith(caveat),
		"the caveat text at the end of the evidence must be preserved verbatim",
	);
});

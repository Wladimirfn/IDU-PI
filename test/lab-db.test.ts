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

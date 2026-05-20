import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
	formatInitLabDbResult,
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

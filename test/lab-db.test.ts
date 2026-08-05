import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	formatInitLabDbResult,
	getBugFinding,
	initLabDb,
	listOpenFindings,
	recordBugFinding,
} from "../src/lab-db.js";
import { makeTempDir } from "./helpers/temp.js";

// Issue #459: use the tracked-temp-dir helper (test/helpers/temp.ts)
// so failures cannot leak temp dirs past the suite boundary. The
// helper's afterEach cleans per-test; the exit sweep is a fallback
// for SIGKILL. This replaces the previous raw mkdtempSync pattern
// in this file (the test runner's leak guard flagged the raw
// pattern as recently-touched).
function tempDir(): string {
	return makeTempDir("pi-telegram-lab-db-");
}

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
// the description at the per-finding budget, NOT at DESC_BUDGET = 800.
// See escalation-delivery.ts around line 419-449:
//   detailFindings = [...criticals, ...highs]
//   fixedOverhead = header + title lines + foot + id lines + footer lines
//   descBudget    = max(0, DESC_BUDGET - fixedOverhead)
//   perDesc       = floor(descBudget / detailFindings.length)
// The alert then slices each description at `perDesc - prefixLen - 1`
// and appends `…`.
//
// In the 03:48 CI run the alert carried 3 findings. fixedOverhead
// was approximately:
//   header    ≈ 45  ("⚠️ [idu-pi] 3 hallazgos · supervisor 03:48\n")
//   titles    ≈ 60  (3 × "   → path — title\n")
//   idLines   ≈ 90  (3 × "  bf-idu-pi-v2:abcdef\n")
//   footLines ≈150  (3 × "  → fila completa: /idu_bug_finding_show <id>\n")
//   foot      ≈ 25  ("  ─ N warnings · N info ─\n")
//                              total ≈ 370
// So perDesc = floor((800 - 370) / 3) = floor(143) = 143 chars,
// minus 2 (descPrefix) minus 1 (the ellipsis) = 140 chars per
// finding. The footer line added by the #459 close-the-loop fix
// tightens the cut further (from ~190 to ~140 chars at 3 findings).
// The operator sees the caveat cut whenever the description is
// longer than that.
//
// This test seeds a description of ~340 chars (well over the
// per-finding cut for 3 findings, well under 800 so the test
// failure message stays readable) and verifies byte-by-byte that
// the row preserves it, including the caveat text at the end.
test("getBugFinding returns the full description byte-by-byte when longer than the per-finding alert cut", () => {
	const dbPath = join(tempDir(), "reports", "lab.db");
	initLabDb(dbPath);

	// Per-finding cut at the 03:48 3-finding run with the issue
	// #459 footer line included (see comment above).
	const PER_FINDING_CUT_AT_3 = 140;
	const caveat =
		" — caveat: if the alias column is missing from the table, the script returns 0 instead of failing. Not visible in the truncated alert body; verify against the column list before triaging.";
	const filler = "Body text. ";
	const description = filler.repeat(34) + caveat;
	assert.ok(
		description.length > PER_FINDING_CUT_AT_3,
		`description must exceed the per-finding cut at 3 findings (${PER_FINDING_CUT_AT_3}); got ${description.length}`,
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
	// sliced at the per-finding budget boundary.
	assert.equal(
		row!.description,
		description,
		"description must be preserved verbatim — no internal truncation at the per-finding alert cut",
	);
	assert.equal(
		row!.description.length,
		description.length,
		"description length must match — alert-cut truncation must not have leaked into the read path",
	);
	assert.ok(
		row!.description.length > PER_FINDING_CUT_AT_3,
		"the read path must return text longer than the per-finding cut — that is the whole point of #459",
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

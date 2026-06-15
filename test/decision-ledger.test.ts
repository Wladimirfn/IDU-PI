import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	appendDecisionToFile,
	decisionLedgerPath,
	listDecisions,
	readDecisionsFromFile,
	recordDecision,
	type DecisionRecord,
} from "../src/decision-ledger.js";

function makeStateRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-decision-ledger-"));
}

const NOW = "2026-06-15T00:00:00.000Z";

test("recordDecision writes a row to the ledger and returns the new id", () => {
	const stateRoot = makeStateRoot();
	try {
		const dbPath = join(stateRoot, "lab.db");
		const record: DecisionRecord = {
			projectId: "demo",
			decidedAt: NOW,
			decidedBy: "orchestrator",
			decision: "review",
			targetKind: "injection",
			targetId: "inj-1",
			rationale: "Reviewed and accepted",
			profileRef: "config/profiles/orchestrator.md",
		};
		const row = recordDecision(dbPath, record);
		assert.ok(row.id > 0);
		assert.equal(row.decision, "review");
		assert.equal(row.targetId, "inj-1");
		assert.equal(row.profileRef, "config/profiles/orchestrator.md");
		// File should now exist
		assert.ok(existsSync(dbPath));
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("listDecisions filters by projectId and since", () => {
	const stateRoot = makeStateRoot();
	try {
		const dbPath = join(stateRoot, "lab.db");
		recordDecision(dbPath, {
			projectId: "demo",
			decidedAt: "2026-04-01T00:00:00Z",
			decidedBy: "o",
			decision: "review",
			targetKind: "injection",
			targetId: "inj-1",
		});
		recordDecision(dbPath, {
			projectId: "demo",
			decidedAt: "2026-06-10T00:00:00Z",
			decidedBy: "o",
			decision: "delegate",
			targetKind: "injection",
			targetId: "inj-2",
		});
		recordDecision(dbPath, {
			projectId: "other",
			decidedAt: "2026-06-14T00:00:00Z",
			decidedBy: "o",
			decision: "ignore",
			targetKind: "injection",
			targetId: "inj-3",
		});
		const allDemo = listDecisions(dbPath, { projectId: "demo" });
		assert.equal(allDemo.length, 2);
		// since filter
		const recent = listDecisions(dbPath, {
			projectId: "demo",
			since: "2026-06-01T00:00:00Z",
		});
		assert.equal(recent.length, 1);
		assert.equal(recent[0]?.targetId, "inj-2");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("appendDecisionToFile and readDecisionsFromFile roundtrip", () => {
	const stateRoot = makeStateRoot();
	try {
		const path = decisionLedgerPath(stateRoot);
		appendDecisionToFile(path, {
			projectId: "demo",
			decidedAt: NOW,
			decidedBy: "o",
			decision: "review",
			targetKind: "injection",
			targetId: "inj-1",
		});
		const all = readDecisionsFromFile(path);
		assert.equal(all.length, 1);
		assert.equal(all[0]?.targetId, "inj-1");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("profile_ref captures the role contract that motivated the decision", () => {
	const stateRoot = makeStateRoot();
	try {
		const dbPath = join(stateRoot, "lab.db");
		const row = recordDecision(dbPath, {
			projectId: "demo",
			decidedAt: NOW,
			decidedBy: "o",
			decision: "ignore",
			targetKind: "digest_signal",
			targetId: "ds-1",
			profileRef: "config/profiles/supervisor-main.md",
		});
		assert.equal(row.profileRef, "config/profiles/supervisor-main.md");
		const all = listDecisions(dbPath, { projectId: "demo" });
		assert.equal(all[0]?.profileRef, "config/profiles/supervisor-main.md");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

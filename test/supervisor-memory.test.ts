// test/supervisor-memory.test.ts
//
// Tests for the supervisor memory block and its injection into the
// supervisor prompt. The memory builder is tested with mock data (no
// real Engram calls); the prompt injection is tested directly via the
// exported buildConsultPrompt.

import { test, describe } from "node:test";
import { strictEqual, ok } from "node:assert";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildSupervisorMemory } from "../src/supervisor-memory.js";
import { buildConsultPrompt } from "../src/supervisor-consult.js";
import { makeTempDir } from "./helpers/temp.js";

/**
 * Create a stateRoot shaped like production: the last path segment is
 * `projectId`, matching production's
 * `<workspace>/projects/<projectId>` convention. Tests that filter
 * by project_id use this to plant a real match. The uniqueness
 * suffix lives in the tracked parent dir, not the projectId segment.
 */
function tempStateRoot(projectId: string): string {
	const parent = makeTempDir("supervisor-memory-");
	const dir = join(parent, projectId);
	mkdirSync(dir, { recursive: true });
	return dir;
}
// No-op Engram mock: tests don't hit the real Engram CLI.
function engramFnNull(): null {
	return null;
}

/**
 * Create a temp dir with a `lab.db` containing the bug_findings and
 * finding_status_events tables, then seed it with the given rows.
 *
 * `stateRootProjectId` is the project_id that buildSupervisorMemory
 * will derive from the stateRoot path. This is the project_id used
 * in the SQL filter. Pass it explicitly so the temp dir's random
 * suffix doesn't break the filter — the last path segment is what
 * production derives from `<workspace>/projects/<projectId>`.
 *
 * Schema matches src/lab-db.ts:107-137.
 */
function seedLabDb(opts: {
	stateRootProjectId: string;
	findings: Array<{
		id: string;
		project_id?: string;
		title?: string;
		description?: string;
		severity: "critical" | "high" | "medium" | "low" | "info";
		confidence?: "high" | "medium" | "low";
		status?:
			| "new"
			| "triaged"
			| "accepted"
			| "deferred"
			| "ignored"
			| "fixed"
			| "duplicate";
	}>;
	events: Array<{
		finding_id: string;
		old_status: string | null;
		new_status: string;
		actor: string;
		note: string | null;
	}>;
}): string {
	const projectId = opts.stateRootProjectId;
	const dir = tempStateRoot(projectId);
	const db = join(dir, "lab.db");
	const schema = `
		CREATE TABLE bug_findings (
			id TEXT PRIMARY KEY,
			project_id TEXT NOT NULL,
			title TEXT NOT NULL DEFAULT '',
			description TEXT NOT NULL DEFAULT '',
			severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
			confidence TEXT NOT NULL DEFAULT 'high' CHECK (confidence IN ('high','medium','low')),
			status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','triaged','accepted','deferred','ignored','fixed','duplicate')),
			evidence TEXT,
			suspected_cause TEXT,
			affected_files TEXT NOT NULL DEFAULT '[]',
			dedupe_key TEXT,
			specialty TEXT,
			recurrence_count INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
		CREATE TABLE finding_status_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			finding_id TEXT NOT NULL REFERENCES bug_findings(id) ON DELETE CASCADE,
			old_status TEXT,
			new_status TEXT NOT NULL,
			actor TEXT NOT NULL,
			note TEXT,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		);
	`;
	execFileSync("sqlite3", [db, schema], { stdio: "ignore" });

	for (const f of opts.findings) {
		const fpid = f.project_id ?? projectId;
		execFileSync(
			"sqlite3",
			[
				db,
				`INSERT INTO bug_findings (id, project_id, title, description, severity, confidence, status)
				 VALUES ('${f.id}', '${fpid}', '${(f.title ?? "test").replace(/'/gu, "''")}', '${(f.description ?? "test").replace(/'/gu, "''")}', '${f.severity}', '${f.confidence ?? "high"}', '${f.status ?? "new"}');`,
			],
			{ stdio: "ignore" },
		);
	}
	for (const e of opts.events) {
		const oldPart =
			e.old_status === null ? "NULL" : `'${e.old_status}'`;
		const notePart =
			e.note === null ? "NULL" : `'${e.note.replace(/'/gu, "''")}'`;
		execFileSync(
			"sqlite3",
			[
				db,
				`INSERT INTO finding_status_events (finding_id, old_status, new_status, actor, note)
				 VALUES ('${e.finding_id}', ${oldPart}, '${e.new_status}', '${e.actor}', ${notePart});`,
			],
			{ stdio: "ignore" },
		);
	}
	return dir;
}

// ---------------------------------------------------------------------------
// buildSupervisorMemory — structural tests
// ---------------------------------------------------------------------------

describe("buildSupervisorMemory — structural", () => {
	test("returns empty string for empty stateRoot", () => {
		strictEqual(buildSupervisorMemory({ stateRoot: "" }), "");
	});

	test("does not throw when stateRoot has no lab.db", () => {
		const dir = tempStateRoot("idu-pi");
		const result = buildSupervisorMemory({
			stateRoot: dir,
			engramFn: engramFnNull,
		});
		// No local tables, no Engram → empty.
		strictEqual(result, "");
	});

	test("REGRESSION: stub override is caught by integration tests below", () => {
		// If someone replaces buildSupervisorMemory with `return ""`,
		// the integration tests (Recent verdicts / Open findings)
		// will fail. Empty cases here just verify the function is
		// total and predictable on missing inputs.
		strictEqual(
			buildSupervisorMemory({ stateRoot: "", engramFn: engramFnNull }),
			"",
		);
	});
});
// ---------------------------------------------------------------------------
// buildSupervisorMemory — Recent verdicts (integration with real lab.db)
// ---------------------------------------------------------------------------

describe("buildSupervisorMemory — Recent verdicts section", () => {
	test("appears when finding_status_events has rows for the project", () => {
		const stateRoot = seedLabDb({
			stateRootProjectId: 'idu-pi',
			findings: [
				{
					id: "bf-test-001",
					severity: "high",
				},
			],
			events: [
				{
					finding_id: "bf-test-001",
					old_status: "new",
					new_status: "fixed",
					actor: "operator",
					note: "Closed by merge of #410",
				},
				{
					finding_id: "bf-test-001",
					old_status: "triaged",
					new_status: "accepted",
					actor: "auditor",
					note: "Real defect confirmed",
				},
			],
		});
		const result = buildSupervisorMemory({
			stateRoot,
			engramFn: engramFnNull,
		});
		ok(
			result.match("## Recent verdicts") !== null,
			`Section missing. Output:\n${result}`,
		);
		ok(
			result.includes("bf-test-001: new→fixed"),
			`First verdict not formatted. Output:\n${result}`,
		);
		ok(
			result.includes("Closed by merge of #410"),
			`Note not included. Output:\n${result}`,
		);
	});

	test("does NOT appear when finding_status_events is empty", () => {
		const stateRoot = seedLabDb({
			stateRootProjectId: 'idu-pi',
			findings: [
				{
					id: "bf-test-002",
					severity: "low",
				},
			],
			events: [],
		});
		const result = buildSupervisorMemory({
			stateRoot,
			engramFn: engramFnNull,
		});
		ok(
			result.match("## Recent verdicts") === null,
			`Section should not appear when no verdicts. Output:\n${result}`,
		);
	});

	test("does NOT appear when lab.db does not exist", () => {
		const stateRoot = tempStateRoot("idu-pi");
		const result = buildSupervisorMemory({
			stateRoot,
			engramFn: engramFnNull,
		});
		ok(
			result.match("## Recent verdicts") === null,
			`Section should not appear when no DB. Output:\n${result}`,
		);
	});

	test("REGRESSION: filtering by project_id — other projects' events are excluded", () => {
		const stateRoot = seedLabDb({
			stateRootProjectId: 'idu-pi',
			findings: [
				{ id: "bf-A", severity: "high" },
			],
			events: [
				{
					finding_id: "bf-A",
					old_status: "new",
					new_status: "fixed",
					actor: "operator",
					note: "Mine",
				},
			],
		});
		// Also insert a row for a different project in the same DB so
		// we can verify it's filtered out.
		const db = join(stateRoot, "lab.db");
		execFileSync(
			"sqlite3",
			[
				db,
				`INSERT INTO bug_findings (id, project_id, title, description, severity, confidence, status) VALUES ('bf-B', 'other-project', 't', 'd', 'low', 'high', 'new');`,
			],
			{ stdio: "ignore" },
		);
		execFileSync(
			"sqlite3",
			[
				db,
				`INSERT INTO finding_status_events (finding_id, old_status, new_status, actor, note) VALUES ('bf-B', 'new', 'fixed', 'operator', 'Other');`,
			],
			{ stdio: "ignore" },
		);
		const result = buildSupervisorMemory({
			stateRoot,
			engramFn: engramFnNull,
		});
		ok(result.includes("bf-A"), "Should include own project");
		ok(
			!result.includes("bf-B"),
			`Should NOT include other project's events. Output:\n${result}`,
		);
		ok(
			!result.includes("Other"),
			`Should NOT include other project's note. Output:\n${result}`,
		);
	});

	test("REGRESSION: revert of queryRecentVerdicts to return null breaks this test", () => {
		// The first test in this describe proves the section appears.
		// If queryRecentVerdicts returns null unconditionally, that
		// test fails. This annotation makes the dependency explicit.
		const stateRoot = seedLabDb({
			stateRootProjectId: 'idu-pi',
			findings: [
				{ id: "bf-revert-1", severity: "high" },
			],
			events: [
				{
					finding_id: "bf-revert-1",
					old_status: "new",
					new_status: "fixed",
					actor: "op",
					note: "should appear",
				},
			],
		});
		const result = buildSupervisorMemory({
			stateRoot,
			engramFn: engramFnNull,
		});
		ok(result.match("## Recent verdicts") !== null);
	});
});
// ---------------------------------------------------------------------------
// buildSupervisorMemory — Open findings summary (integration with real lab.db)
// ---------------------------------------------------------------------------

describe("buildSupervisorMemory — Open findings summary section", () => {
	test("appears with severity counts when bug_findings has open rows", () => {
		const stateRoot = seedLabDb({
			stateRootProjectId: 'idu-pi',
			findings: [
				{
					id: "bf-open-1",
					severity: "high",
					status: "new",
				},
				{
					id: "bf-open-2",
					severity: "high",
					status: "triaged",
				},
				{
					id: "bf-open-3",
					severity: "low",
					status: "accepted",
				},
				{
					id: "bf-fixed",
					severity: "high",
					status: "fixed",
				},
				{
					id: "bf-ignored",
					severity: "high",
					status: "ignored",
				},
			],
			events: [],
		});
		const result = buildSupervisorMemory({
			stateRoot,
			engramFn: engramFnNull,
		});
		ok(
			result.match("## Open findings") !== null,
			`Section missing. Output:\n${result}`,
		);
		ok(result.includes("2 high"), `Should count 2 high. Output:\n${result}`);
		ok(result.includes("1 low"), `Should count 1 low. Output:\n${result}`);
		ok(
			!result.includes("bf-fixed"),
			`Fixed findings should be excluded. Output:\n${result}`,
		);
		ok(
			!result.includes("bf-ignored"),
			`Ignored findings should be excluded. Output:\n${result}`,
		);
	});

	test("does NOT appear when no open findings exist (all closed)", () => {
		const stateRoot = seedLabDb({
			stateRootProjectId: 'idu-pi',
			findings: [
				{
					id: "bf-closed",
					severity: "high",
					status: "fixed",
				},
			],
			events: [],
		});
		const result = buildSupervisorMemory({
			stateRoot,
			engramFn: engramFnNull,
		});
		ok(
			result.match("## Open findings") === null,
			`Section should not appear when nothing open. Output:\n${result}`,
		);
	});

	test("does NOT appear when bug_findings table is empty", () => {
		const stateRoot = seedLabDb({
			stateRootProjectId: 'idu-pi',
			findings: [],
			events: [],
		});
		const result = buildSupervisorMemory({
			stateRoot,
			engramFn: engramFnNull,
		});
		ok(
			result.match("## Open findings") === null,
			`Section should not appear when no rows. Output:\n${result}`,
		);
	});

	test("REGRESSION: revert of queryOpenFindingsSummary to return null breaks this test", () => {
		// The first test in this describe proves the section appears
		// with correct counts. If queryOpenFindingsSummary returns null
		// unconditionally, that test fails. This annotation makes the
		// dependency explicit.
		const stateRoot = seedLabDb({
			stateRootProjectId: 'idu-pi',
			findings: [
				{ id: "bf-revert-open", severity: "medium" },
			],
			events: [],
		});
		const result = buildSupervisorMemory({
			stateRoot,
			engramFn: engramFnNull,
		});
		ok(result.match("## Open findings") !== null);
	});
});
// ---------------------------------------------------------------------------
// buildSupervisorMemory — Engram section (mocked)
// ---------------------------------------------------------------------------

describe("buildSupervisorMemory — Engram section", () => {
	test("appears when engramFn returns narrative", () => {
		const stateRoot = tempStateRoot("idu-pi");
		const result = buildSupervisorMemory({
			stateRoot,
			engramFn: () =>
				"#1234 — D1 merged\n**What**: D1 counts bug_findings\n\n#1235 — D2 merged\n**What**: per-gate verdict traces",
		});
		ok(result.match("## Project narrative") !== null);
		ok(result.includes("D1 merged"));
	});

	test("does NOT appear when engramFn returns null", () => {
		const stateRoot = tempStateRoot("idu-pi");
		const result = buildSupervisorMemory({
			stateRoot,
			engramFn: engramFnNull,
		});
		ok(result.match("## Project narrative") === null);
	});
});
// ---------------------------------------------------------------------------
// buildSupervisorMemory — section ordering
// ---------------------------------------------------------------------------

describe("buildSupervisorMemory — section ordering", () => {
	test("Engram comes first (inter-session bridge has floor)", () => {
		const stateRoot = seedLabDb({
			stateRootProjectId: 'idu-pi',
			findings: [
				{ id: "bf-A", severity: "high" },
			],
			events: [
				{
					finding_id: "bf-A",
					old_status: "new",
					new_status: "fixed",
					actor: "op",
					note: "x",
				},
			],
		});
		const result = buildSupervisorMemory({
			stateRoot,
			engramFn: () => "ENGRAM_NARRATIVE_CONTENT",
		});
		ok(
			result.match("## Project narrative") !== null,
			`Engram section missing. Output:\n${result}`,
		);
		ok(
			result.match("## Recent verdicts") !== null,
			`Verdicts section missing. Output:\n${result}`,
		);
		const engramIdx = result.indexOf("## Project narrative");
		const verdictsIdx = result.indexOf("## Recent verdicts");
		ok(
			engramIdx < verdictsIdx,
			`Engram should come first. Output:\n${result}`,
		);
		ok(result.includes("ENGRAM_NARRATIVE_CONTENT"));
	});
});
// ---------------------------------------------------------------------------
// buildSupervisorMemory — budget enforcement
// ---------------------------------------------------------------------------

describe("buildSupervisorMemory — budget enforcement", () => {
	test("REGRESSION: total never exceeds MEMORY_BUDGET_CHARS (2000)", () => {
		// Generate huge Engram output to stress the budget.
		const huge = Array(100).fill(
			"#9999 — Some title with em-dash\n**What**: " + "x".repeat(50),
		).join("\n");
		const stateRoot = seedLabDb({
			stateRootProjectId: 'idu-pi',
			findings: [
				{ id: "bf-B1", severity: "high" },
				{ id: "bf-B2", severity: "low" },
			],
			events: [
				{
					finding_id: "bf-B1",
					old_status: "new",
					new_status: "fixed",
					actor: "op",
					note: "note " + "y".repeat(200),
				},
			],
		});
		const result = buildSupervisorMemory({
			stateRoot,
			engramFn: () => huge,
		});
		ok(
			result.length <= 2000,
			`Budget exceeded: ${result.length}/2000. Output:\n${result}`,
		);
	});

	test("REGRESSION: Engram survives when it would otherwise overflow the budget", () => {
		// Engram has the floor (800 chars). It must NOT be the first
		// section truncated. If joinSections prioritized the first
		// section differently, this would fail.
		const stateRoot = tempStateRoot("idu-pi");
		const hugeEngram = "E".repeat(5000);
		const result = buildSupervisorMemory({
			stateRoot,
			engramFn: () => hugeEngram,
		});
		ok(result.includes("## Project narrative"));
		ok(result.length <= 2000);
	});
});
// ---------------------------------------------------------------------------
// buildConsultPrompt — injection tests
// ---------------------------------------------------------------------------

describe("buildConsultPrompt memory injection", () => {
	const baseInput = {
		stateRoot: "/tmp/test",
		role: "supervisor-main" as const,
		question: "Categorize these 3 findings.",
		promptForRole: (() => {
			throw new Error("not used in these tests");
		}) as never,
		now: new Date("2026-07-31T15:00:00.000Z"),
	};

	test("injects '## Previous context' section when memory is non-empty", () => {
		const memory =
			'Recent verdicts: bf-idu-pi-v2:6781: new→fixed (operator, "Consolidated switches")';
		const prompt = buildConsultPrompt(
			{ ...baseInput, memory },
			{ tokenBudget: 1000 } as never,
		);
		ok(
			prompt.match("## Previous context") !== null,
			"Should inject the section header",
		);
		ok(
			prompt.includes(memory),
			"Should include the memory content verbatim",
		);
	});

	test("does NOT inject '## Previous context' section when memory is empty", () => {
		const prompt = buildConsultPrompt(
			{ ...baseInput, memory: "" },
			{ tokenBudget: 1000 } as never,
		);
		ok(
			prompt.match("## Previous context") === null,
			"Should NOT inject empty memory section",
		);
	});

	test("does NOT inject '## Previous context' section when memory is undefined", () => {
		const prompt = buildConsultPrompt(
			baseInput,
			{ tokenBudget: 1000 } as never,
		);
		ok(
			prompt.match("## Previous context") === null,
			"Should NOT inject when memory is absent",
		);
	});

	test("REGRESSION: memory section appears between Profile and Question", () => {
		const memory = "Test memory content.";
		const prompt = buildConsultPrompt(
			{ ...baseInput, memory },
			{ tokenBudget: 1000 } as never,
		);
		const profileIdx = prompt.indexOf("## Profile");
		const contextIdx = prompt.indexOf("## Previous context");
		const questionIdx = prompt.indexOf("## Question");
		ok(profileIdx >= 0, "Should have Profile section");
		ok(contextIdx >= 0, "Should have Previous context section");
		ok(questionIdx >= 0, "Should have Question section");
		ok(
			profileIdx < contextIdx && contextIdx < questionIdx,
			"Memory must appear AFTER profile and BEFORE question",
		);
	});

	test("REGRESSION: revert of memory injection code would fail these tests", () => {
		const memory = "test";
		const prompt = buildConsultPrompt(
			{ ...baseInput, memory },
			{ tokenBudget: 1000 } as never,
		);
		ok(
			prompt.includes(memory),
			"Reverting memory injection would break this assertion",
		);
	});
});

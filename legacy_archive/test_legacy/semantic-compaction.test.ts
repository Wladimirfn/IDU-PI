import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { initLabDb } from "../src/lab-db.js";
import {
	buildSemanticCompactionPrompt,
	formatSemanticCompactionDraft,
	formatSemanticCompactionReview,
	reviewSemanticCompactionDraft,
	saveSemanticCompactionDraft,
	type SemanticCompactionDraft,
} from "../src/semantic-compaction.js";

function runSql(dbPath: string, sql: string): unknown[] {
	const output = execFileSync("sqlite3", ["-json", dbPath, sql], {
		encoding: "utf8",
	});
	return output.trim() ? (JSON.parse(output) as unknown[]) : [];
}

function sql(value: string): string {
	return `'${value.replace(/'/gu, "''")}'`;
}

function tempRoot(prefix = "semantic-compaction-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

function seedDb(dbPath: string, projectId = "pi-telegram-bridge"): void {
	initLabDb(dbPath);
	runSql(
		dbPath,
		`INSERT INTO semantic_audit_runs (id, project_id, trigger_reason, mode, status, scanned_counts, summary, critical_findings, rules_to_preserve, suggested_agent_tasks, completed_at)
		 VALUES ('audit-1', ${sql(projectId)}, 'threshold_minor', 'manual', 'completed', '{"userSignalCount":2}', 'Manual audit summary', '[]', '["preserve auth rule"]', '[{"title":"old task"}]', '2026-01-01T00:00:00.000Z');`,
	);
	runSql(
		dbPath,
		`INSERT INTO bug_findings (id, project_id, title, description, severity, confidence, status, evidence, suspected_cause, affected_files, dedupe_key)
		 VALUES ('finding-critical', ${sql(projectId)}, 'Critical auth bug', 'Token secret leaked: bearer abc123', 'critical', 'high', 'new', 'password=super-secret apiKey=123', 'auth regression', '["src/auth.ts"]', 'auth-critical');`,
	);
	runSql(
		dbPath,
		`INSERT INTO proposals (id, finding_id, proposal_type, summary, details, priority, status, created_by_agent_id)
		 VALUES ('proposal-1', 'finding-critical', 'fix', 'Fix auth token handling', 'Never log credentials', 1, 'proposed', 'reviewer');`,
	);
	runSql(
		dbPath,
		`INSERT INTO user_signal_events (id, project_id, source, raw_text, detected_emotion, urgency, confidence, matched_keywords)
		 VALUES ('signal-1', ${sql(projectId)}, 'cli-task', 'fallo loggin token secret bearer 999', 'molesto', 4, 'high', '["fallo","login"]');`,
	);
	runSql(
		dbPath,
		`INSERT INTO lab_runs (id, project_id, project_path, agent_id, agent_label, workspace, duration_label, duration_ms, status, summary, raw_output, error, started_at, finished_at)
		 VALUES ('lab-1', ${sql(projectId)}, 'C:/repo', 'reviewer', 'Reviewer', 'clone', 'short', 1000, 'completed', 'Found auth issue', '${"x".repeat(5000)}', NULL, '2026-01-01', '2026-01-01');`,
	);
	runSql(
		dbPath,
		`INSERT INTO semantic_memory_items (id, project_id, source_type, source_id, importance, title, summary, tags, status)
		 VALUES ('memory-1', ${sql(projectId)}, 'manual', 'x', 'high', 'Keep auth rule', 'Auth needs review', '["auth"]', 'active');`,
	);
}

function writeStructuredTasks(workspaceRoot: string): void {
	const reports = join(workspaceRoot, "reports");
	writeFileSync(
		join(reports, "tasks.jsonl"),
		`${JSON.stringify({
			id: "task-1",
			text: "Bug task. Symptom/context: fallo loggin",
			originalText: "fallo el loggin",
			category: "bug",
			priority: 3,
			emotion: "neutral",
			intentKind: "bug_report",
			intentConcepts: ["login", "auth", "task"],
			intentRiskHint: "high",
			guardStatus: "needs_confirmation",
			guardRisk: "high",
			status: "pending",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		})}\n`,
	);
}

test("buildSemanticCompactionPrompt includes critical/high findings and classification samples", () => {
	const prompt = buildSemanticCompactionPrompt({
		projectId: "pi-telegram-bridge",
		inputSummary: { auditRuns: 1, criticalFindings: 1 },
		auditRuns: [{ id: "audit-1", summary: "Manual audit summary" }],
		criticalBugs: [
			{
				id: "finding-critical",
				severity: "critical",
				title: "Critical auth bug",
				evidence: "password=super-secret",
			},
		],
		classificationSamples: [
			{
				originalText: "fallo el loggin",
				category: "bug",
				priority: 3,
				emotion: "neutral",
				intent: "bug_report/auth/high",
				guardStatus: "needs_confirmation",
				guardRisk: "high",
			},
		],
	});

	assert.match(prompt, /Critical auth bug/u);
	assert.match(prompt, /fallo el loggin/u);
	assert.match(prompt, /classifierQualityReview/u);
	assert.doesNotMatch(prompt, /super-secret/u);
});

test("buildSemanticCompactionPrompt includes Project Core and Constitution when provided", () => {
	const prompt = buildSemanticCompactionPrompt({
		projectId: "pi-telegram-bridge",
		inputSummary: {},
		projectCore: "Project Core confirmado: no autoeditar reglas",
		constitution: "Constitution: pedir aprobación humana",
	});

	assert.match(prompt, /Project Core confirmado/u);
	assert.match(prompt, /pedir aprobación humana/u);
});

test("saveSemanticCompactionDraft saves warning draft in reports without creating memory items", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		const dbPath = join(reportsPath, "lab.db");
		seedDb(dbPath);
		writeStructuredTasks(root);
		const before = runSql(
			dbPath,
			"SELECT COUNT(*) AS count FROM semantic_memory_items;",
		) as Array<{ count: number }>;

		const result = saveSemanticCompactionDraft({
			projectId: "pi-telegram-bridge",
			dbPath,
			reportsPath,
			workspaceRoot: root,
			now: () => new Date("2026-01-02T03:04:05.000Z"),
		});

		assert.equal(existsSync(result.path), true);
		assert.match(
			result.path,
			/semantic-compaction-draft-20260102-030405\.json$/u,
		);
		assert.equal(result.draft.warning, "Borrador IA. No es fuente de verdad.");
		assert.equal(
			result.draft.classifierQualityReview.guardrailCorrect,
			"needs_review",
		);
		assert.ok(result.draft.suggestedRuleUpdates.length > 0);
		assert.ok(result.draft.suggestedAgentTasks.length > 0);
		assert.doesNotMatch(
			readFileSync(result.path, "utf8"),
			/super-secret|bearer abc123|apiKey=123/u,
		);
		const after = runSql(
			dbPath,
			"SELECT COUNT(*) AS count FROM semantic_memory_items;",
		) as Array<{ count: number }>;
		assert.equal(after[0]?.count, before[0]?.count);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reviewSemanticCompactionDraft latest and formatters expose suggestions", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		const dbPath = join(reportsPath, "lab.db");
		seedDb(dbPath);
		const result = saveSemanticCompactionDraft({
			projectId: "pi-telegram-bridge",
			dbPath,
			reportsPath,
			workspaceRoot: root,
			now: () => new Date("2026-01-02T03:04:05.000Z"),
		});

		const review = reviewSemanticCompactionDraft("latest", reportsPath);
		assert.equal(review.validDraft, true);
		assert.equal(review.path, result.path);
		const text = formatSemanticCompactionReview(review);
		assert.match(text, /suggestedRuleUpdates/u);
		assert.match(text, /suggestedAgentTasks/u);
		assert.match(
			formatSemanticCompactionDraft(result),
			/semantic-compaction-draft/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reviewSemanticCompactionDraft rejects unsafe paths and invalid names", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		mkdirSync(reportsPath, { recursive: true });
		const outside = join(root, "outside.json");
		writeFileSync(outside, "{}");
		assert.equal(
			reviewSemanticCompactionDraft(outside, reportsPath).validDraft,
			false,
		);

		const badName = join(reportsPath, "bad-name.json");
		writeFileSync(badName, "{}");
		assert.equal(
			reviewSemanticCompactionDraft(badName, reportsPath).validDraft,
			false,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reviewSemanticCompactionDraft flags rawOutput invalid JSON shape safely", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		mkdirSync(reportsPath, { recursive: true });
		const path = join(
			reportsPath,
			"semantic-compaction-draft-20260102-030405.json",
		);
		const draft: Partial<SemanticCompactionDraft> = {
			generatedAt: "2026-01-02T03:04:05.000Z",
			projectId: "pi-telegram-bridge",
			warning: "Borrador IA. No es fuente de verdad.",
			rawOutput: "not json from supervisor",
		};
		writeFileSync(path, JSON.stringify(draft, null, 2));

		const review = reviewSemanticCompactionDraft(resolve(path), reportsPath);
		assert.equal(review.validDraft, false);
		assert.equal(review.hasRawOutput, true);
		assert.match(review.errors.join("\n"), /rawOutput/u);
		assert.equal(review.draft?.rawOutput, undefined);
		assert.doesNotThrow(() => formatSemanticCompactionReview(review));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

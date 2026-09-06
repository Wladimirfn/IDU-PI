import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
	buildSemanticAgentTaskPlan,
	createSemanticAgentTasks,
	formatSemanticAgentTaskCreationResult,
	formatSemanticAgentTaskPlan,
	type SemanticAgentTaskCandidate,
} from "../src/semantic-agent-tasks.js";
import { StructuredTaskQueue } from "../src/structured-task-queue.js";

const WARNING = "Borrador IA. No es fuente de verdad.";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "semantic-agent-tasks-"));
}

function writeDraft(root: string, patch: Record<string, unknown> = {}): string {
	const reportsPath = join(root, "reports");
	mkdirSync(reportsPath, { recursive: true });
	const path = join(
		reportsPath,
		"semantic-compaction-draft-20260102-030405.json",
	);
	writeFileSync(
		path,
		`${JSON.stringify(
			{
				generatedAt: "2026-01-02T03:04:05.000Z",
				projectId: "pi-telegram-bridge",
				warning: WARNING,
				sourceAuditRunIds: ["audit-1"],
				inputSummary: { criticalFindings: 2 },
				preservedRules: ["No ejecutar AgentLabs automáticamente"],
				criticalBugs: [
					{
						title: "Critical auth login failure",
						severity: "critical",
						evidence: "users cannot login",
					},
					{
						title: "Database schema drift",
						severity: "high",
						evidence: "migration mismatch",
					},
				],
				humanDecisions: [],
				reusableLessons: [],
				architecturalRisks: ["Arquitectura de DB sin dueño claro"],
				classifierQualityReview: {
					emotionCorrect: "needs_review",
					categoryCorrect: "needs_review",
					priorityCorrect: "needs_review",
					intentCorrect: "needs_review",
					guardrailCorrect: "needs_review",
					falsePositives: [],
					falseNegatives: ["delete deployment classified low"],
					errorPatterns: ["auth typo false negative"],
					recommendedRules: ["auth/login high"],
				},
				misclassifiedExamples: [],
				suggestedRuleUpdates: ["Si auth/login falla => security high"],
				suggestedSkillUpdates: ["Limpiar skill obsoleta de DB"],
				suggestedMemoryItems: [],
				suggestedAgentTasks: [
					"Revisar seguridad auth/login",
					"Revisar arquitectura de DB",
				],
				noiseToIgnore: [],
				openQuestions: [],
				...patch,
			},
			null,
			2,
		)}\n`,
	);
	return path;
}

function findCandidate(
	candidates: SemanticAgentTaskCandidate[],
	type: string,
): SemanticAgentTaskCandidate {
	const candidate = candidates.find((item) => item.type === type);
	assert.ok(candidate, `missing candidate ${type}`);
	return candidate;
}

test("buildSemanticAgentTaskPlan latest lee draft válido", () => {
	const root = tempRoot();
	try {
		const path = writeDraft(root);
		const plan = buildSemanticAgentTaskPlan("latest", join(root, "reports"));

		assert.equal(plan.validDraft, true);
		assert.equal(plan.draftPath, path);
		assert.equal(plan.projectId, "pi-telegram-bridge");
		assert.ok(plan.candidates.length >= 5);
		assert.equal(
			plan.candidates.filter(
				(candidate) => candidate.dedupeKey === "security:auth-login",
			).length,
			1,
		);
		assert.equal(
			plan.candidates.filter(
				(candidate) => candidate.dedupeKey === "database:database-schema",
			).length,
			1,
		);
		assert.match(
			formatSemanticAgentTaskPlan(plan),
			/Semantic Agent Tasks Review/u,
		);
		assert.match(
			formatSemanticAgentTaskPlan(plan),
			/semantic_agent_tasks_create latest/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("buildSemanticAgentTaskPlan rechaza rutas fuera de reports y nombres inválidos", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		mkdirSync(reportsPath, { recursive: true });
		const outside = join(
			root,
			"semantic-compaction-draft-20260102-030405.json",
		);
		writeFileSync(outside, "{}");
		assert.equal(
			buildSemanticAgentTaskPlan(outside, reportsPath).validDraft,
			false,
		);

		const badName = join(reportsPath, "bad.json");
		writeFileSync(badName, "{}");
		assert.equal(
			buildSemanticAgentTaskPlan(resolve(badName), reportsPath).validDraft,
			false,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("buildSemanticAgentTaskPlan rechaza draft sin warning", () => {
	const root = tempRoot();
	try {
		writeDraft(root, { warning: "otro" });
		const plan = buildSemanticAgentTaskPlan("latest", join(root, "reports"));

		assert.equal(plan.validDraft, false);
		assert.match(plan.errors.join("\n"), /warning/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("criticalBugs y sugerencias generan categorías y prioridades esperadas", () => {
	const root = tempRoot();
	try {
		writeDraft(root);
		const plan = buildSemanticAgentTaskPlan("latest", join(root, "reports"));

		const security = findCandidate(plan.candidates, "security");
		assert.equal(security.priority, 5);
		assert.equal(security.queuePriority, 1);
		assert.equal(findCandidate(plan.candidates, "database").priority, 5);
		assert.equal(findCandidate(plan.candidates, "architecture").priority, 4);
		assert.equal(
			findCandidate(plan.candidates, "classifier_review").priority,
			5,
		);
		assert.equal(findCandidate(plan.candidates, "skill_review").priority, 3);
		assert.ok(
			plan.candidates.every((candidate) => candidate.category === "review"),
		);
		assert.ok(
			plan.candidates.every((candidate) =>
				candidate.text.includes("No ejecutar cambios sin aprobación humana."),
			),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("buildSemanticAgentTaskPlan groups noisy findings by semantic domain", () => {
	const root = tempRoot();
	try {
		writeDraft(root, {
			criticalBugs: [
				{
					title: "First code bug",
					severity: "critical",
					evidence: "one failing test",
				},
				{
					title: "Second code bug",
					severity: "high",
					evidence: "another failing test",
				},
				{ title: "Third code bug", severity: "high", evidence: "worker error" },
			],
			suggestedAgentTasks: [
				"Revisar calidad de código",
				"Revisar otro bug de código",
			],
		});
		const plan = buildSemanticAgentTaskPlan("latest", join(root, "reports"));
		const codeQuality = plan.candidates.filter(
			(candidate) => candidate.type === "code_quality",
		);

		assert.equal(codeQuality.length, 1);
		assert.match(codeQuality[0]?.text ?? "", /Hallazgos agrupados: 5/u);
		assert.match(codeQuality[0]?.text ?? "", /Top 3 ejemplos:/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("buildSemanticAgentTaskPlan preserves same-domain evidence before grouping", () => {
	const root = tempRoot();
	try {
		writeDraft(root, {
			criticalBugs: [
				{
					title: "Database schema drift",
					severity: "high",
					evidence: "migration mismatch in users table",
				},
				{
					title: "Database backup failure",
					severity: "critical",
					evidence: "sqlite backup failed overnight",
				},
			],
			suggestedAgentTasks: [],
			suggestedRuleUpdates: [],
			suggestedSkillUpdates: [],
			architecturalRisks: [],
			classifierQualityReview: {
				emotionCorrect: "ok",
				categoryCorrect: "ok",
				priorityCorrect: "ok",
				intentCorrect: "ok",
				guardrailCorrect: "ok",
				falsePositives: [],
				falseNegatives: [],
				errorPatterns: [],
				recommendedRules: [],
			},
		});
		const plan = buildSemanticAgentTaskPlan("latest", join(root, "reports"));
		const database = findCandidate(plan.candidates, "database");

		assert.match(database.text, /Hallazgos agrupados: 2/u);
		assert.match(database.text, /migration mismatch in users table/u);
		assert.match(database.text, /sqlite backup failed overnight/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("createSemanticAgentTasks creates at most seven grouped tasks by default", () => {
	const root = tempRoot();
	try {
		writeDraft(root, {
			criticalBugs: [
				{ title: "Auth outage", severity: "critical", evidence: "login down" },
				{
					title: "Database corrupt",
					severity: "critical",
					evidence: "db broken",
				},
				{ title: "Code bug one", severity: "high", evidence: "test fail" },
				{ title: "UI broken", severity: "high", evidence: "button fail" },
				{ title: "Perf slow", severity: "high", evidence: "slow response" },
			],
			suggestedAgentTasks: [
				"Revisar seguridad auth/login",
				"Revisar arquitectura de DB",
				"Revisar classifier de intención humana",
				"Revisar Project Core vs código real",
				"Revisar performance",
				"Documentar runbook",
				"Revisar UX",
				"Revisar calidad de código",
			],
			suggestedSkillUpdates: ["Limpiar skill obsoleta"],
		});
		const queue = new StructuredTaskQueue({
			filePath: join(root, "tasks.jsonl"),
		});
		const result = createSemanticAgentTasks({
			pathOrLatest: "latest",
			reportsPath: join(root, "reports"),
			queue,
		});

		assert.ok(result.plan.candidates.length <= 7);
		assert.equal(result.created.length, result.plan.candidates.length);
		assert.ok(result.created.length <= 7);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("createSemanticAgentTasks crea StructuredTask review source semantic-audit y deduplica", () => {
	const root = tempRoot();
	try {
		writeDraft(root);
		const queue = new StructuredTaskQueue({
			filePath: join(root, "tasks.jsonl"),
		});
		const first = createSemanticAgentTasks({
			pathOrLatest: "latest",
			reportsPath: join(root, "reports"),
			queue,
		});

		assert.ok(first.created.length > 0);
		assert.equal(first.skippedDuplicates.length, 0);
		assert.ok(first.created.every((task) => task.category === "review"));
		assert.ok(first.created.every((task) => task.source === "semantic-audit"));
		assert.ok(
			first.created.every((task) => task.projectId === "pi-telegram-bridge"),
		);
		assert.ok(first.created.every((task) => task.emotion === "neutral"));
		assert.match(first.created[0]?.text ?? "", /No ejecutar cambios/u);
		assert.match(first.created[0]?.text ?? "", /Prioridad semántica: 5/u);
		assert.match(
			formatSemanticAgentTaskCreationResult(first),
			/Semantic Agent Tasks Created/u,
		);
		assert.match(formatSemanticAgentTaskCreationResult(first), /priority 5/u);

		const second = createSemanticAgentTasks({
			pathOrLatest: "latest",
			reportsPath: join(root, "reports"),
			queue,
		});
		assert.equal(second.created.length, 0);
		assert.ok(second.skippedDuplicates.length > 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
	buildSupervisorImprovementPlan,
	createSupervisorImprovementProposals,
	formatSupervisorImprovementCreationResult,
	formatSupervisorImprovementPlan,
	type SupervisorImprovementProposal,
} from "../src/supervisor-improvement-proposals.js";

const WARNING = "Borrador IA. No es fuente de verdad.";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "supervisor-improvements-"));
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
				preservedRules: [
					"No borrar datos durante compactación semántica.",
					"Auth/login requiere confirmación humana en riesgo alto.",
				],
				criticalBugs: [
					{
						title: "Text Sí/No answers were not prioritized for pending UI",
						severity: "critical",
						evidence: "pending UI consumed yes/no as prompt",
					},
				],
				humanDecisions: [],
				reusableLessons: ["Respuestas Sí/No deben tener prioridad sobre cola."],
				architecturalRisks: [
					"Project Core puede estar desalineado con código real",
				],
				classifierQualityReview: {
					emotionCorrect: "needs_review",
					categoryCorrect: "needs_review",
					priorityCorrect: "needs_review",
					intentCorrect: "needs_review",
					guardrailCorrect: "needs_review",
					falsePositives: ["docs simples marcadas high"],
					falseNegatives: ["db failure classified low"],
					errorPatterns: ["loggin typo missed"],
					recommendedRules: ["auth/login high"],
				},
				misclassifiedExamples: [
					{
						text: "nuevamnet falla db",
						expected: "bug/database/high",
						actual: "general/low",
					},
				],
				suggestedRuleUpdates: [
					"Si falla + db → bug/database/high",
					"Si falla + db → bug/database/high",
					"Si no puedo entrar/loggin/session → auth/login/high",
				],
				suggestedSkillUpdates: [
					"Mejorar skill de seguridad auth/login",
					"Mejorar skill auth login",
					"Mejorar skill DB/schema",
				],
				suggestedMemoryItems: [],
				suggestedAgentTasks: ["Revisar Project Core vs código real"],
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

function findProposal(
	proposals: SupervisorImprovementProposal[],
	type: SupervisorImprovementProposal["type"],
): SupervisorImprovementProposal {
	const proposal = proposals.find((candidate) => candidate.type === type);
	assert.ok(proposal, `missing proposal ${type}`);
	return proposal;
}

test("review latest lee draft válido", () => {
	const root = tempRoot();
	try {
		const path = writeDraft(root);
		const plan = buildSupervisorImprovementPlan(
			"latest",
			join(root, "reports"),
		);

		assert.equal(plan.validDraft, true);
		assert.equal(plan.sourceDraftPath, path);
		assert.equal(
			plan.draftName,
			"semantic-compaction-draft-20260102-030405.json",
		);
		assert.ok(plan.proposals.length > 0);
		assert.match(
			formatSupervisorImprovementPlan(plan),
			/Supervisor Improvement Proposals/u,
		);
		assert.match(formatSupervisorImprovementPlan(plan), /No apliqué reglas/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("review ruta fuera de reports falla", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		mkdirSync(reportsPath, { recursive: true });
		const outside = join(
			root,
			"semantic-compaction-draft-20260102-030405.json",
		);
		writeFileSync(outside, "{}");

		const plan = buildSupervisorImprovementPlan(outside, reportsPath);

		assert.equal(plan.validDraft, false);
		assert.match(plan.errors.join("\n"), /reports|fuera|archivo/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("review archivo inválido falla", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		mkdirSync(reportsPath, { recursive: true });
		const bad = join(
			reportsPath,
			"semantic-compaction-draft-20260102-030405.json",
		);
		writeFileSync(bad, "{ bad json");

		const plan = buildSupervisorImprovementPlan(resolve(bad), reportsPath);

		assert.equal(plan.validDraft, false);
		assert.match(plan.errors.join("\n"), /JSON|Unexpected|inválido/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("draft sin warning falla", () => {
	const root = tempRoot();
	try {
		writeDraft(root, { warning: "otro" });

		const plan = buildSupervisorImprovementPlan(
			"latest",
			join(root, "reports"),
		);

		assert.equal(plan.validDraft, false);
		assert.match(plan.errors.join("\n"), /warning/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("suggestedRuleUpdates genera intent_rule_update", () => {
	const root = tempRoot();
	try {
		writeDraft(root);
		const plan = buildSupervisorImprovementPlan(
			"latest",
			join(root, "reports"),
		);
		const proposal = findProposal(plan.proposals, "intent_rule_update");

		assert.equal(proposal.riskLevel, "high");
		assert.match(proposal.title, /base de datos|auth|Clasificar/u);
		assert.ok(proposal.evidence.length > 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("suggestedSkillUpdates genera skill_update", () => {
	const root = tempRoot();
	try {
		writeDraft(root);
		const plan = buildSupervisorImprovementPlan(
			"latest",
			join(root, "reports"),
		);
		const proposal = findProposal(plan.proposals, "skill_update");

		assert.equal(proposal.riskLevel, "medium");
		assert.match(proposal.title, /skill/u);
		assert.ok(proposal.evidence.some((item) => /auth|DB|schema/iu.test(item)));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("classifierQualityReview genera classifier_review", () => {
	const root = tempRoot();
	try {
		writeDraft(root);
		const plan = buildSupervisorImprovementPlan(
			"latest",
			join(root, "reports"),
		);
		const proposal = findProposal(plan.proposals, "classifier_review");

		assert.equal(proposal.riskLevel, "high");
		assert.match(
			proposal.description,
			/classifier|human-intent|clasificador/iu,
		);
		assert.ok(proposal.evidence.some((item) => /false|loggin|db/iu.test(item)));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("criticalBugs puede generar workflow_improvement", () => {
	const root = tempRoot();
	try {
		writeDraft(root);
		const plan = buildSupervisorImprovementPlan(
			"latest",
			join(root, "reports"),
		);
		const proposal = findProposal(plan.proposals, "workflow_improvement");

		assert.equal(proposal.riskLevel, "critical");
		assert.match(proposal.title, /Sí\/No|workflow|flujo/iu);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("propuestas requieren human approval", () => {
	const root = tempRoot();
	try {
		writeDraft(root);
		const plan = buildSupervisorImprovementPlan(
			"latest",
			join(root, "reports"),
		);

		assert.ok(plan.proposals.length > 0);
		assert.ok(
			plan.proposals.every((proposal) => proposal.requiresHumanApproval),
		);
		assert.ok(
			plan.proposals.every((proposal) => proposal.status === "proposed"),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("create guarda supervisor-improvement-proposals en reports", () => {
	const root = tempRoot();
	try {
		writeDraft(root);
		const reportsPath = join(root, "reports");
		const result = createSupervisorImprovementProposals("latest", reportsPath, {
			now: () => new Date("2026-01-02T03:04:05.000Z"),
		});

		assert.equal(result.created.length, result.plan.proposals.length);
		assert.match(
			result.path ?? "",
			/supervisor-improvement-proposals-20260102-030405\.json$/u,
		);
		assert.equal(existsSync(result.path ?? ""), true);
		assert.match(
			formatSupervisorImprovementCreationResult(result),
			/Supervisor Improvement Proposals Created/u,
		);
		assert.match(
			formatSupervisorImprovementCreationResult(result),
			/No apliqué cambios/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("create no modifica código skills constitution", () => {
	const root = tempRoot();
	try {
		writeDraft(root);
		const before = new Set(readdirSync(root));
		createSupervisorImprovementProposals("latest", join(root, "reports"), {
			now: () => new Date("2026-01-02T03:04:05.000Z"),
		});
		const after = new Set(readdirSync(root));

		assert.deepEqual(after, before);
		assert.equal(existsSync(join(root, "src", "human-intent.ts")), false);
		assert.equal(
			existsSync(join(root, "config", "project-constitution.json")),
			false,
		);
		assert.equal(existsSync(join(root, ".agents", "skills")), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("deduplica suggestedRuleUpdates repetidas", () => {
	const root = tempRoot();
	try {
		writeDraft(root, {
			suggestedRuleUpdates: [
				"Si falla + db → bug/database/high",
				"si falla db => bug database high",
				"Si falla + db → bug/database/high",
			],
			suggestedSkillUpdates: [],
			criticalBugs: [],
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
		const plan = buildSupervisorImprovementPlan(
			"latest",
			join(root, "reports"),
		);

		assert.equal(
			plan.proposals.filter(
				(proposal) => proposal.type === "intent_rule_update",
			).length,
			1,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("limita a máximo 10 propuestas", () => {
	const root = tempRoot();
	try {
		writeDraft(root, {
			suggestedRuleUpdates: Array.from(
				{ length: 20 },
				(_, index) => `rule ${index} auth db high`,
			),
			suggestedSkillUpdates: Array.from(
				{ length: 20 },
				(_, index) => `skill ${index} auth`,
			),
		});
		const plan = buildSupervisorImprovementPlan(
			"latest",
			join(root, "reports"),
		);

		assert.ok(plan.proposals.length <= 10);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

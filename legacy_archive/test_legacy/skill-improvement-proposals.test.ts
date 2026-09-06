import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
	buildSkillImprovementPlan,
	createSkillImprovementProposals,
	formatSkillImprovementCreationResult,
	formatSkillImprovementPlan,
	formatSkillImprovementStatus,
	getSkillImprovementStatus,
	type SkillImprovementProposal,
} from "../src/skill-improvement-proposals.js";

const WARNING = "Borrador IA. No es fuente de verdad.";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "skill-improvements-"));
}

function writeSkillIndex(root: string): void {
	mkdirSync(join(root, ".agents", "skills", "project-understanding"), {
		recursive: true,
	});
	mkdirSync(join(root, ".atl"), { recursive: true });
	writeFileSync(
		join(root, ".agents", "skills", "INDEX.md"),
		[
			"# Project Skill Index",
			"",
			"| Skill | Path |",
			"| --- | --- |",
			"| project-understanding | .agents/skills/project-understanding/SKILL.md |",
			"| noisy-old-skill | .agents/skills/noisy-old-skill/SKILL.md |",
		].join("\n"),
	);
	writeFileSync(
		join(root, ".atl", "skill-registry.md"),
		[
			"# Skill Registry",
			"",
			"| Trigger | Path |",
			"| --- | --- |",
			"| auth | .agents/skills/project-understanding/SKILL.md |",
		].join("\n"),
	);
	writeFileSync(
		join(root, ".agents", "skills", "project-understanding", "SKILL.md"),
		"---\nname: project-understanding\n---\nUse Project Core safely.\n",
	);
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
				preservedRules: ["Project Core y Constitution guían skills."],
				criticalBugs: [
					{
						title: "Repeated auth login failure",
						severity: "critical",
						evidence: "falló login seguridad SSE",
					},
					{
						title: "Repeated DB schema failure",
						severity: "high",
						evidence: "fallas en base de datos",
					},
				],
				humanDecisions: [],
				reusableLessons: [
					"Archivar skills que generen ruido sólo después de revisión humana.",
				],
				architecturalRisks: [
					"Project Core puede estar desalineado con skills.",
				],
				classifierQualityReview: {
					emotionCorrect: "needs_review",
					categoryCorrect: "needs_review",
					priorityCorrect: "needs_review",
					intentCorrect: "needs_review",
					guardrailCorrect: "needs_review",
					falsePositives: ["skill ruidosa activada para docs simples"],
					falseNegatives: ["login typo no activó skill auth"],
					errorPatterns: ["loggin typo missed"],
					recommendedRules: ["auth/login skill review"],
				},
				misclassifiedExamples: [],
				suggestedRuleUpdates: [],
				suggestedSkillUpdates: [
					"Mejorar skill project-understanding con Project Core/Constitution",
					"Mejorar skill de seguridad auth/login",
					"Mejorar skill DB/schema",
					"Archivar skill ruidosa que se activa con docs simples",
				],
				suggestedMemoryItems: [],
				suggestedAgentTasks: [
					"Validar utilidad de skill auth antes de cambiarla",
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

function findProposal(
	proposals: SkillImprovementProposal[],
	type: SkillImprovementProposal["type"],
): SkillImprovementProposal {
	const proposal = proposals.find((candidate) => candidate.type === type);
	assert.ok(proposal, `missing proposal ${type}`);
	return proposal;
}

test("review latest lee draft válido", async () => {
	const root = tempRoot();
	try {
		writeSkillIndex(root);
		const path = writeDraft(root);
		const plan = buildSkillImprovementPlan("latest", join(root, "reports"), {
			workspaceRoot: root,
		});

		assert.equal(plan.validDraft, true);
		assert.equal(plan.sourceDraftPath, path);
		assert.ok(plan.proposals.length > 0);
		assert.match(
			formatSkillImprovementPlan(plan),
			/Skill Improvement Proposals/u,
		);
		assert.match(formatSkillImprovementPlan(plan), /No modifiqué skills/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("review ruta fuera de reports falla", async () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		mkdirSync(reportsPath, { recursive: true });
		const outside = join(
			root,
			"semantic-compaction-draft-20260102-030405.json",
		);
		writeFileSync(outside, "{}");

		const plan = buildSkillImprovementPlan(outside, reportsPath, {
			workspaceRoot: root,
		});

		assert.equal(plan.validDraft, false);
		assert.match(plan.errors.join("\n"), /reports|fuera|archivo/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("suggestedSkillUpdates genera improve_skill", async () => {
	const root = tempRoot();
	try {
		writeSkillIndex(root);
		writeDraft(root);
		const plan = buildSkillImprovementPlan("latest", join(root, "reports"), {
			workspaceRoot: root,
		});
		const proposal = findProposal(plan.proposals, "improve_skill");

		assert.match(proposal.title, /project-understanding|auth|DB|skill/iu);
		assert.equal(proposal.requiresHumanApproval, true);
		assert.equal(proposal.status, "proposed");
		assert.ok(proposal.evidence.length > 0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("auth login repetido genera propuesta de seguridad", async () => {
	const root = tempRoot();
	try {
		writeSkillIndex(root);
		writeDraft(root);
		const plan = buildSkillImprovementPlan("latest", join(root, "reports"), {
			workspaceRoot: root,
		});

		assert.ok(
			plan.proposals.some(
				(proposal) =>
					/auth|login|security|seguridad/iu.test(
						`${proposal.skillName} ${proposal.title} ${proposal.description}`,
					) && ["create_skill", "improve_skill"].includes(proposal.type),
			),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("DB schema repetido genera propuesta de DB", async () => {
	const root = tempRoot();
	try {
		writeSkillIndex(root);
		writeDraft(root);
		const plan = buildSkillImprovementPlan("latest", join(root, "reports"), {
			workspaceRoot: root,
		});

		assert.ok(
			plan.proposals.some(
				(proposal) =>
					/db|database|schema|base de datos/iu.test(
						`${proposal.skillName} ${proposal.title} ${proposal.description}`,
					) && ["create_skill", "improve_skill"].includes(proposal.type),
			),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill ruidosa genera archive_skill propuesta", async () => {
	const root = tempRoot();
	try {
		writeSkillIndex(root);
		writeDraft(root);
		const plan = buildSkillImprovementPlan("latest", join(root, "reports"), {
			workspaceRoot: root,
		});
		const proposal = findProposal(plan.proposals, "archive_skill");

		assert.match(proposal.description, /No archivar|revisión humana|ruido/iu);
		assert.equal(proposal.suggestedAction, "approve_for_agent_review");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("create guarda skill-improvement-proposals en reports", async () => {
	const root = tempRoot();
	try {
		writeSkillIndex(root);
		writeDraft(root);
		const reportsPath = join(root, "reports");
		const result = createSkillImprovementProposals("latest", reportsPath, {
			workspaceRoot: root,
			now: () => new Date("2026-01-02T03:04:05.000Z"),
		});

		assert.equal(result.created.length, result.plan.proposals.length);
		assert.match(
			result.path ?? "",
			/skill-improvement-proposals-20260102-030405\.json$/u,
		);
		assert.equal(existsSync(result.path ?? ""), true);
		assert.match(
			formatSkillImprovementCreationResult(result),
			/Skill Improvement Proposals Created/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("create no modifica .agents ni .atl", async () => {
	const root = tempRoot();
	try {
		writeSkillIndex(root);
		writeDraft(root);
		const agentsBefore = readFileSync(
			join(root, ".agents", "skills", "INDEX.md"),
			"utf8",
		);
		const atlBefore = readFileSync(
			join(root, ".atl", "skill-registry.md"),
			"utf8",
		);
		const rootBefore = readdirSync(root).sort();

		createSkillImprovementProposals("latest", join(root, "reports"), {
			workspaceRoot: root,
			now: () => new Date("2026-01-02T03:04:05.000Z"),
		});

		assert.equal(
			readFileSync(join(root, ".agents", "skills", "INDEX.md"), "utf8"),
			agentsBefore,
		);
		assert.equal(
			readFileSync(join(root, ".atl", "skill-registry.md"), "utf8"),
			atlBefore,
		);
		assert.deepEqual(readdirSync(root).sort(), rootBefore);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("status muestra conteos", async () => {
	const root = tempRoot();
	try {
		writeSkillIndex(root);
		writeDraft(root);
		const result = createSkillImprovementProposals(
			"latest",
			join(root, "reports"),
			{
				workspaceRoot: root,
				now: () => new Date("2026-01-02T03:04:05.000Z"),
			},
		);
		const status = getSkillImprovementStatus("latest", join(root, "reports"));

		assert.equal(status.valid, true);
		assert.equal(status.proposals.length, result.created.length);
		assert.ok(status.countsByStatus.proposed > 0);
		assert.match(formatSkillImprovementStatus(status), /Resumen/u);
		assert.match(formatSkillImprovementStatus(status), /Tipos/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("deduplica propuestas repetidas", async () => {
	const root = tempRoot();
	try {
		writeSkillIndex(root);
		writeDraft(root, {
			suggestedSkillUpdates: [
				"Mejorar skill DB/schema",
				"mejorar skill database schema",
				"Mejorar skill DB/schema",
			],
			suggestedAgentTasks: [],
			criticalBugs: [],
			architecturalRisks: [],
			preservedRules: [],
			classifierQualityReview: {
				emotionCorrect: "likely_ok",
				categoryCorrect: "likely_ok",
				priorityCorrect: "likely_ok",
				intentCorrect: "likely_ok",
				guardrailCorrect: "likely_ok",
				falsePositives: [],
				falseNegatives: [],
				errorPatterns: [],
				recommendedRules: [],
			},
		});
		const plan = buildSkillImprovementPlan("latest", join(root, "reports"), {
			workspaceRoot: root,
		});

		assert.equal(
			plan.proposals.filter(
				(proposal) =>
					proposal.type === "create_skill" || proposal.type === "improve_skill",
			).length,
			1,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("limita a máximo 10 propuestas", async () => {
	const root = tempRoot();
	try {
		writeSkillIndex(root);
		writeDraft(root, {
			suggestedSkillUpdates: Array.from(
				{ length: 30 },
				(_, index) => `Mejorar skill auth ${index}`,
			),
		});
		const plan = buildSkillImprovementPlan("latest", join(root, "reports"), {
			workspaceRoot: root,
		});

		assert.ok(plan.proposals.length <= 10);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("status ruta fuera de reports falla", async () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		mkdirSync(reportsPath, { recursive: true });
		const outside = join(
			root,
			"skill-improvement-proposals-20260102-030405.json",
		);
		writeFileSync(outside, "{}");

		const status = getSkillImprovementStatus(resolve(outside), reportsPath);

		assert.equal(status.valid, false);
		assert.match(status.errors.join("\n"), /reports|fuera|archivo/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

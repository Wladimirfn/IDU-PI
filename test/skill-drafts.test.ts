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
import { join } from "node:path";
import { test } from "node:test";
import {
	createSkillDraftsFromApprovedProposals,
	formatSkillDraftCreationResult,
	formatSkillDraftReview,
	reviewSkillDraft,
	type SkillDraft,
} from "../src/skill-drafts.js";

const PROPOSAL_WARNING =
	"Propuestas revisables. No modificar skills sin aprobación humana.";
const DRAFT_WARNING = "Borrador de skill. No es fuente de verdad.";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "skill-drafts-"));
}

function proposal(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: "skill-improvement-001",
		type: "create_skill",
		skillName: "security-auth-review",
		title: "Crear skill security-auth-review",
		description: "Propuesta review-only de skill.",
		evidence: ["falló login seguridad SSE"],
		sourceDraftPath: "semantic-compaction-draft-20260102-030405.json",
		riskLevel: "high",
		expectedBenefit: ["quality", "safety"],
		requiresHumanApproval: true,
		suggestedAction: "approve_for_agent_review",
		status: "approved",
		createdAt: "2026-01-02T03:04:05.000Z",
		decisionLog: [
			{
				decision: "approved",
				decidedAt: "2026-01-02T04:05:06.000Z",
				source: "cli",
			},
		],
		...overrides,
	};
}

function writeProposalFile(
	root: string,
	proposals: Array<Record<string, unknown>> = [proposal()],
	name = "skill-improvement-proposals-20260102-030405.json",
): string {
	const reportsPath = join(root, "reports");
	mkdirSync(reportsPath, { recursive: true });
	const path = join(reportsPath, name);
	writeFileSync(
		path,
		`${JSON.stringify(
			{
				warning: PROPOSAL_WARNING,
				createdAt: "2026-01-02T03:04:05.000Z",
				sourceDraftPath: "semantic-compaction-draft-20260102-030405.json",
				projectId: "pi-telegram-bridge",
				proposals,
			},
			null,
			2,
		)}\n`,
	);
	return path;
}

function firstDraft(path: string): SkillDraft {
	const parsed = JSON.parse(readFileSync(path, "utf8")) as {
		skillDrafts: SkillDraft[];
	};
	assert.ok(parsed.skillDrafts[0]);
	return parsed.skillDrafts[0];
}

test("create usa sólo proposals approved", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [
			proposal({ id: "skill-improvement-001", status: "approved" }),
			proposal({ id: "skill-improvement-002", status: "proposed" }),
			proposal({ id: "skill-improvement-003", status: "rejected" }),
			proposal({ id: "skill-improvement-004", status: "deferred" }),
		]);

		const result = createSkillDraftsFromApprovedProposals(
			"latest",
			join(root, "reports"),
			{ now: () => new Date("2026-01-02T05:06:07.000Z") },
		);

		assert.equal(result.created.length, 1);
		assert.equal(result.omittedProposals.length, 3);
		assert.equal(result.created[0]?.proposalId, "skill-improvement-001");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("create_skill genera skillDraft", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [proposal({ type: "create_skill" })]);
		const result = createSkillDraftsFromApprovedProposals(
			"latest",
			join(root, "reports"),
		);

		assert.equal(result.created[0]?.action, "create_skill");
		assert.equal(result.created[0]?.skillName, "security-auth-review");
		assert.equal(result.created[0]?.requiresHumanApproval, true);
		assert.match(
			result.created[0]?.contentPreview ?? "",
			/security-auth-review/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("improve_skill genera skillDraft", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [
			proposal({
				type: "improve_skill",
				skillName: "project-understanding",
				title: "Mejorar skill project-understanding",
			}),
		]);
		const result = createSkillDraftsFromApprovedProposals(
			"latest",
			join(root, "reports"),
		);

		assert.equal(result.created[0]?.action, "improve_skill");
		assert.equal(result.created[0]?.skillName, "project-understanding");
		assert.match(result.created[0]?.purpose ?? "", /project-understanding/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("archive_skill y move_skill quedan notApplicable", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [
			proposal({ id: "skill-improvement-001", type: "archive_skill" }),
			proposal({ id: "skill-improvement-002", type: "move_skill" }),
		]);
		const result = createSkillDraftsFromApprovedProposals(
			"latest",
			join(root, "reports"),
		);

		assert.equal(result.created.length, 0);
		assert.deepEqual(
			result.notApplicable.map((item) => item.id),
			["skill-improvement-001", "skill-improvement-002"],
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("draft se guarda en reports/skill-draft", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root);
		const result = createSkillDraftsFromApprovedProposals(
			"latest",
			join(root, "reports"),
			{ now: () => new Date("2026-01-02T05:06:07.000Z") },
		);

		assert.match(result.path ?? "", /skill-draft-20260102-050607\.json$/u);
		assert.equal(existsSync(result.path ?? ""), true);
		const parsed = JSON.parse(
			readFileSync(result.path ?? "", "utf8"),
		) as Record<string, unknown>;
		assert.equal(parsed.warning, DRAFT_WARNING);
		assert.equal(
			firstDraft(result.path ?? "").proposalId,
			"skill-improvement-001",
		);
		assert.match(
			formatSkillDraftCreationResult(result),
			/Skill Drafts Created/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("review latest funciona", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root);
		createSkillDraftsFromApprovedProposals("latest", join(root, "reports"), {
			now: () => new Date("2026-01-02T05:06:07.000Z"),
		});

		const review = reviewSkillDraft("latest", join(root, "reports"));
		const formatted = formatSkillDraftReview(review);

		assert.equal(review.valid, true);
		assert.match(formatted, /security-auth-review/u);
		assert.match(formatted, /Safety rules|Reglas de seguridad/u);
		assert.match(formatted, /No modifiqué skills/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("review ruta fuera de reports falla", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		mkdirSync(reportsPath, { recursive: true });
		const outside = join(root, "skill-draft-20260102-030405.json");
		writeFileSync(outside, "{}");

		const review = reviewSkillDraft(outside, reportsPath);

		assert.equal(review.valid, false);
		assert.match(review.errors.join("\n"), /reports/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("review nombre inválido falla", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		mkdirSync(reportsPath, { recursive: true });
		writeFileSync(join(reportsPath, "bad.json"), "{}");

		const review = reviewSkillDraft("bad.json", reportsPath);

		assert.equal(review.valid, false);
		assert.match(review.errors.join("\n"), /skill-draft/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("no modifica .agents ni .atl", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root);
		mkdirSync(join(root, ".agents", "skills"), { recursive: true });
		mkdirSync(join(root, ".atl"), { recursive: true });
		writeFileSync(join(root, ".agents", "skills", "INDEX.md"), "skills");
		writeFileSync(join(root, ".atl", "skill-registry.md"), "registry");
		const agentsBefore = readFileSync(
			join(root, ".agents", "skills", "INDEX.md"),
			"utf8",
		);
		const atlBefore = readFileSync(
			join(root, ".atl", "skill-registry.md"),
			"utf8",
		);

		createSkillDraftsFromApprovedProposals("latest", join(root, "reports"));

		assert.equal(
			readFileSync(join(root, ".agents", "skills", "INDEX.md"), "utf8"),
			agentsBefore,
		);
		assert.equal(
			readFileSync(join(root, ".atl", "skill-registry.md"), "utf8"),
			atlBefore,
		);
		assert.ok(
			readdirSync(join(root, "reports")).some((file) =>
				file.startsWith("skill-draft-"),
			),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

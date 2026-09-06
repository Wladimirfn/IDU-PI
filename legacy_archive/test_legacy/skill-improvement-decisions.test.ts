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
	approveSkillImprovementProposal,
	deferSkillImprovementProposal,
	formatSkillImprovementDecisionResult,
	loadSkillImprovementProposalFile,
	rejectSkillImprovementProposal,
} from "../src/skill-improvement-decisions.js";

const WARNING =
	"Propuestas revisables. No modificar skills sin aprobación humana.";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "skill-decisions-"));
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
		status: "proposed",
		createdAt: "2026-01-02T03:04:05.000Z",
		...overrides,
	};
}

function writeProposalFile(
	root: string,
	proposals: Array<Record<string, unknown>> = [proposal()],
	name = "skill-improvement-proposals-20260102-030405.json",
	patch: Record<string, unknown> = {},
): string {
	const reportsPath = join(root, "reports");
	mkdirSync(reportsPath, { recursive: true });
	const path = join(reportsPath, name);
	writeFileSync(
		path,
		`${JSON.stringify(
			{
				warning: WARNING,
				createdAt: "2026-01-02T03:04:05.000Z",
				sourceDraftPath: "semantic-compaction-draft-20260102-030405.json",
				projectId: "pi-telegram-bridge",
				proposals,
				...patch,
			},
			null,
			2,
		)}\n`,
	);
	return path;
}

test("approve latest <id> cambia proposed -> approved", () => {
	const root = tempRoot();
	try {
		const path = writeProposalFile(root);
		const result = approveSkillImprovementProposal(
			"latest",
			"skill-improvement-001",
			join(root, "reports"),
			{ now: () => new Date("2026-01-02T04:05:06.000Z") },
		);
		const saved = loadSkillImprovementProposalFile(path, join(root, "reports"));

		assert.equal(saved.proposals[0]?.status, "approved");
		assert.equal(saved.proposals[0]?.decisionLog?.[0]?.decision, "approved");
		assert.equal(saved.proposals[0]?.decisionLog?.[0]?.source, "cli");
		assert.match(
			formatSkillImprovementDecisionResult(result),
			/Sólo registré decisión humana/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reject latest <id> cambia proposed -> rejected", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root);
		const result = rejectSkillImprovementProposal(
			"latest",
			"skill-improvement-001",
			join(root, "reports"),
		);

		assert.equal(result.updated[0]?.status, "rejected");
		assert.equal(result.updated[0]?.decisionLog?.[0]?.decision, "rejected");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("defer latest <id> cambia proposed -> deferred", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root);
		const result = deferSkillImprovementProposal(
			"latest",
			"skill-improvement-001",
			join(root, "reports"),
		);

		assert.equal(result.updated[0]?.status, "deferred");
		assert.equal(result.updated[0]?.decisionLog?.[0]?.decision, "deferred");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("approve latest all aprueba todas las proposed", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [
			proposal({ id: "skill-improvement-001" }),
			proposal({
				id: "skill-improvement-002",
				type: "improve_skill",
				skillName: "project-understanding",
			}),
			proposal({ id: "skill-improvement-003", status: "deferred" }),
		]);

		const result = approveSkillImprovementProposal(
			"latest",
			"all",
			join(root, "reports"),
		);

		assert.equal(result.updated.length, 2);
		assert.equal(result.skipped.length, 0);
		assert.ok(
			result.file.proposals.every((item) => item.status !== "proposed"),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reject y defer guardan reason", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [
			proposal({ id: "skill-improvement-001" }),
			proposal({ id: "skill-improvement-002" }),
		]);
		const rejected = rejectSkillImprovementProposal(
			"latest",
			"skill-improvement-001",
			join(root, "reports"),
			{ reason: "no aplica", source: "telegram" },
		);
		const deferred = deferSkillImprovementProposal(
			"latest",
			"skill-improvement-002",
			join(root, "reports"),
			{ reason: "requiere revisar evidencia" },
		);

		assert.equal(rejected.updated[0]?.decisionLog?.[0]?.reason, "no aplica");
		assert.equal(rejected.updated[0]?.decisionLog?.[0]?.source, "telegram");
		assert.equal(
			deferred.updated[0]?.decisionLog?.[0]?.reason,
			"requiere revisar evidencia",
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("proposalId inexistente falla", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root);

		assert.throws(
			() =>
				approveSkillImprovementProposal(
					"latest",
					"missing",
					join(root, "reports"),
				),
			/No existe propuesta/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("ruta fuera de reports falla", () => {
	const root = tempRoot();
	try {
		const outside = join(
			root,
			"skill-improvement-proposals-20260102-030405.json",
		);
		writeFileSync(outside, "{}");
		mkdirSync(join(root, "reports"), { recursive: true });

		assert.throws(
			() => loadSkillImprovementProposalFile(outside, join(root, "reports")),
			/reports/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("nombre inválido falla", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		mkdirSync(reportsPath, { recursive: true });
		const path = join(reportsPath, "bad.json");
		writeFileSync(path, "{}");

		assert.throws(
			() => loadSkillImprovementProposalFile(path, reportsPath),
			/skill-improvement-proposals/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("JSON inválido falla", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		mkdirSync(reportsPath, { recursive: true });
		writeFileSync(
			join(reportsPath, "skill-improvement-proposals-20260102-030405.json"),
			"{",
		);

		assert.throws(
			() => loadSkillImprovementProposalFile("latest", reportsPath),
			/JSON válido/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("crea backup antes de escribir", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root);
		const result = approveSkillImprovementProposal(
			"latest",
			"skill-improvement-001",
			join(root, "reports"),
			{ now: () => new Date("2026-01-02T04:05:06.000Z") },
		);

		assert.ok(result.backupPath);
		assert.equal(existsSync(result.backupPath ?? ""), true);
		assert.match(
			result.backupPath ?? "",
			/skill-improvement-proposals\.backup-20260102-040506\.json$/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("no permite redeclarar decisión ya tomada", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [proposal({ status: "approved" })]);

		assert.throws(
			() =>
				rejectSkillImprovementProposal(
					"latest",
					"skill-improvement-001",
					join(root, "reports"),
				),
			/ya tiene decisión/u,
		);
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

		approveSkillImprovementProposal(
			"latest",
			"skill-improvement-001",
			join(root, "reports"),
		);

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
				file.startsWith("skill-improvement-proposals.backup-"),
			),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

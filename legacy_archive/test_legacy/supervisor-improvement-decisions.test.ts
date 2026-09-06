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
	approveSupervisorImprovement,
	deferSupervisorImprovement,
	formatSupervisorImprovementDecisionResult,
	formatSupervisorImprovementStatus,
	getSupervisorImprovementStatus,
	loadSupervisorImprovementProposalFile,
	rejectSupervisorImprovement,
} from "../src/supervisor-improvement-decisions.js";

const WARNING = "Propuestas revisables. No aplicar sin aprobación humana.";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "supervisor-decisions-"));
}

function proposal(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: "improvement-001",
		type: "intent_rule_update",
		title: "Clasificar fallas DB",
		description: "Regla propuesta",
		evidence: ["db failure classified low"],
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
	name = "supervisor-improvement-proposals-20260102-030405.json",
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

test("status latest muestra conteos por estado", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [
			proposal({ id: "improvement-001", status: "proposed" }),
			proposal({
				id: "improvement-002",
				type: "skill_update",
				status: "approved",
			}),
			proposal({
				id: "improvement-003",
				type: "classifier_review",
				status: "rejected",
			}),
			proposal({
				id: "improvement-004",
				type: "workflow_improvement",
				status: "deferred",
			}),
		]);

		const status = getSupervisorImprovementStatus(
			"latest",
			join(root, "reports"),
		);
		const formatted = formatSupervisorImprovementStatus(status);

		assert.deepEqual(status.counts, {
			proposed: 1,
			approved: 1,
			rejected: 1,
			deferred: 1,
		});
		assert.match(formatted, /Supervisor Improvement Status/u);
		assert.match(
			formatted,
			/improvement-001 intent_rule_update high proposed/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("approve latest <id> cambia proposed -> approved", () => {
	const root = tempRoot();
	try {
		const path = writeProposalFile(root);
		const result = approveSupervisorImprovement(
			"latest",
			"improvement-001",
			join(root, "reports"),
			{
				now: () => new Date("2026-01-02T04:05:06.000Z"),
			},
		);
		const saved = loadSupervisorImprovementProposalFile(
			path,
			join(root, "reports"),
		);

		assert.equal(saved.proposals[0]?.status, "approved");
		assert.equal(saved.proposals[0]?.decision?.decision, "approved");
		assert.equal(saved.proposals[0]?.decision?.source, "cli");
		assert.match(
			formatSupervisorImprovementDecisionResult(result),
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
		const result = rejectSupervisorImprovement(
			"latest",
			"improvement-001",
			join(root, "reports"),
		);

		assert.equal(result.updated[0]?.status, "rejected");
		assert.equal(result.updated[0]?.decision?.decision, "rejected");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("defer latest <id> cambia proposed -> deferred", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root);
		const result = deferSupervisorImprovement(
			"latest",
			"improvement-001",
			join(root, "reports"),
		);

		assert.equal(result.updated[0]?.status, "deferred");
		assert.equal(result.updated[0]?.decision?.decision, "deferred");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("approve latest all aprueba todas las proposed", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [
			proposal({ id: "improvement-001" }),
			proposal({ id: "improvement-002", type: "skill_update" }),
			proposal({ id: "improvement-003", status: "deferred" }),
		]);

		const result = approveSupervisorImprovement(
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

test("reject con motivo guarda reason", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root);
		const result = rejectSupervisorImprovement(
			"latest",
			"improvement-001",
			join(root, "reports"),
			{
				reason: "no aplica al proyecto",
				source: "telegram",
			},
		);

		assert.equal(result.updated[0]?.decision?.reason, "no aplica al proyecto");
		assert.equal(result.updated[0]?.decision?.source, "telegram");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("defer con motivo guarda reason", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root);
		const result = deferSupervisorImprovement(
			"latest",
			"improvement-001",
			join(root, "reports"),
			{
				reason: "requiere más evidencia",
			},
		);

		assert.equal(result.updated[0]?.decision?.reason, "requiere más evidencia");
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
				approveSupervisorImprovement(
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
			"supervisor-improvement-proposals-20260102-030405.json",
		);
		writeFileSync(outside, "{}");
		mkdirSync(join(root, "reports"), { recursive: true });

		assert.throws(
			() =>
				loadSupervisorImprovementProposalFile(outside, join(root, "reports")),
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
			() => loadSupervisorImprovementProposalFile(path, reportsPath),
			/supervisor-improvement-proposals/u,
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
			join(
				reportsPath,
				"supervisor-improvement-proposals-20260102-030405.json",
			),
			"{",
		);

		assert.throws(
			() => loadSupervisorImprovementProposalFile("latest", reportsPath),
			/JSON válido/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("estructura de propuesta inválida falla", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [
			proposal({
				type: "invalid_type",
				riskLevel: "danger",
				suggestedAction: "apply_now",
				expectedBenefit: ["quality", "invalid"],
			}),
		]);

		assert.throws(
			() =>
				loadSupervisorImprovementProposalFile("latest", join(root, "reports")),
			/type inválido|riskLevel inválido|suggestedAction inválido|arrays inválidos/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("crea backup antes de escribir", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root);
		const result = approveSupervisorImprovement(
			"latest",
			"improvement-001",
			join(root, "reports"),
			{
				now: () => new Date("2026-01-02T04:05:06.000Z"),
			},
		);

		assert.ok(result.backupPath);
		assert.equal(existsSync(result.backupPath ?? ""), true);
		assert.match(
			result.backupPath ?? "",
			/supervisor-improvement-proposals\.backup-20260102-040506\.json$/u,
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
				rejectSupervisorImprovement(
					"latest",
					"improvement-001",
					join(root, "reports"),
				),
			/ya tiene decisión/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("no aplica cambios al código skills constitution", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root);
		const code = join(root, "human-intent.ts");
		const skill = join(root, "skill.md");
		const constitution = join(root, "constitution.json");
		writeFileSync(code, "code");
		writeFileSync(skill, "skill");
		writeFileSync(constitution, "constitution");

		approveSupervisorImprovement(
			"latest",
			"improvement-001",
			join(root, "reports"),
		);

		assert.equal(readFileSync(code, "utf8"), "code");
		assert.equal(readFileSync(skill, "utf8"), "skill");
		assert.equal(readFileSync(constitution, "utf8"), "constitution");
		assert.ok(
			readdirSync(join(root, "reports")).some((file) =>
				file.startsWith("supervisor-improvement-proposals.backup-"),
			),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

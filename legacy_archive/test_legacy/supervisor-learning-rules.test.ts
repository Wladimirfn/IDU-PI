import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { classifyHumanIntent } from "../src/human-intent.js";
import {
	applySupervisorLearningRules,
	disableSupervisorLearningRule,
	enableSupervisorLearningRule,
	formatSupervisorLearningRuleDecision,
	formatSupervisorLearningRulesApplyResult,
	formatSupervisorLearningRulesRollback,
	formatSupervisorLearningRulesStatus,
	formatSupervisorLearningRulesTest,
	getSupervisorLearningRulesStatus,
	learningRulesPath,
	rollbackSupervisorLearningRules,
	testSupervisorLearningRules,
} from "../src/supervisor-learning-rules.js";

const WARNING = "Propuestas revisables. No aplicar sin aprobación humana.";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "supervisor-learning-"));
}

function proposal(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: "improvement-001",
		type: "intent_rule_update",
		title: "Clasificar fallas DB como bug/database/high",
		description: "falla + base de datos/db/schema => bug/database/high",
		evidence: ["db/schema failure classified low"],
		sourceDraftPath: "semantic-compaction-draft-20260102-030405.json",
		riskLevel: "high",
		expectedBenefit: ["quality", "safety"],
		requiresHumanApproval: true,
		suggestedAction: "approve_for_agent_review",
		status: "approved",
		createdAt: "2026-01-02T03:04:05.000Z",
		decision: {
			decision: "approved",
			decidedAt: "2026-01-02T04:05:06.000Z",
			source: "cli",
		},
		...overrides,
	};
}

function writeProposalFile(
	root: string,
	proposals: Array<Record<string, unknown>>,
): string {
	const reportsPath = join(root, "reports");
	mkdirSync(reportsPath, { recursive: true });
	const path = join(
		reportsPath,
		"supervisor-improvement-proposals-20260102-030405.json",
	);
	writeFileSync(
		path,
		`${JSON.stringify(
			{
				warning: WARNING,
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

function readRules(root: string) {
	return JSON.parse(
		readFileSync(
			join(root, "reports", "supervisor-learning-rules.json"),
			"utf8",
		),
	) as {
		rules: Array<Record<string, unknown>>;
	};
}

test("apply latest sólo aplica proposals approved", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [
			proposal({ id: "improvement-001", status: "approved" }),
			proposal({ id: "improvement-002", status: "proposed" }),
		]);
		const result = applySupervisorLearningRules(
			"latest",
			join(root, "reports"),
			{
				now: () => new Date("2026-01-02T05:06:07.000Z"),
			},
		);

		assert.equal(result.created.length, 1);
		assert.equal(result.omitted.length, 1);
		assert.equal(readRules(root).rules.length, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("rejected/deferred/proposed no se aplican", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [
			proposal({ id: "improvement-001", status: "rejected" }),
			proposal({ id: "improvement-002", status: "deferred" }),
			proposal({ id: "improvement-003", status: "proposed" }),
		]);
		const result = applySupervisorLearningRules(
			"latest",
			join(root, "reports"),
		);

		assert.equal(result.created.length, 0);
		assert.equal(result.omitted.length, 3);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("status approved sin decisión humana registrada no se aplica", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [
			proposal({
				id: "improvement-001",
				status: "approved",
				decision: undefined,
			}),
		]);
		const result = applySupervisorLearningRules(
			"latest",
			join(root, "reports"),
		);

		assert.equal(result.created.length, 0);
		assert.equal(result.omitted.length, 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("intent_rule_update crea dynamic rule", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [proposal()]);
		const result = applySupervisorLearningRules(
			"latest",
			join(root, "reports"),
		);

		assert.equal(result.created[0]?.type, "intent_rule");
		assert.equal(result.created[0]?.sourceProposalId, "improvement-001");
		assert.ok(result.created[0]?.outcome.riskHints.includes("db_change"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("skill/core/constitution quedan no aplicables", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [
			proposal({
				id: "improvement-001",
				type: "skill_update",
				title: "Mejorar skill DB/schema",
			}),
			proposal({
				id: "improvement-002",
				type: "constitution_suggestion",
				title: "Revisar Constitution",
			}),
			proposal({
				id: "improvement-003",
				type: "project_core_review",
				title: "Revisar Project Core",
			}),
		]);
		const result = applySupervisorLearningRules(
			"latest",
			join(root, "reports"),
		);

		assert.equal(result.created.length, 0);
		assert.deepEqual(
			result.notApplicable.map((item) => item.type),
			["skill_update", "constitution_suggestion", "project_core_review"],
		);
		assert.match(
			formatSupervisorLearningRulesApplyResult(result),
			/No aplicables todavía/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("workflow_improvement no escribe low_risk dinámico", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [
			proposal({
				id: "improvement-001",
				type: "workflow_improvement",
				title: "Mejorar workflow de cola",
				description: "queue prompt workflow",
				evidence: ["queue prompt repeats"],
			}),
		]);
		const result = applySupervisorLearningRules(
			"latest",
			join(root, "reports"),
		);

		assert.equal(result.created[0]?.type, "workflow_rule");
		assert.deepEqual(result.created[0]?.outcome.riskHints, []);
		assert.doesNotMatch(JSON.stringify(readRules(root)), /low_risk/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("phrase-only alias no escribe low_risk dinámico", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [
			proposal({
				id: "improvement-001",
				title: "Clasificar frobnicator como alias",
				description: "frobnicator => alias",
				evidence: ["frobnicator repeats"],
			}),
		]);
		const result = applySupervisorLearningRules(
			"latest",
			join(root, "reports"),
		);

		assert.equal(result.created[0]?.type, "alias_rule");
		assert.deepEqual(result.created[0]?.outcome.riskHints, []);
		assert.doesNotMatch(JSON.stringify(readRules(root)), /low_risk/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("learning rules persisted no acepta low_risk", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		mkdirSync(reportsPath, { recursive: true });
		writeFileSync(
			learningRulesPath(reportsPath),
			`${JSON.stringify({
				version: 1,
				updatedAt: "2026-01-02T00:00:00.000Z",
				sourceProposalFiles: ["manual"],
				rules: [
					{
						id: "learn-low",
						type: "intent_rule",
						sourceProposalId: "manual",
						sourceProposalFile: "manual",
						enabled: true,
						description: "bad low rule",
						match: { phrases: ["login"], concepts: [] },
						outcome: { concepts: [], riskHints: ["low_risk"] },
						createdAt: "2026-01-02T00:00:00.000Z",
						approvedBy: "human",
					},
				],
			})}\n`,
		);

		const status = getSupervisorLearningRulesStatus(reportsPath);

		assert.equal(status.exists, false);
		assert.match(
			status.warnings.join("\n"),
			/Archivo de reglas inválido|No pude cargar/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("crea backup antes de sobrescribir learning rules", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		mkdirSync(reportsPath, { recursive: true });
		writeFileSync(
			learningRulesPath(reportsPath),
			JSON.stringify({
				version: 1,
				updatedAt: "old",
				sourceProposalFiles: [],
				rules: [],
			}),
		);
		writeProposalFile(root, [proposal()]);
		const result = applySupervisorLearningRules("latest", reportsPath, {
			now: () => new Date("2026-01-02T05:06:07.000Z"),
		});

		assert.ok(result.backupPath);
		assert.equal(existsSync(result.backupPath ?? ""), true);
		assert.match(
			result.backupPath ?? "",
			/supervisor-learning-rules\.backup-20260102-050607\.json$/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("status muestra reglas activas", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [proposal()]);
		applySupervisorLearningRules("latest", join(root, "reports"));
		const status = getSupervisorLearningRulesStatus(join(root, "reports"));
		const formatted = formatSupervisorLearningRulesStatus(status);

		assert.equal(status.ruleCount, 1);
		assert.equal(status.enabledCount, 1);
		assert.match(formatted, /Supervisor Learning Rules Status/u);
		assert.match(formatted, /intent_rule/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("human-intent usa learning rule para clasificar un caso nuevo", () => {
	const root = tempRoot();
	const previous = process.env.AGENT_WORKSPACE_ROOT;
	try {
		writeProposalFile(root, [
			proposal({
				title: "Clasificar frobnicator como auth/login/high",
				description: "frobnicator => auth/login/high",
				evidence: ["frobnicator session issue"],
			}),
		]);
		applySupervisorLearningRules("latest", join(root, "reports"));
		process.env.AGENT_WORKSPACE_ROOT = root;

		const result = classifyHumanIntent("frobnicator rompe otra vez");

		assert.ok(result.concepts.includes("auth"));
		assert.equal(result.riskHint, "high");
		assert.equal(result.taskCategory, "bug");
	} finally {
		if (previous === undefined) delete process.env.AGENT_WORKSPACE_ROOT;
		else process.env.AGENT_WORKSPACE_ROOT = previous;
		rmSync(root, { recursive: true, force: true });
	}
});

test("learning rule no puede bajar riesgo high", () => {
	const root = tempRoot();
	const previous = process.env.AGENT_WORKSPACE_ROOT;
	try {
		mkdirSync(join(root, "reports"), { recursive: true });
		writeFileSync(
			learningRulesPath(join(root, "reports")),
			`${JSON.stringify({
				version: 1,
				updatedAt: "2026-01-02T00:00:00.000Z",
				sourceProposalFiles: ["manual"],
				rules: [
					{
						id: "learn-low",
						type: "intent_rule",
						sourceProposalId: "manual",
						sourceProposalFile: "manual",
						enabled: true,
						description: "bad low rule",
						match: { phrases: ["login"], concepts: [] },
						outcome: {
							intent: "question",
							taskCategory: "general",
							concepts: [],
							riskHints: ["low_risk"],
							priorityBoost: 0,
						},
						createdAt: "2026-01-02T00:00:00.000Z",
						approvedBy: "human",
					},
				],
			})}\n`,
		);
		process.env.AGENT_WORKSPACE_ROOT = root;

		const result = classifyHumanIntent("falló login");

		assert.equal(result.riskHint, "high");
	} finally {
		if (previous === undefined) delete process.env.AGENT_WORKSPACE_ROOT;
		else process.env.AGENT_WORKSPACE_ROOT = previous;
		rmSync(root, { recursive: true, force: true });
	}
});

test("status muestra reglas enabled y disabled", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [proposal()]);
		applySupervisorLearningRules("latest", join(root, "reports"));
		disableSupervisorLearningRule(
			"learn-improvement-001",
			join(root, "reports"),
			{
				source: "cli",
				reason: "ruidosa",
				now: () => new Date("2026-01-02T06:00:00.000Z"),
			},
		);

		const status = getSupervisorLearningRulesStatus(join(root, "reports"));
		const formatted = formatSupervisorLearningRulesStatus(status);

		assert.equal(status.ruleCount, 1);
		assert.equal(status.enabledCount, 0);
		assert.equal(status.disabledCount, 1);
		assert.match(formatted, /disabled: 1/u);
		assert.match(formatted, /enabled=false/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("testSupervisorLearningRules ejecuta casos internos sin escribir", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [proposal()]);
		applySupervisorLearningRules("latest", join(root, "reports"));
		const path = learningRulesPath(join(root, "reports"));
		const before = readFileSync(path, "utf8");
		const beforeMtime = statSync(path).mtimeMs;

		const result = testSupervisorLearningRules(join(root, "reports"));
		const formatted = formatSupervisorLearningRulesTest(result);

		assert.equal(result.cases.length, 5);
		assert.ok(
			result.cases.some((item) => item.input === "fallas en base de datos"),
		);
		assert.ok(result.cases.some((item) => item.matchedRules.length > 0));
		assert.match(formatted, /Supervisor Learning Rules Test/u);
		assert.equal(readFileSync(path, "utf8"), before);
		assert.equal(statSync(path).mtimeMs, beforeMtime);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("disable cambia enabled=false y crea backup", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [proposal()]);
		applySupervisorLearningRules("latest", join(root, "reports"));

		const result = disableSupervisorLearningRule(
			"learn-improvement-001",
			join(root, "reports"),
			{
				source: "cli",
				reason: "ruidosa",
				now: () => new Date("2026-01-02T06:00:00.000Z"),
			},
		);

		assert.equal(result.rule.enabled, false);
		assert.equal(result.rule.decisionLog?.at(-1)?.action, "disabled");
		assert.equal(existsSync(result.backupPath), true);
		assert.match(formatSupervisorLearningRuleDecision(result), /disabled/u);
		assert.equal(readRules(root).rules[0]?.enabled, false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("enable cambia enabled=true y crea backup", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [proposal()]);
		applySupervisorLearningRules("latest", join(root, "reports"));
		disableSupervisorLearningRule(
			"learn-improvement-001",
			join(root, "reports"),
			{
				source: "cli",
				now: () => new Date("2026-01-02T06:00:00.000Z"),
			},
		);

		const result = enableSupervisorLearningRule(
			"learn-improvement-001",
			join(root, "reports"),
			{
				source: "telegram",
				reason: "validada",
				now: () => new Date("2026-01-02T06:00:01.000Z"),
			},
		);

		assert.equal(result.rule.enabled, true);
		assert.equal(result.rule.decisionLog?.at(-1)?.action, "enabled");
		assert.equal(result.rule.decisionLog?.at(-1)?.source, "telegram");
		assert.equal(existsSync(result.backupPath), true);
		assert.match(formatSupervisorLearningRuleDecision(result), /enabled/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("disable/enable ruleId inexistente falla", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [proposal()]);
		applySupervisorLearningRules("latest", join(root, "reports"));

		assert.throws(
			() =>
				disableSupervisorLearningRule("missing", join(root, "reports"), {
					source: "cli",
				}),
			/ruleId no encontrado/u,
		);
		assert.throws(
			() =>
				enableSupervisorLearningRule("missing", join(root, "reports"), {
					source: "cli",
				}),
			/ruleId no encontrado/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("rollback latest restaura backup y crea backup actual", () => {
	const root = tempRoot();
	try {
		writeProposalFile(root, [proposal()]);
		applySupervisorLearningRules("latest", join(root, "reports"), {
			now: () => new Date("2026-01-02T05:00:00.000Z"),
		});
		disableSupervisorLearningRule(
			"learn-improvement-001",
			join(root, "reports"),
			{
				source: "cli",
				now: () => new Date("2026-01-02T06:00:00.000Z"),
			},
		);

		const result = rollbackSupervisorLearningRules(
			"latest",
			join(root, "reports"),
			{
				now: () => new Date("2026-01-02T07:00:00.000Z"),
			},
		);

		assert.equal(result.file.rules[0]?.enabled, true);
		assert.equal(readRules(root).rules[0]?.enabled, true);
		assert.equal(existsSync(result.backupPath), true);
		assert.match(
			result.restoredFrom,
			/supervisor-learning-rules\.backup-20260102-060000\.json$/u,
		);
		assert.match(formatSupervisorLearningRulesRollback(result), /Rollback/u);
		assert.ok(
			readdirSync(join(root, "reports")).some(
				(name) =>
					name === "supervisor-learning-rules.backup-20260102-070000.json",
			),
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("rollback rechaza rutas externas", () => {
	const root = tempRoot();
	try {
		mkdirSync(join(root, "reports"), { recursive: true });
		assert.throws(
			() =>
				rollbackSupervisorLearningRules(
					join(root, "outside.json"),
					join(root, "reports"),
				),
			/ruta externa|backup inválido/u,
		);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("JSON inválido en learning rules no rompe clasificación", () => {
	const root = tempRoot();
	const previous = process.env.AGENT_WORKSPACE_ROOT;
	try {
		mkdirSync(join(root, "reports"), { recursive: true });
		writeFileSync(learningRulesPath(join(root, "reports")), "{");
		process.env.AGENT_WORKSPACE_ROOT = root;

		const result = classifyHumanIntent("hola");

		assert.equal(result.originalText, "hola");
	} finally {
		if (previous === undefined) delete process.env.AGENT_WORKSPACE_ROOT;
		else process.env.AGENT_WORKSPACE_ROOT = previous;
		rmSync(root, { recursive: true, force: true });
	}
});

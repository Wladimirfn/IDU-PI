import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import test from "node:test";
import {
	createAgentLabReviewRequests,
	formatAgentLabReviewRequestPlan,
	formatAgentLabReviewRequestReview,
	reviewAgentLabReviewRequest,
} from "../src/agentlab-review-requests.js";
import { formatAgentLabReviewRequestForPrompt } from "../src/agentlab-supervisor-contract.js";
import { generateMasterPlanDraft } from "../src/master-plan.js";
import type { ProjectPostflightReport } from "../src/project-postflight.js";

function root(): string {
	return mkdtempSync(join(tmpdir(), "agentlab-review-requests-"));
}

function now(): Date {
	return new Date("2026-05-25T12:34:56.000Z");
}

function postflight(changedFiles: string[]): ProjectPostflightReport {
	return {
		risk: "high",
		changedFiles,
		impactedAreas: changedFiles.some((file) => /db|schema/u.test(file))
			? ["DB/storage"]
			: ["seguridad"],
		warnings: changedFiles.map((file) => `revisar ${file}`),
		recommendedNext: "Crear solicitud AgentLab antes de ejecutar revisión.",
		shouldRunAgentLab: true,
		suggestedAgentLabs: [],
		requiresHumanConfirmation: true,
		diffSummary: changedFiles.join("\n"),
	};
}

function writeLargeProject(projectPath: string): void {
	mkdirSync(join(projectPath, "src", "ui"), { recursive: true });
	mkdirSync(join(projectPath, "db"), { recursive: true });
	writeFileSync(
		join(projectPath, "package.json"),
		JSON.stringify({
			dependencies: { express: "1.0.0", sqlite3: "1.0.0", react: "1.0.0" },
		}),
		"utf8",
	);
	writeFileSync(
		join(projectPath, "src", "ui", "login.html"),
		"<form id='login'></form>",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "db", "schema.sql"),
		"create table users(id int);",
		"utf8",
	);
	writeFileSync(
		join(projectPath, "src", "auth.ts"),
		"export const login = () => true;",
		"utf8",
	);
	for (let index = 0; index < 130; index += 1) {
		const dir = join(projectPath, "src", `module-${index}`);
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, `file-${index}.ts`),
			"export const value = 'auth db security ui';\n",
			"utf8",
		);
	}
}

function writeSkillDraft(reportsPath: string): void {
	mkdirSync(reportsPath, { recursive: true });
	writeFileSync(
		join(reportsPath, "skill-draft-20260525-120000.json"),
		`${JSON.stringify(
			{
				generatedAt: "2026-05-25T12:00:00.000Z",
				sourceProposalFile: "skill-improvement-proposals-20260525-110000.json",
				warning: "Borrador de skill. No es fuente de verdad.",
				skillDrafts: [
					{
						proposalId: "skill-improvement-001",
						action: "create_skill",
						skillName: "security-auth-review",
						targetPath: ".agents/skills/security-auth-review/SKILL.md",
						title: "Crear skill security-auth-review",
						purpose: "Revisar auth",
						whenToUse: "Cambios de login",
						safetyRules: ["No aplicar automáticamente"],
						inputsExpected: ["draft"],
						outputsExpected: ["review"],
						testsSuggested: ["skill-check"],
						contentPreview: "---\nname: security-auth-review\n---",
						requiresHumanApproval: true,
					},
				],
				omittedProposals: [],
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
}

test("postflight high crea request security/database según impacto", () => {
	const reportsPath = join(root(), "reports");
	const security = createAgentLabReviewRequests({
		source: "postflight",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		postflightReport: postflight(["src/auth/login.ts"]),
		now,
	});
	const database = createAgentLabReviewRequests({
		source: "postflight",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		postflightReport: postflight(["src/db/schema.ts"]),
		now: () => new Date("2026-05-25T12:35:56.000Z"),
	});

	assert.equal(security.requests[0]?.specialty, "security");
	assert.equal(database.requests[0]?.specialty, "database");
	assert.match(
		security.path ?? "",
		/agentlabs[\\/]requests[\\/]current\.json$/u,
	);
	assert.ok(existsSync(security.path!));
});

test("master-plan deep_required crea requests desde Plan Maestro", () => {
	const temp = root();
	const projectPath = join(temp, "project");
	const stateRoot = join(temp, "state");
	writeLargeProject(projectPath);
	generateMasterPlanDraft({
		projectId: "pi-telegram-bridge",
		projectPath,
		stateRoot,
		gitHead: "abc123",
	});

	const result = createAgentLabReviewRequests({
		source: "master_plan",
		reportsPath: join(stateRoot, "reports"),
		projectId: "pi-telegram-bridge",
		projectPath,
		masterPlanPathOrLatest: "latest",
		now,
	});

	assert.ok(result.requests.length > 0);
	assert.equal(result.source, "master_plan");
	assert.ok(
		result.requests.some(
			(request) => request.specialty === "project_understanding",
		),
	);
	assert.ok(
		result.requests.some((request) => request.specialty === "architecture"),
	);
	assert.ok(
		result.requests.some((request) => request.specialty === "database"),
	);
	assert.ok(
		result.requests.some((request) => request.specialty === "security"),
	);
	assert.ok(result.requests.some((request) => request.specialty === "ui_ux"));
	assert.ok(
		result.requests.every((request) => request.trigger === "master_plan"),
	);
	assert.ok(
		result.requests.every(
			(request) => request.tokenBudgetHint === "bounded-master-plan-review",
		),
	);
	assert.ok(result.requests.every((request) => request.maxCommands <= 4));
	assert.ok(
		result.requests
			.filter((request) => ["database", "security"].includes(request.specialty))
			.every((request) => request.requiresHumanApproval),
	);
	assert.match(result.requests[0]!.contextSummary, /AutoDepth: deep_required/u);
	assert.match(
		result.requests[0]!.evidence.join("\n"),
		/architecture|dataStore|security|flow/u,
	);
	assert.ok(
		result.requests[0]!.filesToInspect.some((file) =>
			/master-plan\.json/u.test(file),
		),
	);
});

test("master-plan incompatible no crea requests", () => {
	const temp = root();
	const stateRoot = join(temp, "state");
	const reportsPath = join(stateRoot, "reports");
	mkdirSync(reportsPath, { recursive: true });
	writeFileSync(
		join(reportsPath, "master-plan-20260525-120000.json"),
		`${JSON.stringify({ schemaVersion: 1, status: "draft" }, null, 2)}\n`,
		"utf8",
	);
	writeFileSync(
		join(stateRoot, "master-plan.current.json"),
		`${JSON.stringify(
			{
				currentPlanJson: "reports/master-plan-20260525-120000.json",
				currentPlanMd: "reports/master-plan-20260525-120000.md",
				status: "draft",
				projectId: "pi-telegram-bridge",
				projectPath: temp,
				updatedAt: now().toISOString(),
			},
			null,
			2,
		)}\n`,
		"utf8",
	);

	const result = createAgentLabReviewRequests({
		source: "master_plan",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath: temp,
		masterPlanPathOrLatest: "latest",
		now,
	});

	assert.equal(result.requests.length, 0);
	assert.match(result.errors.join("\n"), /Plan Maestro incompatible/u);
});

test("skill-draft sin draft válido falla visible", () => {
	const reportsPath = join(root(), "reports");
	const result = createAgentLabReviewRequests({
		source: "skill_draft",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		skillDraftPathOrLatest: "latest",
		now,
	});
	assert.equal(result.requests.length, 0);
	assert.match(result.errors.join("\n"), /No encontré skill draft válido/u);
});

test("skill-draft crea request skill_review", () => {
	const reportsPath = join(root(), "reports");
	writeSkillDraft(reportsPath);
	const result = createAgentLabReviewRequests({
		source: "skill_draft",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		skillDraftPathOrLatest: "latest",
		now,
	});
	assert.equal(result.requests.length, 1);
	assert.equal(result.requests[0]?.specialty, "skill_review");
	const forbidden = result.requests[0]!.forbiddenActions.join("\n");
	assert.match(forbidden, /no modificar skills reales/u);
	assert.match(forbidden, /no modificar \.agents/u);
	assert.match(forbidden, /no modificar \.atl/u);
});

test("skill-draft request usa JSON de reports como fuente temporal", () => {
	const reportsPath = join(root(), "reports");
	writeSkillDraft(reportsPath);
	const result = createAgentLabReviewRequests({
		source: "skill_draft",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		skillDraftPathOrLatest: "latest",
		now,
	});
	const request = result.requests[0]!;
	const prompt = formatAgentLabReviewRequestForPrompt(request);

	assert.match(
		request.sourceSkillDraftPath ?? "",
		/skill-draft-20260525-120000\.json/u,
	);
	assert.deepEqual(request.filesToInspect, [request.sourceSkillDraftPath]);
	assert.doesNotMatch(
		request.filesToInspect.join("\n"),
		/\.agents\/skills\/security-auth-review\/SKILL\.md/u,
	);
	assert.match(prompt, /No busques SKILL\.md real/u);
	assert.match(prompt, /Revisa el JSON de draft/u);
	assert.match(prompt, /Source skill draft path:/u);
	assert.match(prompt, /Skill: security-auth-review/u);
	assert.match(prompt, /Action: create_skill/u);
	assert.match(prompt, /Purpose: Revisar auth/u);
	assert.match(prompt, /When to use: Cambios de login/u);
	assert.match(prompt, /Safety rules: No aplicar automáticamente/u);
	assert.match(prompt, /Tests suggested: skill-check/u);
	assert.match(prompt, /Content preview:/u);
	assert.match(prompt, /name: security-auth-review/u);
});

test("request siempre incluye forbiddenActions obligatorias", () => {
	const result = createAgentLabReviewRequests({
		source: "manual",
		reportsPath: join(root(), "reports"),
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		manualObjective: "revisar seguridad",
		manualContext: "auth login",
		now,
	});
	const forbidden = result.requests[0]!.forbiddenActions.join("\n");
	assert.match(forbidden, /no modificar repo real/u);
	assert.match(forbidden, /no commit/u);
	assert.match(forbidden, /no push/u);
});

test("security/database fuerza requiresHumanApproval", () => {
	const security = createAgentLabReviewRequests({
		source: "postflight",
		reportsPath: join(root(), "reports"),
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		postflightReport: postflight(["src/auth/login.ts"]),
		now,
	});
	const database = createAgentLabReviewRequests({
		source: "postflight",
		reportsPath: join(root(), "reports"),
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		postflightReport: postflight(["src/db/schema.ts"]),
		now,
	});
	assert.ok(
		[...security.requests, ...database.requests]
			.filter(
				(request) =>
					request.specialty === "security" || request.specialty === "database",
			)
			.every((request) => request.requiresHumanApproval),
	);
});

test("review latest valida request", () => {
	const reportsPath = join(root(), "reports");
	createAgentLabReviewRequests({
		source: "manual",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		manualObjective: "revisar UI html components",
		manualContext: "UI html components",
		now,
	});
	const review = reviewAgentLabReviewRequest("latest", reportsPath);
	assert.equal(review.valid, true);
	assert.equal(review.plan?.requests[0]?.specialty, "ui_ux");
	assert.match(formatAgentLabReviewRequestReview(review), /Specialties/u);
});

test("review ruta legacy relativa busca en reports", () => {
	const reportsPath = join(root(), "reports");
	mkdirSync(reportsPath, { recursive: true });
	const created = createAgentLabReviewRequests({
		source: "manual",
		reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		manualObjective: "revisar UI html components",
		manualContext: "UI html components",
		now,
	});
	const legacyName = "agentlab-review-request-20260525-123456.json";
	writeFileSync(
		join(reportsPath, legacyName),
		readFileSync(created.path ?? "", "utf8"),
		"utf8",
	);
	const review = reviewAgentLabReviewRequest(legacyName, reportsPath);
	assert.equal(review.valid, true);
	assert.equal(review.plan?.requests[0]?.specialty, "ui_ux");
});

test("ruta fuera de reports falla", () => {
	const temp = root();
	const outside = join(temp, "agentlab-review-request-20260525-123456.json");
	writeFileSync(outside, "{}\n", "utf8");
	const review = reviewAgentLabReviewRequest(outside, join(temp, "reports"));
	assert.equal(review.valid, false);
	assert.match(review.errors.join("\n"), /agentlabs\/requests|reports legacy/u);
});

test("nombre inválido falla", () => {
	const reportsPath = join(root(), "reports");
	mkdirSync(reportsPath, { recursive: true });
	writeFileSync(join(reportsPath, "bad.json"), "{}\n", "utf8");
	const review = reviewAgentLabReviewRequest("bad.json", reportsPath);
	assert.equal(review.valid, false);
	assert.match(review.errors.join("\n"), /agentlab-review-request/u);
});

test("no modifica .agents ni .atl", () => {
	const temp = root();
	mkdirSync(join(temp, ".agents"));
	mkdirSync(join(temp, ".atl"));
	const result = createAgentLabReviewRequests({
		source: "manual",
		reportsPath: join(temp, "reports"),
		projectId: "pi-telegram-bridge",
		projectPath: temp,
		manualObjective: "revisar docs",
		manualContext: "docs",
		now,
	});
	assert.deepEqual(
		readFileSync(result.path!, "utf8").includes("Solicitud AgentLab"),
		true,
	);
	assert.ok(existsSync(join(temp, ".agents")));
	assert.ok(existsSync(join(temp, ".atl")));
});

test("format plan confirma que no ejecuta AgentLabs", () => {
	const plan = createAgentLabReviewRequests({
		source: "manual",
		reportsPath: join(root(), "reports"),
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		manualObjective: "revisar token cost context bloat",
		manualContext: "context bloat",
		now,
	});
	assert.match(formatAgentLabReviewRequestPlan(plan), /No ejecuté AgentLabs/u);
});

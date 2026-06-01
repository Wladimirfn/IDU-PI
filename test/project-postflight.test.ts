import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	createDefaultProjectCore,
	type ProjectCore,
} from "../src/project-core.js";
import type { ProjectConnectionReport } from "../src/project-connection.js";
import { deriveConstitutionFromProjectCore } from "../src/project-constitution.js";
import {
	analyzeProjectPostflight,
	formatProjectPostflightReport,
	readProjectPostflightGitState,
} from "../src/project-postflight.js";

function connection(
	overrides: Partial<ProjectConnectionReport> = {},
): ProjectConnectionReport {
	return {
		status: "ready",
		configStatus: "project_local_valid",
		alignmentStatus: "pending_scan",
		readiness: "config_ready",
		alignmentReason: ["no existe scan reciente"],
		projectId: "demo",
		projectPath: "/demo",
		problems: [],
		warnings: [],
		recommendedNext: "/idu_prepare",
		safeToOperate: true,
		needsUserConfirmation: false,
		inspectedAt: "2026-05-21T00:00:00.000Z",
		...overrides,
	};
}

function confirmedCore(overrides: Partial<ProjectCore> = {}): ProjectCore {
	return {
		...createDefaultProjectCore("Idu PI"),
		projectGoal: "Coordinar desarrollo seguro desde Telegram",
		problemStatement:
			"Las tareas técnicas pierden contexto y confirmación humana",
		targetUsers: ["Founder"],
		preferredStack: ["TypeScript", "SQLite"],
		rejectedStack: [],
		includedScope: ["Project Core", "Telegram bridge"],
		excludedScope: ["Billing"],
		successCriteria: ["Build and tests pass"],
		dataSensitivity: "high",
		openQuestions: [],
		status: "confirmed",
		...overrides,
	};
}

function reportFor(changedFiles: string[]) {
	return analyzeProjectPostflight({
		projectPath: "/demo",
		connectionReport: connection(),
		changedFiles,
		diffSummary: changedFiles.join("\n"),
	});
}

test("no changes is low risk", () => {
	const report = reportFor([]);

	assert.equal(report.risk, "low");
	assert.equal(report.observedChangeMode, "no-op");
	assert.equal(report.requiresHumanConfirmation, false);
	assert.deepEqual(report.changedFiles, []);
});

test("docs-only changes are low risk", () => {
	const report = reportFor(["README.md", "docs/usage.md"]);

	assert.equal(report.risk, "low");
	assert.equal(report.observedChangeMode, "docs");
	assert.deepEqual(report.impactedAreas, ["docs"]);
});

test("test-only changes are low risk", () => {
	const report = reportFor(["test/project-postflight.test.ts"]);

	assert.equal(report.risk, "low");
	assert.equal(report.observedChangeMode, "tests");
	assert.deepEqual(report.impactedAreas, ["tests"]);
});

test("lab-db and schema changes are high risk", () => {
	const report = reportFor(["src/lab-db.ts", "supabase/migrations/001.sql"]);

	assert.equal(report.risk, "high");
	assert.ok(report.impactedAreas.includes("DB/storage"));
	assert.equal(report.requiresHumanConfirmation, true);
});

test("auth login and env example changes are high risk", () => {
	const report = reportFor(["src/auth/login.ts", ".env.example"]);

	assert.equal(report.risk, "high");
	assert.ok(report.impactedAreas.includes("seguridad"));
});

test("permission patch JavaScript is security code", () => {
	const report = reportFor(["patch_permissions_server.js"]);

	assert.equal(report.risk, "high");
	assert.ok(report.impactedAreas.includes("code"));
	assert.ok(report.impactedAreas.includes("seguridad"));
	assert.deepEqual(report.impactedAreas.includes("docs"), false);
});

test("changed .env is blocker", () => {
	const report = reportFor([".env"]);

	assert.equal(report.risk, "blocker");
	assert.match(report.warnings.join("\n"), /\.env/u);
});

test("tracked runtime reports files are blocker", () => {
	const report = reportFor([
		"reports/lab.db",
		"reports/tasks.jsonl",
		"reports/runtime.sqlite",
	]);

	assert.equal(report.risk, "blocker");
	assert.equal(report.observedChangeMode, "stateRoot");
	assert.ok(report.impactedAreas.includes("runtime/tracked-artifacts"));
});

test("stateRoot governance artifacts stay low risk", () => {
	const report = reportFor([
		"C:/Users/elmas/Documents/bridge-agents/projects/idu-pi/master-plan.json",
	]);

	assert.equal(report.risk, "low");
	assert.equal(report.observedChangeMode, "stateRoot");
	assert.deepEqual(report.impactedAreas, ["stateRoot"]);
});

test("untracked subagent artifacts are ignored as functional changes", () => {
	const report = reportFor(["subagent-artifacts/review.md"]);

	assert.equal(report.risk, "low");
	assert.equal(report.observedChangeMode, "no-op");
	assert.deepEqual(report.changedFiles, []);
	assert.deepEqual(report.ignoredFiles, ["subagent-artifacts/review.md"]);
});

test("mixed code plus subagent artifacts keeps only functional files", () => {
	const report = reportFor([
		"src/project-postflight.ts",
		"subagent-artifacts/review.md",
	]);

	assert.equal(report.observedChangeMode, "code");
	assert.deepEqual(report.changedFiles, ["src/project-postflight.ts"]);
	assert.deepEqual(report.ignoredFiles, ["subagent-artifacts/review.md"]);
});

test("frontend files are classified as UI impact", () => {
	const report = reportFor(["src/components/Button.tsx", "app/page.css"]);

	assert.equal(report.risk, "medium");
	assert.ok(report.impactedAreas.includes("UI"));
});

test("index AgentRouter and lab changes are medium or high", () => {
	const report = reportFor([
		"src/index.ts",
		"src/agent-router.ts",
		"src/lab.ts",
	]);

	assert.equal(report.risk, "high");
	assert.ok(report.impactedAreas.includes("orquestación"));
	assert.equal(report.shouldRunAgentLab, true);
});

test("constitution gates detect auth/security changed files", () => {
	const report = analyzeProjectPostflight({
		projectPath: "/demo",
		connectionReport: connection(),
		changedFiles: ["src/auth/login.ts"],
		constitution: deriveConstitutionFromProjectCore(confirmedCore()),
	});

	assert.equal(report.risk, "high");
	assert.ok(
		report.constitutionGate?.failures.some(
			(gate) => gate.gateId === "auth_security_review",
		),
	);
	assert.match(formatProjectPostflightReport(report), /auth_security_review/u);
});

test("formatProjectPostflightReport renders high report", () => {
	const report = reportFor(["src/lab-db.ts", "src/index.ts"]);
	const text = formatProjectPostflightReport(report);

	assert.match(text, /Postflight Idu-pi/u);
	assert.match(text, /Riesgo:\nhigh/u);
	assert.match(text, /src\/lab-db\.ts/u);
	assert.match(text, /DB\/storage/u);
	assert.match(text, /orquestación/u);
});

test("readProjectPostflightGitState parses status without truncating names", () => {
	const state = readProjectPostflightGitState("/demo", (_command, args) => {
		const joined = args.join(" ");
		if (joined === "status --porcelain") {
			return "M README.md\nM package.json\n?? src/cli.ts";
		}
		if (joined === "diff --name-only") return "README.md\npackage.json";
		if (joined === "diff --stat") return " README.md | 1 +";
		return "";
	});

	assert.deepEqual(state.changedFiles, [
		"README.md",
		"package.json",
		"src/cli.ts",
	]);
});

test("analyzeProjectPostflight does not write files", () => {
	const dir = mkdtempSync(join(tmpdir(), "idu-postflight-"));
	try {
		const before = readdirSync(dir);
		analyzeProjectPostflight({
			projectPath: dir,
			connectionReport: connection({ projectPath: dir }),
			changedFiles: ["README.md"],
		});
		assert.deepEqual(readdirSync(dir), before);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

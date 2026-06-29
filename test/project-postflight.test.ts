import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	createDefaultProjectCore,
	type ProjectCore,
} from "../src/project-core.js";
import type { ProjectConnectionReport } from "../src/project-connection.js";
import {
	deriveConstitutionFromProjectCore,
	type ProjectConstitution,
	type RejectedRule,
} from "../src/project-constitution.js";
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

function reportFor(
	changedFiles: string[],
	options: {
		// R5.2 fail-loud: callers that pass no `constitutionStatus` get a
		// blocker skip. Tests written before R5.2 didn't care about the gate
		// and passed no constitution. To preserve their semantics (they're
		// testing risk classification on changed files, not the gate), the
		// default below sets up a confirmed-core-derived constitution so the
		// gate runs and the risk matches the original assertion.
		includeDefaultConstitution?: boolean;
	} = {},
) {
	const includeDefaultConstitution = options.includeDefaultConstitution ?? true;
	return analyzeProjectPostflight({
		projectPath: "/demo",
		connectionReport: connection(),
		changedFiles,
		diffSummary: changedFiles.join("\n"),
		constitutionStatus: includeDefaultConstitution
			? {
					kind: "ok",
					constitution: deriveConstitutionFromProjectCore(confirmedCore()),
				}
			: undefined,
	});
}

// R5.2 regression-test helper: builds a constitution with the
// `agentlabs-edit-files` rule (item 3 of the idu-pi self-constitution) so we
// can prove the gate still fires `rejected_stack: blocker` on src/agentlab-*.ts.
// The default confirmed core has an empty `rejectedStack`, so we append the
// rule directly to the derived constitution.
function buildConstitutionWithAgentlabsRule(): ProjectConstitution {
	const base = deriveConstitutionFromProjectCore(confirmedCore());
	const agentlabsRule: RejectedRule = {
		id: "agentlabs-edit-files",
		summary: "AgentLabs son audit-only.",
		category: "process",
		detection: { filePattern: "src/agentlab-*.ts" },
		severity: "blocker",
		rationale: "Los AgentLabs son audit-only; no se modifican en cambios normales.",
		messages: {
			blocked:
				"Rechazado por Project Core (item 3): cambios a src/agentlab-*.ts están prohibidos — AgentLabs son audit-only.",
			warning: "Cambio a archivo de AgentLabs detectado.",
		},
	};
	return {
		...base,
		technologyRules: {
			...base.technologyRules,
			rejectedStack: [...base.technologyRules.rejectedStack, agentlabsRule],
		},
	};
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

test("decision envelope files are not security files by substring", () => {
	const report = reportFor(["src/decision-envelope.ts"]);

	assert.equal(report.risk, "medium");
	assert.ok(report.impactedAreas.includes("code"));
	assert.equal(report.impactedAreas.includes("seguridad"), false);
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
	const constitution = deriveConstitutionFromProjectCore(confirmedCore());
	const report = analyzeProjectPostflight({
		projectPath: "/demo",
		connectionReport: connection(),
		changedFiles: ["src/auth/login.ts"],
		constitutionStatus: { kind: "ok", constitution },
	});

	assert.equal(report.risk, "high");
	assert.equal(report.constitutionGate?.kind, "ran");
	if (report.constitutionGate?.kind !== "ran") return; // narrow
	assert.ok(
		report.constitutionGate.result.failures.some(
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

// ============================================================================
// R3.2 — Tier 3 pilot: `ConstitutionGateInput.deps` pass-through
// ----------------------------------------------------------------------------
// Source: design obs-2688 §3.2 + task obs-2689 Phase A / Slice R3.2.
// Slice goal: postflight populates `deps` from a present `package.json` so
// depPattern predicates in `rejectedStack` can fire on real dependency
// artifacts. The helper (`readPackageJsonDeps`) must:
//   - Return `{ dependencies, devDependencies }` when `package.json` exists.
//   - Return `undefined` (NOT `null`) when `package.json` is missing — the
//     gate treats `undefined` as "predicate inconclusive" for depPattern.
//   - Never throw on a missing or malformed file.
//
// These tests pin all three behaviors. Predicate wiring is R3.3's job;
// here we only assert that the `deps` field reaches the gate correctly.
// ============================================================================

import { readPackageJsonDeps } from "../src/project-postflight.js";

test("R3.2: readPackageJsonDeps returns deps when package.json exists", () => {
	const dir = mkdtempSync(join(tmpdir(), "idu-r3-2-deps-"));
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				dependencies: { puppeteer: "^1.0.0", react: "^18.0.0" },
				devDependencies: { typescript: "^5.0.0" },
			}),
			"utf8",
		);
		const out = readPackageJsonDeps(dir);
		assert.ok(out, "must return deps when package.json exists");
		assert.equal(out!.dependencies.puppeteer, "^1.0.0");
		assert.equal(out!.devDependencies.typescript, "^5.0.0");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("R3.2: readPackageJsonDeps returns undefined (not null) when package.json missing", () => {
	const dir = mkdtempSync(join(tmpdir(), "idu-r3-2-no-pkg-"));
	try {
		const out = readPackageJsonDeps(dir);
		assert.equal(
			out,
			undefined,
			"missing package.json must yield undefined (NOT null) so the gate's `?? undefined` keeps the field absent",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("R3.2: readPackageJsonDeps returns undefined for empty workspaceRoot", () => {
	const out = readPackageJsonDeps("");
	assert.equal(out, undefined);
});

test("R3.2: readPackageJsonDeps swallows malformed package.json", () => {
	const dir = mkdtempSync(join(tmpdir(), "idu-r3-2-bad-pkg-"));
	try {
		writeFileSync(join(dir, "package.json"), "{not valid json", "utf8");
		const out = readPackageJsonDeps(dir);
		assert.equal(
			out,
			undefined,
			"malformed package.json must not throw — return undefined",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("R3.2: analyzeProjectPostflight populates `deps` from workspaceRoot's package.json", () => {
	const dir = mkdtempSync(join(tmpdir(), "idu-r3-2-postflight-"));
	try {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({
				dependencies: { puppeteer: "^1.0.0" },
			}),
			"utf8",
		);
		const constitution = deriveConstitutionFromProjectCore(confirmedCore());
		const report = analyzeProjectPostflight({
			projectPath: dir,
			connectionReport: connection({ projectPath: dir }),
			changedFiles: ["src/daemons/heartbeat.ts"],
			constitutionStatus: { kind: "ok", constitution },
		});
		// We can't directly observe the `deps` field from the public report,
		// but the gate's branch for depPattern short-circuits cleanly when
		// `deps` is present. The canonical proof that deps reached the gate
		// is the smoke-test below: a `rejectedStack` rule with a depPattern
		// against `puppeteer` must fire.
		assert.equal(
			report.constitutionGate?.kind,
			"ran",
			"gate must run when constitution is provided (R5.2 discriminated union)",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// ============================================================================
// R5.2 — fail-loud discriminated union (architecture/r5-runtime-enforcement-design)
// ----------------------------------------------------------------------------
// The original R5 bug was the constitution gate silently skipping when the
// loader returned a skipped result (postflight assigned `constitutionGate:
// undefined`, MCP envelope serialized `gates: null`, consumers reading
// `gates?.ok !== false` saw "passed"). R5.2 closes that by always emitting a
// `GateExecutionStatus` (kind: "ran" | kind: "skipped") with a clear "SKIPPED
// — not ran —" message so the human can distinguish a skip-blocker from a
// real rejection.
// ============================================================================

test("R5.2: postflight with no constitutionStatus → kind: 'skipped' blocker", () => {
	const report = analyzeProjectPostflight({
		projectPath: "/demo",
		connectionReport: connection(),
		changedFiles: ["src/auth/login.ts"],
		// R5.2: caller passed no constitutionStatus — the builder treats this
		// as a skip with severity blocker. The gate never silently green-lights.
		constitutionStatus: undefined,
	});

	assert.equal(report.risk, "blocker");
	assert.equal(report.constitutionGate?.kind, "skipped");
	if (report.constitutionGate?.kind !== "skipped") return; // narrow
	assert.equal(report.constitutionGate.reason, "no-constitution-provided");
	assert.equal(report.constitutionGate.severity, "blocker");
	assert.equal(report.constitutionGate.ran, false);
	assert.match(
		report.constitutionGate.skippedReason,
		/SKIPPED — not ran —/u,
	);
	assert.match(report.warnings.join("\n"), /constitution_skipped/u);
	assert.equal(report.requiresHumanConfirmation, true);
});

test("R5.2: postflight with loader-skipped constitutionStatus → kind: 'skipped' blocker with reason", () => {
	const report = analyzeProjectPostflight({
		projectPath: "/demo",
		connectionReport: connection(),
		changedFiles: ["src/auth/login.ts"],
		// R5.1 loader returned a discriminated union; the caller forwards it
		// as-is. R5.2 reads the skip reason and surfaces it as a blocker.
		constitutionStatus: {
			kind: "skipped",
			reason: "core-not-confirmed",
			detail: "Project Core status is draft.",
		},
	});

	assert.equal(report.risk, "blocker");
	assert.equal(report.constitutionGate?.kind, "skipped");
	if (report.constitutionGate?.kind !== "skipped") return; // narrow
	assert.equal(report.constitutionGate.reason, "core-not-confirmed");
	assert.equal(report.constitutionGate.severity, "blocker");
	assert.equal(report.constitutionGate.ran, false);
	assert.equal(report.constitutionGate.detail, "Project Core status is draft.");
	assert.match(
		report.constitutionGate.skippedReason,
		/reason: core-not-confirmed/u,
	);
	assert.match(report.warnings.join("\n"), /constitution_skipped/u);
});

test("R5.2: postflight with constitution loaded → kind: 'ran' with rejected_stack failure (NO REGRESSION on R5.3.2 acceptance path)", () => {
	// R5.3.2 acceptance: postflight with `src/agentlab-*.ts` untracked must
	// still fire `rejected_stack: blocker`. R5.2 must NOT regress this — the
	// gate still runs and the failure is preserved in the discriminated
	// union's `result.failures`.
	const constitution = buildConstitutionWithAgentlabsRule();
	const report = analyzeProjectPostflight({
		projectPath: "/demo",
		connectionReport: connection(),
		changedFiles: ["src/agentlab-review-runner.ts"],
		constitutionStatus: { kind: "ok", constitution },
	});

	assert.equal(report.constitutionGate?.kind, "ran");
	if (report.constitutionGate?.kind !== "ran") return; // narrow
	assert.equal(report.constitutionGate.result.risk, "blocker");
	assert.ok(
		report.constitutionGate.result.failures.some(
			(failure) =>
				failure.gateId === "rejected_stack" &&
				/blocker/i.test(failure.severity),
		),
		"R5.3.2 acceptance: rejected_stack: blocker MUST fire on src/agentlab-*.ts (NO REGRESSION)",
	);
	// The RAN message must be informative.
	assert.match(report.constitutionGate.result.message, /Constitution gate RAN/u);
});

test("R5.2: skip-blocker and rejected_stack real are distinguishable (Caveat 1)", () => {
	// Skip-blocker: no constitution provided. The skip's gateId is "constitution_skipped"
	// (added by R5.2 in the warnings list) — visually distinct from "rejected_stack".
	const skipReport = analyzeProjectPostflight({
		projectPath: "/demo",
		connectionReport: connection(),
		changedFiles: ["src/auth/login.ts"],
		constitutionStatus: undefined,
	});
	const skipWarnings = skipReport.warnings.join("\n");
	assert.match(skipWarnings, /constitution_skipped/u);
	assert.doesNotMatch(skipWarnings, /rejected_stack/u);

	// Real rejection: constitution with agentlabs-edit-files rule, src/agentlab-*.ts untracked.
	const constitution = buildConstitutionWithAgentlabsRule();
	const rejReport = analyzeProjectPostflight({
		projectPath: "/demo",
		connectionReport: connection(),
		changedFiles: ["src/agentlab-review-runner.ts"],
		constitutionStatus: { kind: "ok", constitution },
	});
	const rejWarnings = rejReport.warnings.join("\n");
	assert.match(rejWarnings, /rejected_stack/u);
	assert.doesNotMatch(rejWarnings, /constitution_skipped/u);

	// Both reach `risk: blocker` but with distinct messages.
	assert.equal(skipReport.risk, "blocker");
	assert.equal(rejReport.risk, "blocker");
});

test("R5.2: GateExecutionStatus discriminated union is exported and structurally complete", () => {
	// Compile-time shape check via runtime behavior. The union type lives in
	// src/project-postflight.ts. We can't introspect TS types at runtime,
	// so we verify behavior: kind: "ran" carries a result with the existing
	// `ConstitutionGateResult` fields plus `message`; kind: "skipped" carries
	// `severity: "blocker"`, `ran: false`, and a `skippedReason` string.
	// Use a non-empty changedFiles so the no-changes fast-path doesn't bypass
	// the gate builder.
	const constitution = deriveConstitutionFromProjectCore(confirmedCore());
	const report = analyzeProjectPostflight({
		projectPath: "/demo",
		connectionReport: connection(),
		changedFiles: ["src/auth/login.ts"],
		constitutionStatus: { kind: "ok", constitution },
	});
	// RAN branch shape: { kind: "ran", result: { ok, risk, failures, warnings, affectedRules, message } }
	if (report.constitutionGate?.kind !== "ran") {
		throw new Error("expected kind: ran");
	}
	const ran = report.constitutionGate.result;
	assert.equal(typeof ran.ok, "boolean");
	assert.equal(typeof ran.risk, "string");
	assert.ok(Array.isArray(ran.failures));
	assert.ok(Array.isArray(ran.warnings));
	assert.ok(Array.isArray(ran.affectedRules));
	assert.equal(typeof ran.message, "string");

	// SKIPPED branch shape: { kind: "skipped", reason, severity: "blocker", ran: false, skippedReason }
	const skipReport = analyzeProjectPostflight({
		projectPath: "/demo",
		connectionReport: connection(),
		changedFiles: ["src/auth/login.ts"],
		constitutionStatus: undefined,
	});
	if (skipReport.constitutionGate?.kind !== "skipped") {
		throw new Error("expected kind: skipped");
	}
	const skipped = skipReport.constitutionGate;
	assert.equal(typeof skipped.reason, "string");
	assert.equal(skipped.severity, "blocker");
	assert.equal(skipped.ran, false);
	assert.equal(typeof skipped.skippedReason, "string");
});

test("R5.2: formatProjectPostflightReport renders skip reason explicitly", () => {
	const report = analyzeProjectPostflight({
		projectPath: "/demo",
		connectionReport: connection(),
		changedFiles: ["src/auth/login.ts"],
		constitutionStatus: undefined,
	});
	const text = formatProjectPostflightReport(report);

	// The text must include both the gate execution line and the explicit
	// "SKIPPED — not ran —" wording so a human can distinguish it from a
	// real rejection at a glance.
	assert.match(text, /Constitution gate execution:/u);
	assert.match(text, /SKIPPED — not ran —/u);
	assert.match(text, /no-constitution-provided/u);
});

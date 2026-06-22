import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	handleBirthStatus,
	handleBirthExistingScan,
	handleBirthBibliotecarioDiscovery,
	handleBirthValidate,
	handleBirthRepoPlan,
} from "../src/birth-runtime.js";
import { writeBirthArtifact } from "../src/birth-artifacts.js";

function makeProject(): {
	projectPath: string;
	stateRoot: string;
	cleanup: () => void;
} {
	const root = mkdtempSync(join(tmpdir(), "idu-birth-runtime-"));
	const projectPath = join(root, "project");
	const stateRoot = join(root, "state");
	mkdirSync(projectPath, { recursive: true });
	mkdirSync(stateRoot, { recursive: true });
	mkdirSync(join(projectPath, "src"), { recursive: true });
	mkdirSync(join(projectPath, "test"), { recursive: true });
	writeFileSync(
		join(projectPath, "package.json"),
		JSON.stringify({
			name: "demo",
			scripts: { test: "node --test" },
			dependencies: { typescript: "*" },
		}),
		"utf8",
	);
	writeFileSync(join(projectPath, "pnpm-lock.yaml"), "lockfileVersion: 5.4\n", "utf8");
	writeFileSync(join(projectPath, "src", "index.ts"), "export const a = 1;\n", "utf8");
	writeFileSync(join(projectPath, "test", "a.test.ts"), "test('x', () => {});\n", "utf8");
	return { projectPath, stateRoot, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("handleBirthStatus returns envelope with state not_started and allowedToImplement=false", () => {
	const ctx = makeProject();
	try {
		const result = handleBirthStatus({
			projectId: "demo",
			stateRoot: ctx.stateRoot,
		});
		assert.equal(result.kind, "birth_status");
		assert.equal(result.allowedToImplement, false);
		assert.equal(result.repoWritesAllowed, false);
		assert.ok(result.blockingReasons.length > 0);
	} finally {
		ctx.cleanup();
	}
});

test("handleBirthExistingScan writes birth/existing-scan.json and birth/detected-specs.json", () => {
	const ctx = makeProject();
	try {
		const result = handleBirthExistingScan({
			projectId: "demo",
			stateRoot: ctx.stateRoot,
			projectPath: ctx.projectPath,
		});
		assert.equal(result.kind, "birth_existing_scan");
		assert.equal(result.scan.observed.packageManager, "pnpm");
		assert.equal(result.detectedSpecs.status, "draft");
	} finally {
		ctx.cleanup();
	}
});

test("handleBirthBibliotecarioDiscovery returns status and next action", () => {
	const ctx = makeProject();
	try {
		const result = handleBirthBibliotecarioDiscovery({
			projectId: "demo",
			stateRoot: ctx.stateRoot,
			localSourceRefs: [{ path: "README.md", quality: "primary" }],
			requestedExternalCategories: [],
			externalPermission: "not_requested",
			masterPlanSummary: "Living project loop.",
		});
		assert.equal(result.kind, "birth_bibliotecario_discovery");
		assert.equal(result.discovery.status, "local_sources_found");
		assert.equal(result.discovery.nextRequiredAction, "idu_birth_bibliotecario_discovery");
	} finally {
		ctx.cleanup();
	}
});

test("handleBirthValidate runs all birth validators and aggregates missing", () => {
	const ctx = makeProject();
	try {
		const result = handleBirthValidate({
			projectId: "demo",
			stateRoot: ctx.stateRoot,
			projectPath: ctx.projectPath,
		});
		assert.equal(result.kind, "birth_validate");
		assert.equal(result.scan.observed.packageManager, "pnpm");
		assert.ok(result.bibliotecario.discovery.status);
		assert.ok(result.readiness);
	} finally {
		ctx.cleanup();
	}
});

test("handleBirthRepoPlan blocks repoWritesAllowed without human approval", () => {
	const ctx = makeProject();
	try {
		const result = handleBirthRepoPlan({
			projectId: "demo",
			stateRoot: ctx.stateRoot,
			repoPlan: {
				repoName: "demo",
				visibility: "private",
				owner: "elmas",
				license: "MIT",
				initialReadmePolicy: "minimal",
				remoteProvider: "github",
				pushApproved: false,
				branchPolicy: "main",
				ciExpectation: "pnpm test",
			},
		});
		assert.equal(result.kind, "birth_repo_plan");
		assert.equal(result.decision.repoWritesAllowed, false);
		assert.ok(result.decision.blockingReasons.some((r) => /push/i.test(r)));
	} finally {
		ctx.cleanup();
	}
});

test("handleBirthRepoPlan grants repoWritesAllowed only when push is approved AND birth permits", () => {
	const ctx = makeProject();
	try {
		writeBirthArtifact(ctx.stateRoot, "status", { state: "implementation_ready" });
		const result = handleBirthRepoPlan({
			projectId: "demo",
			stateRoot: ctx.stateRoot,
			repoPlan: {
				repoName: "demo",
				visibility: "private",
				owner: "elmas",
				license: "MIT",
				initialReadmePolicy: "minimal",
				remoteProvider: "github",
				pushApproved: true,
				branchPolicy: "main",
				ciExpectation: "pnpm test",
			},
		});
		assert.equal(result.kind, "birth_repo_plan");
		// The runtime guard keeps repoWritesAllowed=false unless the readiness envelope says repo_ready.
		assert.equal(result.decision.repoWritesAllowed, false);
		assert.ok(result.decision.blockingReasons.length > 0);
	} finally {
		ctx.cleanup();
	}
});

// =========================================================================
// REGRESSION: Project Core path-mismatch bug (Item-3a migration gap)
//
// loadProjectCoreSnapshot (src/birth-runtime.ts:235) used to look at
// `<stateRoot>/config/project-core.json` (Layout B legacy) instead of
// `<stateRoot>/.idu/config/project-core.json` (Layout A canonical, per
// territory model). File at Layout A → loader returns undefined →
// `core?.status ?? "missing"` falls through → gate mints "current=missing"
// even when project-core.json has `status: "confirmed"`.
//
// The canonical loader `loadProjectCore` (src/project-core.ts:122) uses
// `readIdPathWithMigration` which prefers Layout A and one-time renames
// the legacy Layout B to A on first read. The fix routes
// `loadProjectCoreSnapshot` through that API.
// =========================================================================

test("F-Item3a RED→GREEN: handleBirthStatus reports coreStatus=confirmed when .idu/config/project-core.json has status=confirmed (Layout A)", () => {
	const ctx = makeProject();
	try {
		// Layout A: <stateRoot>/.idu/config/project-core.json (canonical)
		mkdirSync(join(ctx.stateRoot, ".idu", "config"), { recursive: true });
		writeFileSync(
			join(ctx.stateRoot, ".idu", "config", "project-core.json"),
			`${JSON.stringify({
				version: "1.0.0",
				projectName: "demo",
				projectGoal: "Demo project for birth regression test.",
				problemStatement: "Stub.",
				targetUsers: ["orchestrator"],
				projectType: "demo",
				complexityLevel: "small",
				deploymentTarget: "local",
				securityLevel: "low",
				dataSensitivity: "none",
				preferredStack: ["TypeScript"],
				rejectedStack: [],
				architectureStyle: "monolith",
				includedScope: ["demo"],
				excludedScope: [],
				initialModules: ["demo"],
				criticalFlows: ["demo"],
				successCriteria: ["demo runs"],
				validationCommands: ["pnpm test"],
				humanDecisions: [
					"Human approval is required before confirming this Project Core.",
				],
				assumptions: [],
				openQuestions: [],
				status: "confirmed",
				createdAt: "2026-06-22T00:00:00.000Z",
				updatedAt: "2026-06-22T00:00:00.000Z",
			})}\n`,
			"utf8",
		);
		const result = handleBirthStatus({
			projectId: "demo",
			stateRoot: ctx.stateRoot,
		});
		// Pre-fix: blockingReasons includes "Project Core must be confirmed; current=missing."
		// Post-fix: that reason must NOT be present (core is confirmed at Layout A).
		const missingReason = result.blockingReasons.find((r) =>
			/Project Core must be confirmed; current=missing\./u.test(r),
		);
		assert.equal(
			missingReason,
			undefined,
			`handleBirthStatus should NOT report coreStatus=missing when .idu/config/project-core.json has status=confirmed. Got blockingReasons: ${JSON.stringify(result.blockingReasons)}`,
		);
	} finally {
		ctx.cleanup();
	}
});

test("F-Item3a RED→GREEN: handleBirthRepoPlan unblocks when .idu/config/project-core.json has status=confirmed (Layout A)", () => {
	const ctx = makeProject();
	try {
		// Layout A: <stateRoot>/.idu/config/project-core.json (canonical)
		mkdirSync(join(ctx.stateRoot, ".idu", "config"), { recursive: true });
		writeFileSync(
			join(ctx.stateRoot, ".idu", "config", "project-core.json"),
			`${JSON.stringify({
				version: "1.0.0",
				projectName: "demo",
				projectGoal: "Demo project for birth regression test.",
				problemStatement: "Stub.",
				targetUsers: ["orchestrator"],
				projectType: "demo",
				complexityLevel: "small",
				deploymentTarget: "local",
				securityLevel: "low",
				dataSensitivity: "none",
				preferredStack: ["TypeScript"],
				rejectedStack: [],
				architectureStyle: "monolith",
				includedScope: ["demo"],
				excludedScope: [],
				initialModules: ["demo"],
				criticalFlows: ["demo"],
				successCriteria: ["demo runs"],
				validationCommands: ["pnpm test"],
				humanDecisions: [
					"Human approval is required before confirming this Project Core.",
				],
				assumptions: [],
				openQuestions: [],
				status: "confirmed",
				createdAt: "2026-06-22T00:00:00.000Z",
				updatedAt: "2026-06-22T00:00:00.000Z",
			})}\n`,
			"utf8",
		);
		const result = handleBirthRepoPlan({
			projectId: "demo",
			stateRoot: ctx.stateRoot,
			repoPlan: {
				repoName: "demo",
				visibility: "private",
				owner: "elmas",
				license: "MIT",
				initialReadmePolicy: "minimal",
				remoteProvider: "github",
				pushApproved: true,
				branchPolicy: "main",
				ciExpectation: "pnpm test",
			},
		});
		// Pre-fix: blockingReasons includes "Project Core must be confirmed before repo plan; current=missing."
		const missingReason = result.decision.blockingReasons.find((r) =>
			/Project Core must be confirmed before repo plan; current=missing\./u.test(r),
		);
		assert.equal(
			missingReason,
			undefined,
			`handleBirthRepoPlan should NOT report coreStatus=missing when .idu/config/project-core.json has status=confirmed. Got blockingReasons: ${JSON.stringify(result.decision.blockingReasons)}`,
		);
	} finally {
		ctx.cleanup();
	}
});


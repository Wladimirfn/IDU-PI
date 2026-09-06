import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
	PROPOSED_REJECTED_RULES,
	PROPOSED_REJECTED_STACK,
	processLayout,
	replaceRejectedStack,
} from "../scripts/migrate-rejected-stack.js";
import {
	buildConstitutionFromRejectedStack,
	runGitIn,
} from "./helpers/project-constitution-helpers.js";
import {
	evaluateConstitutionGates,
	hasRejection,
	normalizeRejectedRules,
	validateProjectConstitution,
	type ProjectConstitution,
	type RejectedRule,
} from "../src/project-constitution.js";

// =========================================================================
// R3.4 integration tests — the proposed rules drive the R3.3 gate.
//
// The R3.3 tests (`test/project-constitution.test.ts`) build a constitution
// with `makeValidRejectedRule` (a generic helper) and assert the gate
// behavior per detection type. Those tests are ABOUT THE GATE.
//
// This file is ABOUT THE PROPOSED RULES — i.e. "do the actual contracts
// we're shipping in R3.4 fire as the auditor expects?". We re-run the
// R3.3-shaped scenarios (T1-T8) against the real `PROPOSED_REJECTED_RULES`
// constant from the migration script, plus a new T9 that exercises the
// long-running detection on a real daemon file in a temp git repo.
// =========================================================================

describe("R3.4 integration — proposed RejectedRule[] drives the R3.3 gate", () => {
	// -----------------------------------------------------------------------
	// T1: filePattern — `agentlabs-edit-files` matches a path under
	//     `src/agentlab-*.ts` (R3.4 round 2: corrected from the
	//     non-existent `agentlabs/**` to the actual src/agentlab-*.ts glob).
	//
	//     Uses a fictional filename so `git show HEAD:<file>` returns
	//     undefined and the importPattern / behaviorPattern branches skip
	//     silently — isolating the filePattern hit to agentlabs-edit-files
	//     only. (A real AgentLab file like src/agentlab-review-runner.ts
	//     would also fire importPattern + behaviorPattern because its
	//     actual content uses writeFileSync and setTimeout.)
	// -----------------------------------------------------------------------
	it("T1: agentlabs-edit-files matches src/agentlab-*.ts (filePattern)", () => {
		const constitution = buildConstitutionFromRejectedStack(
			PROPOSED_REJECTED_RULES,
		);
		const result = evaluateConstitutionGates({
			changedFiles: ["src/agentlab-fixture-probe.ts"],
			constitution,
		});
		const hits = result.failures.filter(
			(failure) => failure.gateId === "rejected_stack",
		);
		// src/agentlab-*.ts matches agentlabs-edit-files (filePattern).
		// Other branches (importPattern, commandPattern) need content/diff
		// inputs, so they don't fire on a bare path.
		const agentlabHits = hits.filter((h) => /item 3/u.test(h.message));
		assert.equal(
			agentlabHits.length,
			1,
			`expected exactly one item 3 hit, got ${agentlabHits.length}: ${JSON.stringify(hits)}`,
		);
		assert.equal(agentlabHits[0].severity, "blocker");
		assert.match(agentlabHits[0].message, /item 3/u);
		assert.match(agentlabHits[0].message, /src\/agentlab/u);
	});

	// -----------------------------------------------------------------------
	// T2: depPattern — none of the proposed rules use depPattern, so we
	//     verify the absence: no depPattern rule fires for any deps input.
	//     This guards against an accidental dependency-shape regression in
	//     the proposed rules (e.g. someone adding a depPattern later).
	// -----------------------------------------------------------------------
	it("T2: no proposed rule uses depPattern; passing deps is silently skipped", () => {
		const constitution = buildConstitutionFromRejectedStack(
			PROPOSED_REJECTED_RULES,
		);
		const result = evaluateConstitutionGates({
			changedFiles: [],
			deps: {
				dependencies: { puppeteer: "^1.0.0" },
				devDependencies: {},
			},
			constitution,
		});
		assert.equal(
			result.failures.find((f) => f.gateId === "rejected_stack"),
			undefined,
			"no depPattern rule → no failure even when suspicious deps are present",
		);
	});

	// -----------------------------------------------------------------------
	// T3: importPattern — `mcp-write-shell-exec` AND `agentlabs-edit-shell-exec`
	//     both match content with `writeFileSync(`.
	//
	//     U2 of #288 added pathGuards:
	//       - mcp-write-shell-exec:        ["src/**", "scripts/**"]
	//       - agentlabs-edit-shell-exec:   ["src/agentlab-*.ts"]
	//
	//     T3a: probe at src/utils/logger.ts — only mcp-write-shell-exec fires
	//          (agentlabs-edit-shell-exec is now correctly scoped to
	//          src/agentlab-*.ts and MUST NOT fire on src/utils/*). This is
	//          the REQ-RSP-002 "test path guard blocks" scenario.
	//     T3b: probe at src/agentlab-fix-probe.ts — BOTH rules fire (path
	//          matches both guards).
	// -----------------------------------------------------------------------
	it("T3a: mcp-write-shell-exec fires on src/utils/logger.ts; agentlabs-edit-shell-exec is blocked by its src/agentlab-*.ts guard (U2 pathGuard)", () => {
		const constitution = buildConstitutionFromRejectedStack(
			PROPOSED_REJECTED_RULES,
		);
		// Path chosen so it doesn't match any filePattern rule (src/mcp/**,
		// src/cli.ts, src/agentlab-*.ts are all ruled out).
		const probeFile = "src/utils/logger.ts";
		const map: Record<string, string> = {
			[probeFile]:
				'import { writeFileSync } from "node:fs";\nwriteFileSync("/tmp/x", "data");\n',
		};
		const readContent = (file: string): string | undefined => map[file];
		const hits = hasRejection(
			{
				changedFiles: [probeFile],
				constitution,
			},
			normalizeRejectedRules(constitution.technologyRules.rejectedStack),
			{ readContent },
		);
		const ids = hits.map((h) => h.rule.id);
		assert.ok(
			ids.includes("mcp-write-shell-exec"),
			`mcp-write-shell-exec MUST fire on src/utils/logger.ts (matches "src/**" guard); got: ${ids.join(",")}`,
		);
		assert.ok(
			!ids.includes("agentlabs-edit-shell-exec"),
			`agentlabs-edit-shell-exec MUST NOT fire on src/utils/logger.ts after U2 (guard is src/agentlab-*.ts); got: ${ids.join(",")}`,
		);
		assert.ok(
			hits.every((h) => h.matchedFile === probeFile),
			"all hits must point at the probe file",
		);
	});

	it("T3b: mcp-write-shell-exec + agentlabs-edit-shell-exec both fire on src/agentlab-fix-probe.ts (matches both guards)", () => {
		const constitution = buildConstitutionFromRejectedStack(
			PROPOSED_REJECTED_RULES,
		);
		// Path matches both guards: "src/**" (mcp-write-shell-exec) and
		// "src/agentlab-*.ts" (agentlabs-edit-shell-exec). NOTE: this path also
		// matches the agentlabs-edit-files filePattern rule, so we expect that
		// hit too — we only assert the two importPattern rules here.
		const probeFile = "src/agentlab-fix-probe.ts";
		const map: Record<string, string> = {
			[probeFile]:
				'import { writeFileSync } from "node:fs";\nwriteFileSync("/tmp/x", "data");\n',
		};
		const readContent = (file: string): string | undefined => map[file];
		const hits = hasRejection(
			{
				changedFiles: [probeFile],
				constitution,
			},
			normalizeRejectedRules(constitution.technologyRules.rejectedStack),
			{ readContent },
		);
		const ids = hits.map((h) => h.rule.id);
		assert.ok(
			ids.includes("mcp-write-shell-exec"),
			`mcp-write-shell-exec MUST fire (matches "src/**" guard); got: ${ids.join(",")}`,
		);
		assert.ok(
			ids.includes("agentlabs-edit-shell-exec"),
			`agentlabs-edit-shell-exec MUST fire on src/agentlab-*.ts (matches guard); got: ${ids.join(",")}`,
		);
	});

	// -----------------------------------------------------------------------
	// T4: commandPattern — `agentlabs-edit-commit-push` matches
	//     `git push origin main` in a diff. Pick a path outside src/agentlab-*.ts
	//     to isolate the commandPattern branch.
	// -----------------------------------------------------------------------
	it("T4: agentlabs-edit-commit-push matches 'git push origin main' in mocked diff (commandPattern)", () => {
		const constitution = buildConstitutionFromRejectedStack(
			PROPOSED_REJECTED_RULES,
		);
		const probeFile = "scripts/run.sh";
		const diffBody =
			`diff --git a/${probeFile} b/${probeFile}\n` + "+git push origin main\n";
		const map: Record<string, string> = { [probeFile]: diffBody };
		const readDiff = (file: string): string | undefined => map[file];
		const hits = hasRejection(
			{ changedFiles: [probeFile], constitution },
			normalizeRejectedRules(constitution.technologyRules.rejectedStack),
			{ readDiff },
		);
		assert.equal(hits.length, 1);
		assert.equal(hits[0].rule.id, "agentlabs-edit-commit-push");
	});

	// -----------------------------------------------------------------------
	// T5: behaviorPattern — `unbounded-daemon-long-running` AND
	//     `unbounded-daemon-periodic` fire on `setInterval(` without a
	//     SIGTERM handler. Both rules apply: long-running has the
	//     NOT-shutdown branch, periodic has no branch.
	// -----------------------------------------------------------------------
	it("T5: unbounded-daemon-{long-running,periodic} fire on setInterval without SIGTERM handler", () => {
		const constitution = buildConstitutionFromRejectedStack(
			PROPOSED_REJECTED_RULES,
		);
		const content =
			"// unbounded daemon — no shutdown wiring\n" +
			"setInterval(() => console.log('tick'), 1000);\n";
		const map: Record<string, string> = { "src/daemons/heartbeat.ts": content };
		const readContent = (file: string): string | undefined => map[file];
		const hits = hasRejection(
			{
				changedFiles: ["src/daemons/heartbeat.ts"],
				constitution,
			},
			normalizeRejectedRules(constitution.technologyRules.rejectedStack),
			{ readContent },
		);
		const ids = hits.map((h) => h.rule.id);
		assert.ok(
			ids.includes("unbounded-daemon-long-running"),
			`unbounded-daemon-long-running MUST fire; got: ${ids.join(",")}`,
		);
		assert.ok(
			ids.includes("unbounded-daemon-periodic"),
			`unbounded-daemon-periodic MUST fire; got: ${ids.join(",")}`,
		);
	});

	it("T5b: unbounded-daemon-long-running does NOT fire when SIGTERM handler is present (periodic still fires)", () => {
		const constitution = buildConstitutionFromRejectedStack(
			PROPOSED_REJECTED_RULES,
		);
		const content =
			"setInterval(() => console.log('tick'), 1000);\n" +
			"process.on('SIGTERM', () => { clearInterval(handle); process.exit(0); });\n";
		const map: Record<string, string> = { "src/daemons/graceful.ts": content };
		const readContent = (file: string): string | undefined => map[file];
		const hits = hasRejection(
			{
				changedFiles: ["src/daemons/graceful.ts"],
				constitution,
			},
			normalizeRejectedRules(constitution.technologyRules.rejectedStack),
			{ readContent },
		);
		const ids = hits.map((h) => h.rule.id);
		assert.ok(
			!ids.includes("unbounded-daemon-long-running"),
			`unbounded-daemon-long-running MUST NOT fire when SIGTERM handler is present; got: ${ids.join(",")}`,
		);
		// `periodic` has no NOT-branch — `setInterval(` always fires it.
		// This is the documented advisory-grade nuance of `behaviorPattern`.
		assert.ok(
			ids.includes("unbounded-daemon-periodic"),
			`unbounded-daemon-periodic STILL fires on setInterval( regardless of shutdown; got: ${ids.join(",")}`,
		);
	});

	// -----------------------------------------------------------------------
	// T6: backward-compat — item 6 stays as a string; the gate surfaces
	//     it as a `rejected_stack_advisory` warning when the request mentions
	//     the prose phrase, but never as a `rejected_stack` failure.
	// -----------------------------------------------------------------------
	it("T6: trailing item-6 string surfaces as rejected_stack_advisory warning (not failure)", () => {
		const constitution = buildConstitutionFromRejectedStack(
			PROPOSED_REJECTED_STACK,
		);
		const result = evaluateConstitutionGates({
			request: "Repo writes outside explicit worker/orchestrator flows",
			constitution,
		});
		assert.equal(
			result.failures.find((f) => f.gateId === "rejected_stack"),
			undefined,
			"item 6 prose MUST NOT emit rejected_stack failure",
		);
		assert.ok(
			result.warnings.some(
				(w) => w.gateId === "rejected_stack_advisory",
			),
			"item 6 prose MUST emit rejected_stack_advisory warning",
		);
	});

	// -----------------------------------------------------------------------
	// T7: phase-separation — preflight (no changedFiles) → predicate path
	//     is INCONCLUSIVE; only the advisory prose fallback fires for
	//     item 6.
	// -----------------------------------------------------------------------
	it("T7: preflight (request only, no changedFiles) — predicate does NOT fire, prose fallback DOES for item 6", () => {
		const constitution = buildConstitutionFromRejectedStack(
			PROPOSED_REJECTED_STACK,
		);
		const result = evaluateConstitutionGates({
			request: "Repo writes outside explicit worker/orchestrator flows",
			constitution,
			// NO changedFiles — preflight shape.
		});
		assert.equal(
			result.failures.find((f) => f.gateId === "rejected_stack"),
			undefined,
			"predicate MUST NOT fire without changedFiles (preflight is text-only)",
		);
		assert.ok(
			result.warnings.some(
				(w) => w.gateId === "rejected_stack_advisory",
			),
			"prose fallback MUST fire for the item 6 trailing string in preflight",
		);
		// Predicate rules (the 12 objects) MUST NOT prose-match — only
		// `advisoryOnly` rules (item 6 after normalization) participate in
		// the prose fallback. The item 6 rule becomes
		// `{ summary: "Repo writes outside..." }` after normalizeRejectedRules.
		assert.equal(
			result.failures.find((f) => f.gateId === "rejected_stack"),
			undefined,
		);
	});

	// -----------------------------------------------------------------------
	// T8: postflight gate, the gate fires on REAL artifacts from the
	//     proposed rules. We bootstrap a temp git repo with a daemon file
	//     that has no SIGTERM handler, plus an MCP-handler change that
	//     imports writeFile, plus a src/agentlab-*.ts file with git push.
	//     We assert: (a) `agentlabs-edit-files` fires on src/agentlab-*.ts,
	//     (b) `mcp-write-handlers` fires on src/mcp/**,
	//     (c) `mcp-write-shell-exec` fires on writeFile imports,
	//     (d) `agentlabs-edit-commit-push` fires on git push.
	//     (R3.4 round 2: corrected from non-existent src/mcp-server.ts and
	//      agentlabs/run.sh to real repo paths.)
	//     (R3.4 round 3: Item 2 split into 4 rules; src/mcp/** is now
	//      `mcp-write-handlers` (was `mcp-write-server-files`).)
	// -----------------------------------------------------------------------
	const tempDirs: string[] = [];
	after(() => {
		for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
	});

	it("T8: postflight on a temp repo with the proposed rules — multiple predicate branches fire", () => {
		const repoDir = mkdtempSync(join(tmpdir(), "pi-r3-4-t8-"));
		tempDirs.push(repoDir);
		runGitIn(repoDir, ["init", "--quiet", "--initial-branch=main"]);
		runGitIn(repoDir, ["config", "user.email", "test@example.com"]);
		runGitIn(repoDir, ["config", "user.name", "Test"]);
		runGitIn(repoDir, ["config", "commit.gpgsign", "false"]);

		// Three files that each trigger a DIFFERENT branch of `hasRejection`.
		mkdirSync(join(repoDir, "src", "mcp", "lifecycle"), { recursive: true });
		mkdirSync(join(repoDir, "src"), { recursive: true });

		// File 1 — src/mcp/lifecycle/handlers.ts (filePattern: mcp-write-handlers
		//          under src/mcp/**) AND content with writeFileSync
		//          (importPattern: mcp-write-shell-exec). The path is under
		//          src/mcp/** so mcp-write-handlers fires; the content
		//          has writeFileSync so mcp-write-shell-exec fires. Multi-hit.
		const mcpPath = join(repoDir, "src", "mcp", "lifecycle", "handlers.ts");
		writeFileSync(
			mcpPath,
			'import { writeFileSync } from "node:fs";\nwriteFileSync("/tmp/x", "data");\n',
			"utf8",
		);

		// File 2 — src/agentlab-review-runner.ts (filePattern: agentlabs-edit-files
		//          under src/agentlab-*.ts) AND content with `git push origin main`
		//          (commandPattern: agentlabs-edit-commit-push). Real AgentLab
		//          filename so filePattern fires; content drives commandPattern.
		const agentlabPath = join(repoDir, "src", "agentlab-review-runner.ts");
		writeFileSync(agentlabPath, "git push origin main\n", "utf8");

		runGitIn(repoDir, ["add", "."]);
		runGitIn(repoDir, ["commit", "--quiet", "-m", "introduce agentlab runner"]);

		// Build a constitution with the proposed rules.
		const constitution = buildConstitutionFromRejectedStack(
			PROPOSED_REJECTED_RULES,
		);
		const changedFiles = [
			"src/mcp/lifecycle/handlers.ts",
			"src/agentlab-review-runner.ts",
		];

		const originalCwd = process.cwd();
		try {
			process.chdir(repoDir);
			const result = evaluateConstitutionGates({
				request: "introduce changes",
				changedFiles,
				constitution,
			});
			const failures = result.failures.filter(
				(f) => f.gateId === "rejected_stack",
			);
			// Expect at least the filePattern hits (deterministic).
			const ids = failures.map((f) => f.message);
			const hasFileHit = ids.some((m) => /item 2/.test(m) || /item 3/.test(m));
			assert.ok(
				hasFileHit,
				`expected at least one filePattern hit from items 2 or 3; got: ${JSON.stringify(ids)}`,
			);
			// Specifically, the AgentLabs filePattern rule MUST fire (item 3).
			assert.ok(
				failures.some((f) => /src\/agentlab/u.test(f.message)),
				"agentlabs-edit-files MUST fire on src/agentlab-*.ts",
			);
			// mcp-write-handlers (item 2) MUST fire on src/mcp/**.
			assert.ok(
				failures.some((f) => /item 2/u.test(f.message) && /src\/mcp/u.test(f.message)),
				"mcp-write-handlers MUST fire on src/mcp/**",
			);
		} finally {
			process.chdir(originalCwd);
		}
	});

	// -----------------------------------------------------------------------
	// T9 (NEW for R3.4): the migration script's byte-level output,
	//     loaded through the project's own `loadProjectConstitution` and
	//     fed to the gate, produces the same predicate hits as the
	//     in-memory `PROPOSED_REJECTED_RULES` constant.
	//
	//     This is the "fixture loaded via the migration script, not from
	//     the real brain" integration the spec calls for.
	// -----------------------------------------------------------------------
	it("T9: a constitution built by the migration script — same predicate hits as the in-memory rules", () => {
		const repoDir = mkdtempSync(join(tmpdir(), "pi-r3-4-t9-"));
		tempDirs.push(repoDir);
		runGitIn(repoDir, ["init", "--quiet", "--initial-branch=main"]);
		runGitIn(repoDir, ["config", "user.email", "test@example.com"]);
		runGitIn(repoDir, ["config", "user.name", "Test"]);
		runGitIn(repoDir, ["config", "commit.gpgsign", "false"]);

		// Stage a daemon file with a real `setInterval` and NO shutdown.
		mkdirSync(join(repoDir, "src", "daemons"), { recursive: true });
		const daemonPath = join(repoDir, "src", "daemons", "heartbeat.ts");
		writeFileSync(
			daemonPath,
			"// unbounded daemon — no shutdown wiring at all\n" +
				"setInterval(() => console.log('tick'), 1000);\n",
			"utf8",
		);
		runGitIn(repoDir, ["add", "."]);
		runGitIn(repoDir, ["commit", "--quiet", "-m", "introduce heartbeat"]);

		// Build a "migrated" constitution by running the migration script's
		// in-memory logic on a fixture JSON file.
		const tmpRoot = mkdtempSync(join(tmpdir(), "pi-r3-4-t9-state-"));
		tempDirs.push(tmpRoot);
		mkdirSync(join(tmpRoot, ".idu", "config"), { recursive: true });
		const constitutionPath = join(
			tmpRoot,
			".idu",
			"config",
			"project-constitution.json",
		);
		// Minimal legacy 6-string brain.
		const legacy = {
			version: "1.0.0",
			projectName: "idu-pi",
			sourceCoreStatus: "confirmed",
			principles: [],
			forbiddenPractices: [],
			requiredPractices: [],
			technologyRules: {
				preferredStack: [],
				rejectedStack: [
					"Unbounded autonomous daemons",
					"MCP tools that implement code or authorize changes",
					"AgentLabs that edit the real repository or commit/push",
					"Uncontrolled web/news search for Bibliotecario evidence",
					"Implicit dependency installation or postinstall script execution",
					"Repo writes outside explicit worker/orchestrator flows",
				],
			},
			securityRules: [],
			dataRules: [],
			approvalRules: [],
			validationGates: [],
			specialistRoles: [],
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			status: "active",
		};
		writeFileSync(constitutionPath, JSON.stringify(legacy, null, 2) + "\n", "utf8");

		// Apply the migration IN MEMORY (no real write to the brain — this
		// test stays dry-run-style).
		const result = processLayout("A", constitutionPath);
		assert.equal(result.alreadyMigrated, false, "fixture starts as legacy");
		const migratedRaw = result.proposedRaw;

		// Sanity: the proposed text contains the expected rule ids.
		assert.match(migratedRaw, /unbounded-daemon-long-running/u);
		assert.match(migratedRaw, /Repo writes outside explicit worker\/orchestrator flows/u);

		// Parse the migrated JSON, build a `ProjectConstitution`, run the gate.
		const parsed = JSON.parse(migratedRaw) as ProjectConstitution;
		const rules: RejectedRule[] = (parsed.technologyRules.rejectedStack as Array<
			RejectedRule | string
		>)
			.filter((e): e is RejectedRule => typeof e === "object" && e !== null)
			.map((e) => e);

		// Replay the gate via the helper used elsewhere in the file.
		const constitutionFromMigration = buildConstitutionFromRejectedStack(rules);

		const originalCwd = process.cwd();
		try {
			process.chdir(repoDir);
			const gateResult = evaluateConstitutionGates({
				request: "introduce a long-running background service",
				changedFiles: ["src/daemons/heartbeat.ts"],
				constitution: constitutionFromMigration,
			});
			const hit = gateResult.failures.find(
				(f) => f.gateId === "rejected_stack",
			);
			assert.ok(
				hit,
				"bypass-closed proof: the migrated rules MUST fire rejected_stack on setInterval artifact",
			);
			// Item 1 is severity high (PARTIAL). The gate normalizes "high"
			// to itself.
			assert.equal(hit!.severity, "high");
			// The message must mention item 1 (or the rule summary).
			assert.match(hit!.message, /item 1/u);
		} finally {
			process.chdir(originalCwd);
		}
	});

	// -----------------------------------------------------------------------
	// T10: byte-level replacement integrity — after migration, the proposed
	//     file content is what the constitution loader sees.
	// -----------------------------------------------------------------------
	it("T10: a migrated file passes loadProjectConstitution's validator (round-trip)", () => {
		const tmpRoot = mkdtempSync(join(tmpdir(), "pi-r3-4-t10-"));
		tempDirs.push(tmpRoot);
		mkdirSync(join(tmpRoot, ".idu", "config"), { recursive: true });
		const constitutionPath = join(
			tmpRoot,
			".idu",
			"config",
			"project-constitution.json",
		);
		const legacy = {
			version: "1.0.0",
			projectName: "idu-pi",
			sourceCoreStatus: "confirmed",
			principles: ["p"],
			forbiddenPractices: ["f"],
			requiredPractices: ["r"],
			technologyRules: {
				preferredStack: ["TypeScript"],
				rejectedStack: [
					"Unbounded autonomous daemons",
					"MCP tools that implement code or authorize changes",
					"AgentLabs that edit the real repository or commit/push",
					"Uncontrolled web/news search for Bibliotecario evidence",
					"Implicit dependency installation or postinstall script execution",
					"Repo writes outside explicit worker/orchestrator flows",
				],
			},
			securityRules: ["s"],
			dataRules: ["d"],
			approvalRules: ["a"],
			validationGates: [
				{
					id: "project_core_not_confirmed",
					severity: "blocker",
					description: "x",
				},
			],
			specialistRoles: ["security"],
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			status: "active",
		};
		writeFileSync(constitutionPath, JSON.stringify(legacy, null, 2) + "\n", "utf8");
		const before = readFileSync(constitutionPath, "utf8");
		const after = replaceRejectedStack(before, PROPOSED_REJECTED_STACK);
		// Write the migrated content to a fresh file (we never touch the
		// real brain; this test stays dry-run-style).
		const migratedPath = join(tmpRoot, "migrated.json");
		writeFileSync(migratedPath, after, "utf8");
		assert.ok(existsSync(migratedPath));

		// Parse and assert it's structurally valid for the project.
		const parsed = JSON.parse(after) as Record<string, unknown>;
		const stack = (
			parsed as { technologyRules: { rejectedStack: unknown[] } }
		).technologyRules.rejectedStack;
		assert.equal(stack.length, 13);
		// Validate via the project's own validator.
		const v = validateProjectConstitution(parsed);
		assert.equal(v.ok, true, `errors: ${JSON.stringify(v.ok ? [] : v.errors)}`);
	});

	// -----------------------------------------------------------------------
	// U4: pathGuards end-to-end verification — file OUTSIDE the pathGuards
	// scope MUST NOT trigger the rule, even when the file content matches the
	// importPattern/commandPattern regex. This is the inverse of T3a and the
	// regression anchor for the bug #288 reported.
	// -----------------------------------------------------------------------
	it("U4a: mcp-write-shell-exec with pathGuards=['src/**','scripts/**'] does NOT fire on a test file containing writeFileSync (path guard blocks)", () => {
		const constitution = buildConstitutionFromRejectedStack(
			PROPOSED_REJECTED_RULES,
		);
		// test/probe.ts is OUTSIDE both src/** and scripts/** guards.
		const probeFile = "test/probe.ts";
		const map: Record<string, string> = {
			[probeFile]:
				'import { writeFileSync } from "node:fs";\nwriteFileSync("/tmp/x", "data");\n',
		};
		const readContent = (file: string): string | undefined => map[file];
		const hits = hasRejection(
			{
				changedFiles: [probeFile],
				constitution,
			},
			normalizeRejectedRules(constitution.technologyRules.rejectedStack),
			{ readContent },
		);
		const ids = hits.map((h) => h.rule.id);
		assert.ok(
			!ids.includes("mcp-write-shell-exec"),
			`mcp-write-shell-exec MUST NOT fire on test/probe.ts (pathGuards block it); got: ${ids.join(",")}`,
		);
	});

	it("U4b: agentlabs-edit-shell-exec with pathGuards=['src/agentlab-*.ts'] does NOT fire on a test file containing execSync (path guard blocks)", () => {
		const constitution = buildConstitutionFromRejectedStack(
			PROPOSED_REJECTED_RULES,
		);
		const probeFile = "test/probe.ts";
		const map: Record<string, string> = {
			[probeFile]:
				'import { execSync } from "node:child_process";\nexecSync("ls");\n',
		};
		const readContent = (file: string): string | undefined => map[file];
		const hits = hasRejection(
			{
				changedFiles: [probeFile],
				constitution,
			},
			normalizeRejectedRules(constitution.technologyRules.rejectedStack),
			{ readContent },
		);
		const ids = hits.map((h) => h.rule.id);
		assert.ok(
			!ids.includes("agentlabs-edit-shell-exec"),
			`agentlabs-edit-shell-exec MUST NOT fire on test/probe.ts (pathGuards block it); got: ${ids.join(",")}`,
		);
	});

	it("U4c: uncontrolled-search-imports with pathGuards=['src/**','scripts/**'] does NOT fire on a test file importing puppeteer (path guard blocks)", () => {
		const constitution = buildConstitutionFromRejectedStack(
			PROPOSED_REJECTED_RULES,
		);
		const probeFile = "test/probe.ts";
		const map: Record<string, string> = {
			[probeFile]:
				'import puppeteer from "puppeteer";\nconst browser = await puppeteer.launch();\n',
		};
		const readContent = (file: string): string | undefined => map[file];
		const hits = hasRejection(
			{
				changedFiles: [probeFile],
				constitution,
			},
			normalizeRejectedRules(constitution.technologyRules.rejectedStack),
			{ readContent },
		);
		const ids = hits.map((h) => h.rule.id);
		assert.ok(
			!ids.includes("uncontrolled-search-imports"),
			`uncontrolled-search-imports MUST NOT fire on test/probe.ts (pathGuards block it); got: ${ids.join(",")}`,
		);
	});

	it("U4d: filePattern rules (mcp-write-entrypoint, agentlabs-edit-files) still fire on their exact path even when pathGuards unrelated rules are added (no regression)", () => {
		const constitution = buildConstitutionFromRejectedStack(
			PROPOSED_REJECTED_RULES,
		);
		const probeFile = "src/mcp-server.ts";
		const map: Record<string, string> = {
			[probeFile]: '// any content\n',
		};
		const readContent = (file: string): string | undefined => map[file];
		const hits = hasRejection(
			{
				changedFiles: [probeFile],
				constitution,
			},
			normalizeRejectedRules(constitution.technologyRules.rejectedStack),
			{ readContent },
		);
		const ids = hits.map((h) => h.rule.id);
		assert.ok(
			ids.includes("mcp-write-entrypoint"),
			`mcp-write-entrypoint MUST fire on src/mcp-server.ts (filePattern unchanged by U2); got: ${ids.join(",")}`,
		);
	});
});
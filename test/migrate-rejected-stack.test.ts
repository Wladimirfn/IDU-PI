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
import { after, before, describe, test } from "node:test";
import { spawnSync } from "node:child_process";
import {
	ITEM_6_STRING,
	PROPOSED_REJECTED_RULES,
	PROPOSED_REJECTED_STACK,
	addPathGuards,
	replaceRejectedStack,
	runPathGuardsGate,
} from "../scripts/migrate-rejected-stack.js";
import type { PathGuardViolation } from "../scripts/migrate-rejected-stack.js";
import { hasRejection } from "../src/project-constitution.js";
import type {
	ConstitutionGateInput,
	ProjectConstitution,
	RejectedRule,
} from "../src/project-constitution.js";

// =========================================================================
// U2 of #288 — addPathGuards unit tests (TST-RSP-001).
//
// Scope: three importPattern rules (mcp-write-shell-exec,
// agentlabs-edit-shell-exec, uncontrolled-search-imports) gain pathGuards
// + pathGuardMode "any"; all other rules pass through unchanged. Re-running
// on an already-pathGuarded rule is a no-op (idempotency).
// =========================================================================

const TARGET_RULE_IDS = [
	"mcp-write-shell-exec",
	"agentlabs-edit-shell-exec",
	"uncontrolled-search-imports",
] as const;

const EXPECTED_PATH_GUARDS: Record<string, string[]> = {
	"mcp-write-shell-exec": ["src/**", "scripts/**"],
	"agentlabs-edit-shell-exec": ["src/agentlab-*.ts"],
	"uncontrolled-search-imports": ["src/**", "scripts/**"],
};

// Build a minimal non-target rule for passthrough tests. Shape matches the
// RejectedRule type from src/project-constitution.ts — detection is one
// importPattern variant without pathGuards.
function makeNonTargetRule(id: string): RejectedRule {
	return {
		id,
		summary: `non-target rule ${id}`,
		category: "stack",
		detection: { importPattern: "never-matches-anything-real" },
		severity: "high",
		rationale: "test fixture",
		messages: { blocked: "b", warning: "w" },
	};
}

describe("U2 addPathGuards unit (TST-RSP-001)", () => {
	test("addPathGuards([]) returns []", () => {
		const result = addPathGuards([]);
		assert.deepEqual(result, []);
	});

	test("addPathGuards on a non-target rule returns it unchanged (byte-equal)", () => {
		const rule = makeNonTargetRule("some-other-rule");
		const result = addPathGuards([rule]);
		assert.equal(result.length, 1);
		// The function must return the SAME rule reference (passthrough) — not a clone.
		assert.equal(result[0], rule, "non-target rule must be returned by reference unchanged");
	});

	test("each of the 3 target rule ids gains the expected pathGuards + pathGuardMode 'any'", () => {
		// Build an input array containing the 3 target rules WITHOUT pathGuards,
		// each shaped as a real RejectedRule with an importPattern detection.
		const input: RejectedRule[] = TARGET_RULE_IDS.map((id) => ({
			id,
			summary: `target ${id}`,
			category: "security",
			detection: { importPattern: "writeFile|execSync|spawnSync" },
			severity: "high",
			rationale: "fixture",
			messages: { blocked: "b", warning: "w" },
		}));

		const result = addPathGuards(input);
		assert.equal(result.length, input.length);

		for (let i = 0; i < input.length; i++) {
			const id = input[i].id;
			const out = result[i];
			const det = out.detection as Record<string, unknown> | null;
			assert.ok(det, `${id} detection must be present`);
			assert.ok(
				!Array.isArray(det) && typeof det === "object",
				`${id} detection must be an object`,
			);
			assert.deepEqual(
				(det as { pathGuards?: unknown }).pathGuards,
				EXPECTED_PATH_GUARDS[id],
				`${id} pathGuards mismatch`,
			);
			assert.equal(
				(det as { pathGuardMode?: unknown }).pathGuardMode,
				"any",
				`${id} pathGuardMode must be "any"`,
			);
			// Existing detection.importPattern must be preserved.
			assert.equal(
				(det as { importPattern?: unknown }).importPattern,
				(input[i].detection as { importPattern: string }).importPattern,
				`${id} original importPattern must survive`,
			);
			// Other top-level fields must survive untouched.
			assert.equal(out.id, input[i].id);
			assert.equal(out.severity, input[i].severity);
			assert.equal(out.summary, input[i].summary);
		}
	});

	test("addPathGuards on already-pathGuarded rule is a no-op (idempotency)", () => {
		// Build a target rule that ALREADY has pathGuards set — the function
		// must detect this and return it unchanged.
		const alreadyGuarded: RejectedRule = {
			id: "mcp-write-shell-exec",
			summary: "pre-guarded",
			category: "security",
			detection: {
				importPattern: "writeFile|execSync|spawnSync",
				pathGuards: ["custom/previously-set/**"],
				pathGuardMode: "any",
			},
			severity: "high",
			rationale: "fixture",
			messages: { blocked: "b", warning: "w" },
		};
		const result = addPathGuards([alreadyGuarded]);
		assert.equal(result.length, 1);
		// Must be the SAME reference — no overwrite of existing pathGuards.
		assert.equal(result[0], alreadyGuarded, "already-pathGuarded rule must be returned unchanged by reference");
		const det = result[0].detection as { pathGuards?: string[] };
		assert.deepEqual(
			det.pathGuards,
			["custom/previously-set/**"],
			"existing pathGuards must NOT be overwritten by addPathGuards",
		);
	});
});

// =========================================================================
// Cross-check: PROPOSED_REJECTED_RULES itself reflects the pathGuards.
// This is the MS-RSP-002 invariant — the hardcoded array must carry the
// new fields so re-migration is byte-identical.
// =========================================================================

describe("U2 PROPOSED_REJECTED_RULES carries pathGuards (MS-RSP-002)", () => {
	test("each of the 3 target ids in PROPOSED_REJECTED_RULES has the expected pathGuards + pathGuardMode 'any'", () => {
		for (const id of TARGET_RULE_IDS) {
			const rule = PROPOSED_REJECTED_RULES.find((r) => r.id === id);
			assert.ok(rule, `${id} must be present in PROPOSED_REJECTED_RULES`);
			const det = rule!.detection as { pathGuards?: string[]; pathGuardMode?: string } | null;
			assert.ok(det, `${id} detection must be present`);
			assert.deepEqual(
				det!.pathGuards,
				EXPECTED_PATH_GUARDS[id],
				`${id} must have hardcoded pathGuards in PROPOSED_REJECTED_RULES`,
			);
			assert.equal(
				det!.pathGuardMode,
				"any",
				`${id} must have pathGuardMode "any" in PROPOSED_REJECTED_RULES`,
			);
		}
	});

	test("running addPathGuards over PROPOSED_REJECTED_RULES is a no-op (idempotent — already guarded)", () => {
		// Since PROPOSED_REJECTED_RULES carries the guards, the function must
		// return each rule by reference (untouched).
		const result = addPathGuards(PROPOSED_REJECTED_RULES);
		assert.equal(result.length, PROPOSED_REJECTED_RULES.length);
		for (let i = 0; i < PROPOSED_REJECTED_RULES.length; i++) {
			assert.equal(
				result[i],
				PROPOSED_REJECTED_RULES[i],
				`PROPOSED_REJECTED_RULES[${i}] (${PROPOSED_REJECTED_RULES[i].id}) must pass through unchanged`,
			);
		}
	});

	test("non-target rules in PROPOSED_REJECTED_RULES have NO pathGuards (INV-RSP-001/002/003)", () => {
		// Every rule that is NOT one of the 3 target ids must have a detection
		// WITHOUT pathGuards — filePattern rules, commandPattern rules, and
		// behaviorPattern rules all stay unscoped.
		for (const rule of PROPOSED_REJECTED_RULES) {
			if (TARGET_RULE_IDS.includes(rule.id as (typeof TARGET_RULE_IDS)[number])) continue;
			const det = rule.detection as Record<string, unknown> | null;
			assert.ok(det, `${rule.id} detection must be present`);
			assert.ok(
				!("pathGuards" in det),
				`${rule.id} (${Object.keys(det).join(",")}) must NOT have pathGuards`,
			);
			assert.ok(
				!("pathGuardMode" in det),
				`${rule.id} must NOT have pathGuardMode`,
			);
		}
	});
});

// =========================================================================
// Phase 2 — integration tests (TST-RSP-002, TST-RSP-003, TST-RSP-004)
//
// Run the COMPILED migration script via spawnSync against a temp stateRoot
// containing a fixture legacy constitution. Asserts:
//   TST-RSP-002 — --dry-run stdout contains the 3 pathGuards additions.
//   TST-RSP-003 — --apply writes the proposed bytes; post-read byte-equal.
//   TST-RSP-004 — idempotency: second --apply produces zero diff.
// =========================================================================

const SCRIPTS_DIR = join(process.cwd(), "dist", "scripts");
const SCRIPT_PATH = join(SCRIPTS_DIR, "migrate-rejected-stack.js");

const tempRoots: string[] = [];

function makeStateRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "idu-pi-u2-mig-"));
	tempRoots.push(root);
	return root;
}

function writeLegacyConstitution(root: string, layout: "A" | "B"): string {
	const dir = layout === "A" ? join(root, ".idu", "config") : join(root, "config");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "project-constitution.json");
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
			{ id: "project_core_not_confirmed", severity: "blocker", description: "x" },
		],
		specialistRoles: ["security"],
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		status: "active",
	};
	writeFileSync(path, JSON.stringify(legacy, null, 2) + "\n", "utf8");
	return path;
}

after(() => {
	for (const r of tempRoots) rmSync(r, { recursive: true, force: true });
});

describe("U2 integration — compiled CLI (TST-RSP-002/003/004)", () => {
	before(() => {
		if (!existsSync(SCRIPT_PATH)) {
			throw new Error(
				`migrate-rejected-stack.js not compiled at ${SCRIPTS_DIR}. Run \`pnpm run build\` first.`,
			);
		}
	});

	test("TST-RSP-002: --dry-run prints the proposed stack with the 3 pathGuards additions", () => {
		const root = makeStateRoot();
		writeLegacyConstitution(root, "A");

		const result = spawnSync(
			"node",
			[SCRIPT_PATH, "--dry-run", `--state-root=${root}`],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, `stderr: ${result.stderr}`);

		// The proposed block must surface the pathGuards entries on the 3 target rules.
		// We assert that the stdout JSON contains the pathGuards key followed by the
		// expected globs, anchored to each rule id. Each rule id appears once in
		// PROPOSED_REJECTED_STACK so a simple substring search is unambiguous.
		assert.match(result.stdout, /mcp-write-shell-exec/u, "rule id must appear");
		assert.match(result.stdout, /agentlabs-edit-shell-exec/u, "rule id must appear");
		assert.match(result.stdout, /uncontrolled-search-imports/u, "rule id must appear");

		// pathGuards + pathGuardMode must be present as JSON keys in the output.
		assert.match(result.stdout, /"pathGuards"/u, "pathGuards key must be printed");
		assert.match(result.stdout, /"pathGuardMode"/u, "pathGuardMode key must be printed");
		assert.match(result.stdout, /"src\/\*\*"/u, "src/** glob must be present");
		assert.match(result.stdout, /"scripts\/\*\*"/u, "scripts/** glob must be present");
		assert.match(
			result.stdout,
			/"src\/agentlab-\*\.ts"/u,
			"src/agentlab-*.ts glob must be present",
		);
	});

	test("TST-RSP-003: --apply writes proposed bytes; re-read is byte-equal and contains pathGuards", () => {
		const root = makeStateRoot();
		const path = writeLegacyConstitution(root, "A");
		const before = readFileSync(path, "utf8");

		const result = spawnSync(
			"node",
			[SCRIPT_PATH, "--apply", `--state-root=${root}`],
			{
				encoding: "utf8",
				env: { ...process.env, MIGRATE_APPLY_DELAY_MS: "0" },
			},
		);
		assert.equal(result.status, 0, `stderr: ${result.stderr}`);

		const after = readFileSync(path, "utf8");
		assert.notEqual(after, before, "file must change after --apply");

		// Reconstruct the expected proposed content in memory: it must match the
		// post-apply file bytes EXACTLY (byte-equality proof per MS-RSP-004).
		const expected = replaceRejectedStack(before, PROPOSED_REJECTED_STACK);
		assert.equal(after, expected, "post-apply bytes must equal the proposed bytes");

		// The 3 target rules in the written file must carry pathGuards.
		const parsed = JSON.parse(after) as {
			technologyRules: { rejectedStack: Array<RejectedRule | string> };
		};
		const stack = parsed.technologyRules.rejectedStack;
		assert.equal(stack.length, PROPOSED_REJECTED_STACK.length, "13 entries (12 rules + 1 string)");
		assert.equal(stack[stack.length - 1], ITEM_6_STRING, "trailing item-6 string preserved");

		for (const id of TARGET_RULE_IDS) {
			const rule = stack.find(
				(e): e is RejectedRule => typeof e === "object" && e !== null && e.id === id,
			);
			assert.ok(rule, `${id} must be present in the written stack`);
			const det = rule!.detection as { pathGuards?: string[]; pathGuardMode?: string };
			assert.deepEqual(
				det.pathGuards,
				EXPECTED_PATH_GUARDS[id],
				`${id} must have the expected pathGuards after --apply`,
			);
			assert.equal(det.pathGuardMode, "any", `${id} must have pathGuardMode "any" after --apply`);
		}
	});

	test("TST-RSP-004: idempotency — second --apply produces zero diff", () => {
		const root = makeStateRoot();
		const path = writeLegacyConstitution(root, "A");

		// First apply: legacy → migrated (with pathGuards).
		const first = spawnSync(
			"node",
			[SCRIPT_PATH, "--apply", `--state-root=${root}`],
			{
				encoding: "utf8",
				env: { ...process.env, MIGRATE_APPLY_DELAY_MS: "0" },
			},
		);
		assert.equal(first.status, 0, `first apply stderr: ${first.stderr}`);

		const afterFirst = readFileSync(path, "utf8");

		// Second apply: must be a no-op (file already migrated).
		const second = spawnSync(
			"node",
			[SCRIPT_PATH, "--apply", `--state-root=${root}`],
			{
				encoding: "utf8",
				env: { ...process.env, MIGRATE_APPLY_DELAY_MS: "0" },
			},
		);
		assert.equal(second.status, 0, `second apply stderr: ${second.stderr}`);
		// The script's --apply branch prints "already migrated — skipping" for no-op layouts.
		assert.match(
			second.stdout,
			/already migrated — skipping/u,
			"second --apply must report a no-op",
		);

		const afterSecond = readFileSync(path, "utf8");
		assert.equal(afterSecond, afterFirst, "second --apply must produce zero byte diff");

		// Cross-check via a --dry-run on the now-migrated file: it should NOT
		// propose any change. The stdout still prints the proposed array (for
		// auditor visibility), but the byte-equality header lines must report
		// delta bytes: 0 and already migrated: true.
		const dry = spawnSync(
			"node",
			[SCRIPT_PATH, "--dry-run", `--state-root=${root}`],
			{ encoding: "utf8" },
		);
		assert.equal(dry.status, 0, `dry-run stderr: ${dry.stderr}`);
		assert.match(dry.stdout, /already migrated:\s*true/u, "dry-run on migrated file must report alreadyMigrated=true");
		assert.match(dry.stdout, /delta bytes:\s*0/u, "dry-run on migrated file must report delta bytes: 0");
	});
});

// =========================================================================
// U3 of #288 PR #2 — pathGuards dry-run gate tests (TST-PGG-001..005).
//
// The gate (`runPathGuardsGate`) was shipped in PR #1 (commit 8483c92) in
// scripts/migrate-rejected-stack.ts. These tests exercise its four phases:
//   Phase 1 — shape validation              (TST-PGG-001)
//   Phase 2 — filesystem verification        (TST-PGG-002)
//   Phase 3 — functional via real hasRejection (TST-PGG-003)
//   Reporting/blocking in --apply (TST-PGG-004) and --dry-run (TST-PGG-005)
//
// Deviations accommodated (per apply-progress-pr1 obs 3561):
//   1. matchesGlob is NOT exported — Phase 2 is exercised transitively via
//      hasRejection's filePattern branch. Tests do NOT import matchesGlob.
//   2. main() wires the gate with `process.cwd()` (NOT args.stateRoot).
//      Integration tests spawn with `cwd: <temp>` so the gate walks an empty
//      dir (no src/) and fails Phase 2. Unit tests pass `projectPath` directly
//      to the gate function — it is a pure parameter, not read from cwd.
//   3. Invalid globs are double-reported (invalid-glob + glob-matches-no-files)
//      in dry-run/apply mode. Shape unit tests use mode "verify" to isolate
//      Phase 1 (verify mode returns after shape checks).
// =========================================================================

// Build a minimal ProjectConstitution for hasRejection probes. Shape per
// src/project-constitution.ts:23-45. Only technologyRules.rejectedStack is
// overridden per-test so other rules do not pollute the result.
function makeMinimalConstitution(rejectedStack: RejectedRule[]): ProjectConstitution {
	return {
		version: "1.0.0",
		projectName: "path-guards-gate-test",
		sourceCoreStatus: "draft",
		principles: [],
		forbiddenPractices: [],
		requiredPractices: [],
		technologyRules: { preferredStack: [], rejectedStack },
		securityRules: [],
		dataRules: [],
		approvalRules: [],
		validationGates: [],
		specialistRoles: [],
		createdAt: "",
		updatedAt: "",
		status: "active",
	};
}

// Build a baseline pathGuarded importPattern rule. Fields not relevant to the
// gate are filled with harmless defaults. `mode` defaults to "any".
function makeImportRule(
	id: string,
	pathGuards: string[],
	mode: "any" | "all" = "any",
	importPattern = "writeFile|execSync|spawnSync",
): RejectedRule {
	return {
		id,
		summary: `fixture ${id}`,
		category: "security",
		detection: { importPattern, pathGuards, pathGuardMode: mode },
		severity: "high",
		rationale: "test fixture",
		messages: { blocked: "b", warning: "w" },
	};
}

// The 3 pathGuarded rules in PROPOSED_REJECTED_RULES — extracted dynamically
// so the functional tests track the real production rules, not a copy.
const PATH_GUARDED_RULES: RejectedRule[] = PROPOSED_REJECTED_RULES.filter((r) => {
	const det = r.detection as { pathGuards?: unknown } | null;
	return det !== null && typeof det === "object" && "pathGuards" in det;
});

// -------------------------------------------------------------------------
// TST-PGG-001 — Shape validation (Phase 1, isolated via mode "verify").
// Verify mode returns immediately after Phase 1, so Phase 2/3 cannot pollute
// these assertions. Each test pins ONE violation kind + ruleId.
// -------------------------------------------------------------------------

describe("U3 gate shape validation (TST-PGG-001)", () => {
	test("gate_shape_empty_guards: pathGuards:[] reports empty-guards", () => {
		const rule = makeImportRule("empty-guards-rule", []);
		const report = runPathGuardsGate([rule], ".", { mode: "verify" });
		assert.equal(report.ok, false);
		const v = report.violations.find((x) => x.kind === "empty-guards");
		assert.ok(v, "must report empty-guards");
		assert.equal(v!.ruleId, "empty-guards-rule");
	});

	test("gate_shape_behavior_pattern_with_guards: behaviorPattern + pathGuards reports behavior-pattern-with-guards", () => {
		const rule: RejectedRule = {
			id: "behavior-rule",
			summary: "behavior + guards (forbidden combo per owner decision)",
			category: "process",
			detection: {
				behaviorPattern: "long-running",
				pathGuards: ["src/**"],
				pathGuardMode: "any",
			},
			severity: "high",
			rationale: "fixture",
			messages: { blocked: "b", warning: "w" },
		};
		const report = runPathGuardsGate([rule], ".", { mode: "verify" });
		assert.equal(report.ok, false);
		const v = report.violations.find(
			(x) => x.kind === "behavior-pattern-with-guards",
		);
		assert.ok(v, "must report behavior-pattern-with-guards");
		assert.equal(v!.ruleId, "behavior-rule");
	});

	test("gate_shape_duplicate_id: same id + divergent pathGuards reports duplicate-id", () => {
		const rule1 = makeImportRule("dup-rule", ["src/**"]);
		const rule2 = makeImportRule("dup-rule", ["scripts/**"]);
		const report = runPathGuardsGate([rule1, rule2], ".", { mode: "verify" });
		assert.equal(report.ok, false);
		const v = report.violations.find((x) => x.kind === "duplicate-id");
		assert.ok(v, "must report duplicate-id");
		assert.equal(v!.ruleId, "dup-rule");
	});

	test("gate_shape_invalid_glob: absolute-path glob reports invalid-glob", () => {
		const rule = makeImportRule("invalid-glob-rule", ["/etc/passwd"]);
		const report = runPathGuardsGate([rule], ".", { mode: "verify" });
		assert.equal(report.ok, false);
		const v = report.violations.find((x) => x.kind === "invalid-glob");
		assert.ok(v, "must report invalid-glob");
		assert.equal(v!.ruleId, "invalid-glob-rule");
		assert.equal(v!.context, "/etc/passwd");
	});

	test("gate_shape_clean_rule_has_no_violations (Phase 1 sanity)", () => {
		// A well-formed rule produces zero Phase 1 violations in verify mode.
		const rule = makeImportRule("clean-rule", ["src/**"]);
		const report = runPathGuardsGate([rule], ".", { mode: "verify" });
		assert.equal(report.ok, true);
		assert.deepEqual(report.violations, []);
	});

	// Type-level proof that PathGuardViolation is exported with the 6 kinds.
	test("gate_shape_pathguardviolation_type_covers_six_kinds (type-level)", () => {
		const sample: PathGuardViolation = { ruleId: "x", kind: "empty-guards" };
		const kinds: PathGuardViolation["kind"][] = [
			"empty-guards",
			"behavior-pattern-with-guards",
			"duplicate-id",
			"invalid-glob",
			"glob-matches-no-files",
			"rule-fires-outside-scope",
		];
		assert.equal(sample.kind, "empty-guards");
		assert.equal(kinds.length, 6);
	});
});

// -------------------------------------------------------------------------
// TST-PGG-002 — Filesystem verification (Phase 2).
// Each glob must match at least one real file under projectPath. Tests pass
// the temp dir DIRECTLY as projectPath (the gate takes it as a parameter;
// no process.chdir needed — see deviation note at top of section).
// -------------------------------------------------------------------------

describe("U3 gate filesystem verification (TST-PGG-002)", () => {
	// Per-test temp dir seeded with src/foo.ts + scripts/bar.ts. Removed in
	// a finally so a failure does not leak temp dirs across test runs.
	function seedTempProject(): string {
		const dir = mkdtempSync(join(tmpdir(), "idu-pi-u3-fs-"));
		mkdirSync(join(dir, "src"), { recursive: true });
		mkdirSync(join(dir, "scripts"), { recursive: true });
		writeFileSync(join(dir, "src", "foo.ts"), "// probe\n", "utf8");
		writeFileSync(join(dir, "scripts", "bar.ts"), "// probe\n", "utf8");
		return dir;
	}

	test("gate_filesystem_glob_matches: src/** against temp with src/foo.ts → no glob-matches-no-files", () => {
		const dir = seedTempProject();
		try {
			const rule = makeImportRule("fs-ok-rule", ["src/**"]);
			const report = runPathGuardsGate([rule], dir, { mode: "dry-run" });
			const noFiles = report.violations.filter(
				(x) => x.kind === "glob-matches-no-files",
			);
			assert.deepEqual(
				noFiles,
				[],
				"src/** must match src/foo.ts — no glob-matches-no-files violation",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test("gate_filesystem_glob_typo: srcc/** → reports glob-matches-no-files", () => {
		const dir = seedTempProject();
		try {
			const rule = makeImportRule("fs-typo-rule", ["srcc/**"]);
			const report = runPathGuardsGate([rule], dir, { mode: "dry-run" });
			assert.equal(report.ok, false);
			const v = report.violations.find(
				(x) => x.kind === "glob-matches-no-files",
			);
			assert.ok(v, "must report glob-matches-no-files for srcc/**");
			assert.equal(v!.ruleId, "fs-typo-rule");
			assert.equal(v!.context, "srcc/**");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// -------------------------------------------------------------------------
// TST-PGG-003 — Functional validation (Phase 3 via real hasRejection).
// For each of the 3 pathGuarded rules: positive (in-scope file + matching
// content) MUST fire; negative (out-of-scope file + same content) MUST NOT
// fire. Plus a gate-level end-to-end check and the pathGuardMode "all" case
// for the rule-fires-outside-scope violation kind.
// -------------------------------------------------------------------------

describe("U3 gate functional validation (TST-PGG-003)", () => {
	// Derive an in-scope file path from a rule's first pathGuard, mirroring
	// the gate's sampleFileUnderScope. "src/**" → "src/probe.ts";
	// "src/agentlab-*.ts" → "src/agentlab-probe.ts".
	function inScopeFile(rule: RejectedRule): string {
		const det = rule.detection as { pathGuards?: string[] };
		const first = det.pathGuards![0];
		if (/\*\*\/?$/u.test(first)) return `${first.replace(/\*\*\/?$/u, "")}probe.ts`;
		if (first.includes("*")) return first.replace(/\*/u, "probe");
		return first;
	}

	// First alternative of the rule's importPattern — a token that matches the
	// rule's regex. importPattern values are alternations ("a|b|c").
	function firstAlternative(rule: RejectedRule): string {
		const det = rule.detection as { importPattern: string };
		return det.importPattern.split("|")[0];
	}

	for (const rule of PATH_GUARDED_RULES) {
		test(`gate_functional_positive_${rule.id}: in-scope file + matching content → rule fires`, () => {
			const file = inScopeFile(rule);
			const token = firstAlternative(rule);
			const content = `import { ${token} } from "synthetic-stub";`;
			const input: ConstitutionGateInput = {
				changedFiles: [file],
				constitution: makeMinimalConstitution([rule]),
			};
			const hits = hasRejection(input, [rule], {
				readContent: () => content,
				readDiff: () => content,
			});
			assert.ok(
				hits.length > 0,
				`${rule.id} must fire for in-scope ${file} with matching content`,
			);
		});

		test(`gate_functional_negative_${rule.id}: out-of-scope file + matching content → rule does NOT fire`, () => {
			// "test/" is outside every current pathGuards scope (src/**,
			// scripts/**, src/agentlab-*.ts) — scopedFiles filters it out.
			const outOfScope = "test/__path_guards_gate_probe__.ts";
			const token = firstAlternative(rule);
			const content = `import { ${token} } from "synthetic-stub";`;
			const input: ConstitutionGateInput = {
				changedFiles: [outOfScope],
				constitution: makeMinimalConstitution([rule]),
			};
			const hits = hasRejection(input, [rule], {
				readContent: () => content,
				readDiff: () => content,
			});
			assert.equal(
				hits.length,
				0,
				`${rule.id} must NOT fire for out-of-scope ${outOfScope}`,
			);
		});
	}

	test("gate_functional_all_real_rules_pass_gate: the 3 pathGuarded rules produce no rule-fires-outside-scope", () => {
		// End-to-end: the gate's internal functionalCheck runs positive AND
		// negative probes for each rule. Uses the repo root as projectPath so
		// Phase 2 globs (src/**, scripts/**, src/agentlab-*.ts) also match.
		const report = runPathGuardsGate(PATH_GUARDED_RULES, process.cwd(), {
			mode: "dry-run",
		});
		const functionalViolations = report.violations.filter(
			(x) => x.kind === "rule-fires-outside-scope",
		);
		assert.deepEqual(
			functionalViolations,
			[],
			"no rule-fires-outside-scope for the 3 real pathGuarded rules",
		);
	});

	test("gate_functional_rule_fires_outside_scope_via_all_mode: pathGuardMode 'all' with divergent guards → rule-fires-outside-scope", () => {
		// Defense-in-depth for the 6th violation kind. sampleFileUnderScope
		// derives the sample from the FIRST guard only; under mode "all"
		// scopedFiles requires the file to match BOTH guards. The sample
		// matches "src/**" but NOT "scripts/**" → filtered out → positive
		// probe returns 0 hits → rule-fires-outside-scope.
		const rule = makeImportRule(
			"all-mode-rule",
			["src/**", "scripts/**"],
			"all",
		);
		const report = runPathGuardsGate([rule], process.cwd(), {
			mode: "dry-run",
		});
		const v = report.violations.find(
			(x) => x.kind === "rule-fires-outside-scope",
		);
		assert.ok(
			v,
			"must report rule-fires-outside-scope under pathGuardMode 'all' with divergent guards",
		);
		assert.equal(v!.ruleId, "all-mode-rule");
	});
});

// -------------------------------------------------------------------------
// TST-PGG-004 — --apply blocking integration.
// TST-PGG-005 — --dry-run reporting integration.
//
// The gate in main() uses process.cwd() (deviation #2). Spawning with
// `cwd: <temp>` makes the gate walk an empty dir (the temp stateRoot has a
// .idu/config/constitution but no src/) → Phase 2 reports glob-matches-no-
// files for every pathGuarded rule → gateReport.ok = false → --apply exits 4
// before writeAtomic, --dry-run prints FAIL and exits 0.
// -------------------------------------------------------------------------

describe("U3 gate integration — compiled CLI (TST-PGG-004 / TST-PGG-005)", () => {
	// Temp stateRoot with a legacy constitution but NO src/ tree. The gate
	// walks process.cwd() = this dir, finds no src/ or scripts/, reports
	// glob-matches-no-files for every pathGuarded rule.
	function makeEmptyStateRoot(): string {
		const root = makeStateRoot();
		writeLegacyConstitution(root, "A");
		return root;
	}

	test("TST-PGG-004: --apply blocks on gate violations (exit 4, file NOT written)", () => {
		const root = makeEmptyStateRoot();
		const constitutionPath = join(
			root,
			".idu",
			"config",
			"project-constitution.json",
		);
		const before = readFileSync(constitutionPath, "utf8");

		const result = spawnSync(
			"node",
			[SCRIPT_PATH, "--apply", `--state-root=${root}`],
			{
				encoding: "utf8",
				cwd: root,
				env: { ...process.env, MIGRATE_APPLY_DELAY_MS: "0" },
			},
		);

		assert.equal(
			result.status,
			4,
			`--apply MUST exit 4 on gate failure; got status=${result.status}; stderr: ${result.stderr}`,
		);
		assert.match(
			result.stderr,
			/Path guards gate FAILED/u,
			"stderr must carry the gate failure banner",
		);

		const after = readFileSync(constitutionPath, "utf8");
		assert.equal(
			after,
			before,
			"constitution file MUST NOT be written when the gate fails",
		);
	});

	test("TST-PGG-005: --dry-run reports gate violations (exit 0, FAIL summary on stdout)", () => {
		const root = makeEmptyStateRoot();

		const result = spawnSync(
			"node",
			[SCRIPT_PATH, "--dry-run", `--state-root=${root}`],
			{
				encoding: "utf8",
				cwd: root,
			},
		);

		assert.equal(
			result.status,
			0,
			`--dry-run MUST exit 0 even on gate failure; got status=${result.status}; stderr: ${result.stderr}`,
		);
		assert.match(
			result.stdout,
			/Path guards gate: FAIL/u,
			"stdout must carry the gate FAIL summary",
		);
		// At least one per-violation line for a pathGuarded rule + the
		// glob-matches-no-files kind. Format: "  - <ruleId>: <kind> (<context>)".
		assert.match(
			result.stdout,
			/mcp-write-shell-exec: glob-matches-no-files \(src\/\*\*\)/u,
			"stdout must list the glob-matches-no-files violation for mcp-write-shell-exec src/**",
		);
	});
});

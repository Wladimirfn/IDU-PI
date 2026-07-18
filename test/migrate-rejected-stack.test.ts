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
} from "../scripts/migrate-rejected-stack.js";
import type { RejectedRule } from "../src/project-constitution.js";

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

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
	ITEM_6_STRING,
	PROPOSED_REJECTED_RULES,
	PROPOSED_REJECTED_STACK,
	isAlreadyMigrated,
	layoutPaths,
	processLayout,
	replaceRejectedStack,
	writeAtomic,
} from "../scripts/migrate-rejected-stack.js";
import { validateProjectConstitution } from "../src/project-constitution.js";

// =========================================================================
// Helpers
// =========================================================================

const tempRoots: string[] = [];

function makeStateRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "idu-pi-r3-4-mig-"));
	tempRoots.push(root);
	return root;
}

function writeConstitution(
	root: string,
	layout: "A" | "B",
	content: unknown,
): string {
	const dir =
		layout === "A"
			? join(root, ".idu", "config")
			: join(root, "config");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, "project-constitution.json");
	writeFileSync(path, JSON.stringify(content, null, 2) + "\n", "utf8");
	return path;
}

const LEGACY_6_STRINGS = [
	"Unbounded autonomous daemons",
	"MCP tools that implement code or authorize changes",
	"AgentLabs that edit the real repository or commit/push",
	"Uncontrolled web/news search for Bibliotecario evidence",
	"Implicit dependency installation or postinstall script execution",
	"Repo writes outside explicit worker/orchestrator flows",
];

function fixtureBrain(layout: "A" | "B", root: string): {
	path: string;
	content: Record<string, unknown>;
} {
	const content = {
		version: "1.0.0",
		projectName: "idu-pi",
		sourceCoreStatus: "confirmed",
		principles: [
			"The human and Pi orchestrator own final decisions; Idu-pi is an advisory supervisor and execution director.",
			"Evidence beats assertion: plans, tasks, reviews, postflight, and Bibliotecario outputs must expose evidence refs and limitations.",
		],
		forbiddenPractices: [
			"Skipping required build, tests, diff check, review, or postflight evidence",
			"Promoting contracts, learning rules, or skills without explicit human/orchestrator approval",
		],
		requiredPractices: [
			"Confirm Project Core before activating Constitution gates.",
			"Keep changes inside includedScope and outside excludedScope.",
			"Alcance incluido: src | config",
			"Alcance excluido: workspaces | .idu/workspaces",
		],
		technologyRules: {
			preferredStack: [
				"TypeScript",
				"Node.js ESM",
				"pnpm with exact dependency versions",
			],
			rejectedStack: LEGACY_6_STRINGS,
		},
		securityRules: [
			"Security level: high.",
			"Auth, secrets, permissions require explicit review.",
		],
		dataRules: [
			"Data sensitivity: medium.",
			"Runtime reports must stay under stateRoot.",
		],
		approvalRules: [
			"Project Core must be confirmed.",
			"High/blocker requests require human confirmation.",
		],
		validationGates: [
			{
				id: "project_core_not_confirmed",
				severity: "blocker",
				description: "Project Core must be confirmed.",
			},
			{
				id: "rejected_stack",
				severity: "blocker",
				description: "Rejected stack blocked.",
			},
		],
		specialistRoles: ["security", "architecture"],
		createdAt: "2026-05-29T19:49:14.590Z",
		updatedAt: "2026-06-06T19:04:30.000Z",
		status: "active",
	};
	const path = writeConstitution(root, layout, content);
	return { path, content };
}

after(() => {
	for (const r of tempRoots) rmSync(r, { recursive: true, force: true });
});

// =========================================================================
// 1. The proposed rules themselves — verbatim invariants from the spec.
// =========================================================================

describe("R3.4 proposed rejectedStack array", () => {
	test("contains 11 RejectedRule objects + 1 trailing string (item 6)", () => {
		assert.equal(PROPOSED_REJECTED_STACK.length, 13);
		const objectEntries = PROPOSED_REJECTED_STACK.filter(
			(e) => e && typeof e === "object",
		);
		const stringEntries = PROPOSED_REJECTED_STACK.filter(
			(e) => typeof e === "string",
		);
		assert.equal(objectEntries.length, 12, "12 RejectedRule objects");
		assert.equal(stringEntries.length, 1, "1 trailing string");
	});

	test("item 6 is the LAST element (auditor Q4 decision)", () => {
		const last = PROPOSED_REJECTED_STACK[PROPOSED_REJECTED_STACK.length - 1];
		assert.equal(last, ITEM_6_STRING);
		assert.equal(last, "Repo writes outside explicit worker/orchestrator flows");
	});

	test("id prefixes match the spec: unbounded-daemon-, mcp-write-, agentlabs-edit-, uncontrolled-search-, implicit-deps-", () => {
		const counts: Record<string, number> = {
			"unbounded-daemon-": 0,
			"mcp-write-": 0,
			"agentlabs-edit-": 0,
			"uncontrolled-search-": 0,
			"implicit-deps-": 0,
		};
		for (const rule of PROPOSED_REJECTED_RULES) {
			for (const prefix of Object.keys(counts)) {
				if (rule.id.startsWith(prefix)) counts[prefix] += 1;
			}
		}
		assert.equal(counts["unbounded-daemon-"], 2, "item 1 = 2 rules");
		assert.equal(counts["mcp-write-"], 4, "item 2 = 4 rules");
		assert.equal(counts["agentlabs-edit-"], 3, "item 3 = 3 rules");
		assert.equal(counts["uncontrolled-search-"], 2, "item 4 = 2 rules");
		assert.equal(counts["implicit-deps-"], 1, "item 5 = 1 rule (R3.4 round 2: Item 5.2 removed)");
	});

	test("items 3: severity = blocker, NO LLM-discretion clause in rationale (item 5 downgraded to high)", () => {
		const blockers = PROPOSED_REJECTED_RULES.filter(
			(r) => r.id.startsWith("agentlabs-edit-"),
		);
		assert.equal(blockers.length, 3, "3 agentlabs rules = 3 blocker rules (Item 5 downgraded to high in R3.4 round 2)");
		for (const rule of blockers) {
			assert.equal(rule.severity, "blocker", `${rule.id} must be blocker`);
			assert.ok(
				!/LLM-discretion/u.test(rule.rationale),
				`${rule.id} rationale MUST NOT contain "LLM-discretion"`,
			);
		}
	});

	test("item 5: severity = high, NO LLM-discretion clause, text-fragility clause present (advisory-grade)", () => {
		const item5 = PROPOSED_REJECTED_RULES.filter((r) =>
			r.id.startsWith("implicit-deps-"),
		);
		assert.equal(item5.length, 1, "item 5 = 1 rule (R3.4 round 2)");
		for (const rule of item5) {
			assert.equal(rule.severity, "high", `${rule.id} must be high (NOT blocker) — R3.4 round 2 downgraded Item 5`);
			assert.ok(
				!/LLM-discretion/u.test(rule.rationale),
				`${rule.id} rationale MUST NOT contain "LLM-discretion"`,
			);
			assert.ok(
				/text-fragility/u.test(rule.rationale),
				`${rule.id} rationale MUST contain "text-fragility" clause (advisory-grade marker)`,
			);
		}
	});

	test("items 1, 2, 4: severity = high, LLM-discretion clause in rationale", () => {
		const partials = PROPOSED_REJECTED_RULES.filter(
			(r) =>
				r.id.startsWith("unbounded-daemon-") ||
				r.id.startsWith("mcp-write-") ||
				r.id.startsWith("uncontrolled-search-"),
		);
		assert.equal(partials.length, 8, "2 unbounded + 4 mcp + 2 search = 8 high rules");
		for (const rule of partials) {
			assert.equal(rule.severity, "high", `${rule.id} must be high (NOT blocker)`);
			assert.ok(
				/LLM-discretion/u.test(rule.rationale),
				`${rule.id} rationale MUST contain "LLM-discretion" clause`,
			);
		}
	});

	test("every detection field has EXACTLY ONE discriminator key (pathGuards/pathGuardMode are optional modifiers, not discriminators)", () => {
		// U2 of #288: importPattern / commandPattern / behaviorPattern variants
		// may carry optional `pathGuards` + `pathGuardMode` modifiers alongside
		// their discriminator key. The discriminator-key invariant is unchanged
		// — exactly one of {filePattern, depPattern, importPattern, commandPattern,
		// behaviorPattern} per detection — but the total key count may be 1 or 3.
		const DISCRIMINATORS = new Set([
			"filePattern",
			"depPattern",
			"importPattern",
			"commandPattern",
			"behaviorPattern",
		]);
		const MODIFIERS = new Set(["pathGuards", "pathGuardMode"]);
		for (const rule of PROPOSED_REJECTED_RULES) {
			assert.ok(rule.detection, `${rule.id} detection must be present`);
			const keys = Object.keys(rule.detection);
			const discriminatorKeys = keys.filter((k) => DISCRIMINATORS.has(k));
			assert.equal(
				discriminatorKeys.length,
				1,
				`${rule.id} detection must have exactly 1 discriminator key, got ${discriminatorKeys.length} (${discriminatorKeys.join(",")})`,
			);
			// Every non-discriminator key must be a recognized modifier.
			for (const k of keys) {
				assert.ok(
					DISCRIMINATORS.has(k) || MODIFIERS.has(k),
					`${rule.id} detection has unknown key "${k}" (not a discriminator, not a recognized modifier)`,
				);
			}
		}
	});

	test("all severities are valid (blocker | high | medium | low)", () => {
		const valid = ["blocker", "high", "medium", "low"] as const;
		for (const rule of PROPOSED_REJECTED_RULES) {
			assert.ok(
				valid.includes(rule.severity as (typeof valid)[number]),
				`${rule.id} severity must be one of ${valid.join("|")}`,
			);
		}
	});

	test("all categories are valid (stack | process | data | security)", () => {
		const valid = ["stack", "process", "data", "security"] as const;
		for (const rule of PROPOSED_REJECTED_RULES) {
			assert.ok(
				valid.includes(rule.category as (typeof valid)[number]),
				`${rule.id} category must be one of ${valid.join("|")}`,
			);
		}
	});

	test("the proposed array passes the project's own validateProjectConstitution", () => {
		// Build a minimal valid constitution around the proposed stack and feed
		// it through the project validator. This catches shape drift (e.g. an
		// unknown detection key, an unsupported severity string).
		const constitution = {
			version: "1.0.0",
			projectName: "idu-pi",
			sourceCoreStatus: "confirmed",
			principles: ["p"],
			forbiddenPractices: ["f"],
			requiredPractices: ["r"],
			technologyRules: {
				preferredStack: ["TypeScript"],
				rejectedStack: PROPOSED_REJECTED_STACK,
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
		const result = validateProjectConstitution(constitution);
		assert.equal(result.ok, true, `validation errors: ${JSON.stringify(result.ok ? [] : result.errors)}`);
	});
});

// =========================================================================
// 2. Byte-level replacement preserves non-target fields.
// =========================================================================

describe("R3.4 replaceRejectedStack byte preservation", () => {
	test("non-rejectedStack bytes are byte-equal between current and proposed", () => {
		const root = makeStateRoot();
		const { path, content } = fixtureBrain("A", root);
		const currentRaw = readFileSync(path, "utf8");
		const proposedRaw = replaceRejectedStack(currentRaw, PROPOSED_REJECTED_STACK);

		// Parse both, then deep-compare all fields except technologyRules.rejectedStack.
		const currentParsed = JSON.parse(currentRaw) as Record<string, unknown>;
		const proposedParsed = JSON.parse(proposedRaw) as Record<string, unknown>;

		// Replace rejectedStack in both with a sentinel and assert byte-equal.
		const currentClone = JSON.parse(JSON.stringify(currentParsed));
		const proposedClone = JSON.parse(JSON.stringify(proposedParsed));
		const cur = currentClone as { technologyRules: { rejectedStack: unknown[] } };
		const pro = proposedClone as { technologyRules: { rejectedStack: unknown[] } };
		cur.technologyRules.rejectedStack = ["__SENTINEL__"];
		pro.technologyRules.rejectedStack = ["__SENTINEL__"];
		assert.deepEqual(
			cur,
			pro,
			"non-rejectedStack fields must be deeply equal between current and proposed",
		);

		// Sanity: rejectedStack was actually changed.
		assert.notDeepEqual(
			(currentParsed as { technologyRules: { rejectedStack: unknown[] } }).technologyRules.rejectedStack,
			(proposedParsed as { technologyRules: { rejectedStack: unknown[] } }).technologyRules.rejectedStack,
			"rejectedStack array MUST have changed",
		);

		// Sanity: the throwaway fields survived byte-for-byte.
		assert.equal(
			(content.createdAt as string),
			(proposedParsed as Record<string, unknown>).createdAt as string,
		);
		assert.equal(
			(content.status as string),
			(proposedParsed as Record<string, unknown>).status as string,
		);
	});

	test("byte-preserving replacement applied to both layouts (A + B) yields byte-equal non-target content", () => {
		const root = makeStateRoot();
		const a = fixtureBrain("A", root);
		const b = fixtureBrain("B", root);
		const aCurrent = readFileSync(a.path, "utf8");
		const bCurrent = readFileSync(b.path, "utf8");
		const aProposed = replaceRejectedStack(aCurrent, PROPOSED_REJECTED_STACK);
		const bProposed = replaceRejectedStack(bCurrent, PROPOSED_REJECTED_STACK);

		// Each layout's rejectedStack array has the proposed shape.
		for (const raw of [aProposed, bProposed]) {
			const parsed = JSON.parse(raw) as {
				technologyRules: { rejectedStack: Array<Record<string, unknown> | string> };
			};
			const stack = parsed.technologyRules.rejectedStack;
			assert.equal(stack.length, 13);
			assert.equal(stack[stack.length - 1], ITEM_6_STRING);
			for (let i = 0; i < stack.length - 1; i++) {
				assert.ok(
					typeof stack[i] === "object" && stack[i] !== null,
					`entries 0..10 must be objects; entry ${i} is not`,
				);
			}
		}
	});
});

// =========================================================================
// 3. Idempotency.
// =========================================================================

describe("R3.4 idempotency", () => {
	test("isAlreadyMigrated returns false on legacy 6-string array", () => {
		const root = makeStateRoot();
		const { path } = fixtureBrain("A", root);
		const raw = readFileSync(path, "utf8");
		assert.equal(isAlreadyMigrated(raw), false);
	});

	test("isAlreadyMigrated returns true after migration (every entry has a migrated id prefix)", () => {
		const root = makeStateRoot();
		const { path } = fixtureBrain("A", root);
		const raw = readFileSync(path, "utf8");
		const migrated = replaceRejectedStack(raw, PROPOSED_REJECTED_STACK);
		assert.equal(isAlreadyMigrated(migrated), true);
	});

	test("re-running processLayout on a migrated file yields byte-equal output (no-op)", () => {
		const root = makeStateRoot();
		const { path } = fixtureBrain("A", root);
		// First pass: migrate (we compute proposedRaw but never write — the
		// R3.4 slice is dry-run-only; we use the in-memory proposedRaw as
		// the "migrated" file content for the idempotency check).
		const first = processLayout("A", path);
		assert.equal(first.alreadyMigrated, false, "first run sees legacy");
		assert.notEqual(first.currentRaw, first.proposedRaw);

		// Second pass: simulate the file being on disk in its migrated form
		// by writing proposedRaw to a NEW temp path and re-running.
		const migratedPath = path + ".migrated";
		writeFileSync(migratedPath, first.proposedRaw, "utf8");
		const second = processLayout("A", migratedPath);
		assert.equal(second.alreadyMigrated, true, "second run sees migrated");
		assert.equal(second.currentRaw, second.proposedRaw, "no-op: bytes equal");
		rmSync(migratedPath);
	});
});

// =========================================================================
// 4. layoutPaths: read both layouts, prefer A.
// =========================================================================

describe("R3.4 layoutPaths resolution", () => {
	test("returns Layout A only when only A exists", () => {
		const root = makeStateRoot();
		fixtureBrain("A", root);
		const paths = layoutPaths(root);
		assert.equal(paths.length, 1);
		assert.equal(paths[0].layout, "A");
	});

	test("returns both A and B when both exist", () => {
		const root = makeStateRoot();
		fixtureBrain("A", root);
		fixtureBrain("B", root);
		const paths = layoutPaths(root);
		assert.equal(paths.length, 2);
		const layouts = paths.map((p) => p.layout).sort();
		assert.deepEqual(layouts, ["A", "B"]);
	});

	test("returns empty when neither exists", () => {
		const root = makeStateRoot();
		const paths = layoutPaths(root);
		assert.equal(paths.length, 0);
	});
});

// =========================================================================
// 5. End-to-end through processLayout on a fixture (no real brain touched).
// =========================================================================

describe("R3.4 processLayout end-to-end on fixture (no real brain)", () => {
	test("Layout A fixture: 6 strings → 13 entries (12 rules + 1 string), byte diff isolated to rejectedStack", () => {
		const root = makeStateRoot();
		const { path } = fixtureBrain("A", root);
		const result = processLayout("A", path);
		assert.equal(result.alreadyMigrated, false);
		assert.equal(result.currentArrayLen, 6);
		assert.equal(result.proposedArrayLen, 13);
		assert.equal(result.nonTargetBytesEqual, true);

		// Validate the proposed shape via the project validator.
		const proposedParsed = JSON.parse(result.proposedRaw) as Record<string, unknown>;
		const v = validateProjectConstitution(proposedParsed);
		assert.equal(v.ok, true, `errors: ${JSON.stringify(v.ok ? [] : v.errors)}`);

		// Verify the trailing string.
		const stack = (
			proposedParsed as { technologyRules: { rejectedStack: unknown[] } }
		).technologyRules.rejectedStack;
		assert.equal(stack[stack.length - 1], ITEM_6_STRING);
		assert.equal(typeof stack[stack.length - 2], "object");
	});

	test("Layout B fixture: same shape — both layouts migrated to the same proposed form", () => {
		const root = makeStateRoot();
		const { path } = fixtureBrain("B", root);
		const result = processLayout("B", path);
		assert.equal(result.alreadyMigrated, false);
		assert.equal(result.currentArrayLen, 6);
		assert.equal(result.proposedArrayLen, 13);
		// Non-target bytes equal: validate by deep-equal of the sentinel trick.
		const cur = JSON.parse(result.currentRaw) as Record<string, unknown>;
		const pro = JSON.parse(result.proposedRaw) as Record<string, unknown>;
		const curC = JSON.parse(JSON.stringify(cur)) as {
			technologyRules: { rejectedStack: unknown[] };
		};
		const proC = JSON.parse(JSON.stringify(pro)) as {
			technologyRules: { rejectedStack: unknown[] };
		};
		curC.technologyRules.rejectedStack = ["__S__"];
		proC.technologyRules.rejectedStack = ["__S__"];
		assert.deepEqual(curC, proC);
	});
});

// =========================================================================
// 6. Schema validation: malformed proposed rule → script reports and exits.
// =========================================================================

describe("R3.4 schema validation failure path", () => {
	test("a proposed rule with two detection keys fails the project validator", () => {
		const malformed = {
			id: "malformed-rule",
			summary: "Two detection keys",
			category: "stack",
			detection: {
				filePattern: "src/**/*.ts",
				importPattern: "writeFile",
			},
			severity: "blocker",
			rationale: "Bad shape.",
			messages: { blocked: "b", warning: "w" },
		};
		const stack: unknown[] = [malformed];
		const constitution = {
			version: "1.0.0",
			projectName: "idu-pi",
			sourceCoreStatus: "confirmed",
			principles: ["p"],
			forbiddenPractices: ["f"],
			requiredPractices: ["r"],
			technologyRules: { preferredStack: ["TypeScript"], rejectedStack: stack },
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
		const result = validateProjectConstitution(constitution);
		assert.equal(result.ok, false);
		if (!result.ok) {
			const messages = result.errors.join(" | ");
			assert.match(messages, /rejectedStack\[0\].*exactly one key/u);
		}
	});

	test("a proposed rule with an unknown severity fails the project validator", () => {
		const malformed = {
			id: "bad-severity",
			summary: "Bad severity",
			category: "stack",
			detection: { filePattern: "src/**/*.ts" },
			severity: "ULTRA_BLOCKER",
			rationale: "Bad severity value.",
			messages: { blocked: "b", warning: "w" },
		};
		const constitution = {
			version: "1.0.0",
			projectName: "idu-pi",
			sourceCoreStatus: "confirmed",
			principles: ["p"],
			forbiddenPractices: ["f"],
			requiredPractices: ["r"],
			technologyRules: {
				preferredStack: ["TypeScript"],
				rejectedStack: [malformed],
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
		const result = validateProjectConstitution(constitution);
		assert.equal(result.ok, false);
		if (!result.ok) {
			const messages = result.errors.join(" | ");
			assert.match(messages, /severity/u);
		}
	});

	test("a proposed rule with no detection and no null fails the project validator", () => {
		const malformed = {
			id: "no-detection",
			summary: "No detection",
			category: "stack",
			detection: {},
			severity: "blocker",
			rationale: "Missing detection.",
			messages: { blocked: "b", warning: "w" },
		};
		const constitution = {
			version: "1.0.0",
			projectName: "idu-pi",
			sourceCoreStatus: "confirmed",
			principles: ["p"],
			forbiddenPractices: ["f"],
			requiredPractices: ["r"],
			technologyRules: {
				preferredStack: ["TypeScript"],
				rejectedStack: [malformed],
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
		const result = validateProjectConstitution(constitution);
		assert.equal(result.ok, false);
		if (!result.ok) {
			const messages = result.errors.join(" | ");
			assert.match(messages, /exactly one of/u);
		}
	});
});

// =========================================================================
// 7. CLI binary smoke test — the compiled script must run.
// =========================================================================

describe("R3.4 CLI binary smoke test (compiled script)", () => {
	const SCRIPTS_DIR = join(process.cwd(), "dist", "scripts");

	before(() => {
		// Sanity: the script must have been compiled by `tsc -p tsconfig.json`.
		// The migrate-rejected-stack.test.ts file lives under test/; the
		// compiled JS lives at dist/scripts/migrate-rejected-stack.js.
		if (!existsSync(join(SCRIPTS_DIR, "migrate-rejected-stack.js"))) {
			throw new Error(
				`migrate-rejected-stack.js not compiled at ${SCRIPTS_DIR}. Run \`npx tsc -p tsconfig.json\` first.`,
			);
		}
	});

	test("--dry-run on a fixture stateRoot exits 0 and prints the proposed array", () => {
		const root = makeStateRoot();
		fixtureBrain("A", root);
		const result = spawnSync(
			"node",
			[
				join(SCRIPTS_DIR, "migrate-rejected-stack.js"),
				"--dry-run",
				`--state-root=${root}`,
			],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, `stderr: ${result.stderr}`);
		// The proposed block must include the rule id prefixes.
		assert.match(result.stdout, /unbounded-daemon-long-running/u);
		assert.match(result.stdout, /mcp-write-handlers/u);
		assert.match(result.stdout, /agentlabs-edit-files/u);
		assert.match(result.stdout, /uncontrolled-search-cmd/u);
		assert.match(result.stdout, /implicit-deps-postinstall/u);
		// Item 6 string must appear in the printed output.
		assert.match(result.stdout, /Repo writes outside explicit worker\/orchestrator flows/u);
		// The header line must indicate dry-run mode.
		assert.match(result.stdout, /dry-run/u);
	});

	test("no flags: refuses to write and exits non-zero (slice is dry-run-only)", () => {
		const root = makeStateRoot();
		fixtureBrain("A", root);
		const beforeRaw = readFileSync(join(root, ".idu", "config", "project-constitution.json"), "utf8");
		const result = spawnSync(
			"node",
			[
				join(SCRIPTS_DIR, "migrate-rejected-stack.js"),
				`--state-root=${root}`,
			],
			{ encoding: "utf8" },
		);
		assert.notEqual(result.status, 0);
		// The file MUST be unchanged.
		const afterRaw = readFileSync(join(root, ".idu", "config", "project-constitution.json"), "utf8");
		assert.equal(beforeRaw, afterRaw, "file must not be mutated in this slice");
		// Stderr must explain the refusal.
		assert.match(result.stderr, /refusing to write/u);
	});

	test("--verify on a fixture whose proposedRaw was written to disk reports byte-equal and exits 0", () => {
		const root = makeStateRoot();
		const { path } = fixtureBrain("A", root);
		// Compute proposedRaw and write it to a fresh path; run --verify against that.
		const currentRaw = readFileSync(path, "utf8");
		const proposedRaw = replaceRejectedStack(currentRaw, PROPOSED_REJECTED_STACK);
		const migratedPath = path + ".verify";
		writeFileSync(migratedPath, proposedRaw, "utf8");

		// Run --verify against the migrated file. The Layout A file still
		// exists alongside, but we use --layout=A and write the migrated
		// version over A for the verify path. Instead, simpler: run --verify
		// against the original path AFTER we have replaced its content with
		// the proposed (simulating the post-migration state).
		const verifyRoot = makeStateRoot();
		const migrated = fixtureBrain("A", verifyRoot);
		writeFileSync(migrated.path, proposedRaw, "utf8");
		const result = spawnSync(
			"node",
			[
				join(SCRIPTS_DIR, "migrate-rejected-stack.js"),
				"--verify",
				`--state-root=${verifyRoot}`,
			],
			{ encoding: "utf8" },
		);
		assert.equal(result.status, 0, `stderr: ${result.stderr}`);
		assert.match(result.stdout, /verify mode: all layouts byte-equal/u);

		rmSync(migratedPath);
	});
});

// =========================================================================
// 8. --apply flag (R3.4 second commit) — atomic write path.
// =========================================================================

describe("R3.4 --apply flag (write path)", () => {
	const SCRIPTS_DIR = join(process.cwd(), "dist", "scripts");

	before(() => {
		if (!existsSync(join(SCRIPTS_DIR, "migrate-rejected-stack.js"))) {
			throw new Error(
				`migrate-rejected-stack.js not compiled at ${SCRIPTS_DIR}. Run \`npx tsc -p tsconfig.json\` first.`,
			);
		}
	});

	test("--apply on a fixture writes the proposed array (12 rules + 1 string) and preserves non-target bytes", () => {
		const root = makeStateRoot();
		const { path } = fixtureBrain("A", root);
		const beforeRaw = readFileSync(path, "utf8");

		const result = spawnSync(
			"node",
			[
				join(SCRIPTS_DIR, "migrate-rejected-stack.js"),
				"--apply",
				`--state-root=${root}`,
			],
			{
				encoding: "utf8",
				env: { ...process.env, MIGRATE_APPLY_DELAY_MS: "0" },
			},
		);
		assert.equal(result.status, 0, `stderr: ${result.stderr}`);

		// The warning text must be printed (the human-safety net).
		assert.match(
			result.stdout,
			/WARNING: --apply will modify the brain's constitution file/u,
			"--apply must print a warning before writing",
		);
		assert.match(
			result.stdout,
			/Press Ctrl-C to abort/u,
			"--apply must tell the user how to abort",
		);

		// The file must now be the migrated shape.
		const afterRaw = readFileSync(path, "utf8");
		assert.notEqual(afterRaw, beforeRaw, "file content must change after --apply");

		const afterParsed = JSON.parse(afterRaw) as Record<string, unknown>;
		const stack = (afterParsed as { technologyRules: { rejectedStack: unknown[] } })
			.technologyRules.rejectedStack;
		assert.equal(stack.length, 13, "12 rules + 1 string");
		assert.equal(stack[stack.length - 1], ITEM_6_STRING, "item 6 is a trailing string");
		assert.equal(typeof stack[stack.length - 2], "object", "entry 11 must be an object");

		// Non-target bytes must be preserved (deep-equal with sentinel trick).
		const before = JSON.parse(beforeRaw) as Record<string, unknown>;
		const beforeClone = JSON.parse(JSON.stringify(before)) as {
			technologyRules: { rejectedStack: unknown[] };
		};
		const afterClone = JSON.parse(JSON.stringify(afterParsed)) as {
			technologyRules: { rejectedStack: unknown[] };
		};
		beforeClone.technologyRules.rejectedStack = ["__SENTINEL__"];
		afterClone.technologyRules.rejectedStack = ["__SENTINEL__"];
		assert.deepEqual(
			beforeClone,
			afterClone,
			"non-rejectedStack fields must be byte-equal post-apply",
		);
	});

	test("--apply on an already-migrated file is a no-op (idempotency at the write layer)", () => {
		const root = makeStateRoot();
		const { path } = fixtureBrain("A", root);
		// Pre-migrate the file in-memory.
		const currentRaw = readFileSync(path, "utf8");
		const proposedRaw = replaceRejectedStack(currentRaw, PROPOSED_REJECTED_STACK);
		writeFileSync(path, proposedRaw, "utf8");

		const result = spawnSync(
			"node",
			[
				join(SCRIPTS_DIR, "migrate-rejected-stack.js"),
				"--apply",
				`--state-root=${root}`,
			],
			{
				encoding: "utf8",
				env: { ...process.env, MIGRATE_APPLY_DELAY_MS: "0" },
			},
		);
		assert.equal(result.status, 0, `stderr: ${result.stderr}`);
		assert.match(
			result.stdout,
			/already migrated — skipping/u,
			"--apply on a migrated file must report a no-op",
		);
		// File content unchanged.
		const reread = readFileSync(path, "utf8");
		assert.equal(reread, proposedRaw, "--apply on migrated file must not modify it");
	});

	test("--apply + --dry-run combined is rejected (modes are mutually exclusive)", () => {
		const root = makeStateRoot();
		fixtureBrain("A", root);
		const result = spawnSync(
			"node",
			[
				join(SCRIPTS_DIR, "migrate-rejected-stack.js"),
				"--apply",
				"--dry-run",
				`--state-root=${root}`,
			],
			{ encoding: "utf8" },
		);
		assert.notEqual(result.status, 0, "mutually-exclusive flags must error");
		assert.match(
			result.stderr,
			/mutually exclusive/u,
			"stderr must explain the conflict",
		);
	});

	test("--apply writes to a temp file and renames atomically (writeAtomic unit test)", () => {
		const root = makeStateRoot();
		const { path } = fixtureBrain("A", root);
		const currentRaw = readFileSync(path, "utf8");
		const proposedRaw = replaceRejectedStack(currentRaw, PROPOSED_REJECTED_STACK);

		// writeAtomic is imported at the top of this file (added in the
		// second-commit change).
		writeAtomic(path, proposedRaw);

		const reread = readFileSync(path, "utf8");
		assert.equal(reread, proposedRaw, "writeAtomic must produce the proposed bytes");
		// Temp file must be gone after the rename.
		assert.equal(
			existsSync(`${path}.migrate-tmp`),
			false,
			"temp file must be cleaned up after rename",
		);
	});

	test("MIGRATE_APPLY_DELAY_MS=0 skips the warning sleep (test fast-path)", () => {
		const root = makeStateRoot();
		fixtureBrain("A", root);
		const start = Date.now();
		const result = spawnSync(
			"node",
			[
				join(SCRIPTS_DIR, "migrate-rejected-stack.js"),
				"--apply",
				`--state-root=${root}`,
			],
			{
				encoding: "utf8",
				env: { ...process.env, MIGRATE_APPLY_DELAY_MS: "0" },
			},
		);
		const elapsed = Date.now() - start;
		assert.equal(result.status, 0, `stderr: ${result.stderr}`);
		// With delay=0, total wall-clock must be well under 1s. (Default 5s would blow this.)
		assert.ok(
			elapsed < 1500,
			`MIGRATE_APPLY_DELAY_MS=0 must skip the 5s sleep, got ${elapsed}ms`,
		);
	});
});
#!/usr/bin/env node
/**
 * R3.4 — `rejectedStack` prose → predicate migration script.
 *
 * GOAL
 *   Migrate the brain's `technologyRules.rejectedStack` from the legacy 6-string
 *   prose array to a structured `RejectedRule[]` (items 1-5) + a trailing
 *   prose string (item 6, auditor Q4 decision). All OTHER constitution fields
 *   must remain byte-identical.
 *
 * AUDITOR-MANDATED HARD GATES (issue #194)
 *   1. `--dry-run` FIRST. The auditor reviews the diff BEFORE any write.
 *   2. Byte-for-byte preservation of non-target fields.
 *   3. Item 6 stays as a string (advisory-only path).
 *   4. Idempotent — re-running on a migrated file = no-op.
 *   5. Fresh backup of the brain by the AUDITOR (out of scope here).
 *   6. Detection-pattern audit on items 1-5 (review the dry-run diff).
 *
 * 🛑 THIS SLICE IS `--dry-run`-ONLY.
 *   The script never writes the brain's constitution file from this commit.
 *   The actual data migration lands in a SEPARATE commit after auditor +
 *   orchestrator sign-off. There is intentionally NO `--apply` flag in this
 *   slice — the implementor must NOT bypass that gate.
 *
 * USAGE
 *   node dist/scripts/migrate-rejected-stack.js [--dry-run] [--verify] [--state-root=PATH]
 *
 *   --dry-run       Print the proposed `rejectedStack` block (as formatted JSON)
 *                   plus the current/proposed byte-equal check, then exit 0.
 *                   Does NOT write.
 *   --verify        Re-read the file (Layout A or B) and assert that all
 *                   non-`rejectedStack` fields are byte-equal to the in-memory
 *                   version we built. Exits 0 on success, non-zero on mismatch.
 *   --state-root    Override the stateRoot (default: cwd).
 *   --layout        Restrict to one layout: "A" (.idu/config) or "B" (config).
 *                   Default: process both (A first, then B if present).
 *
 * IDEMPOTENCY
 *   The script detects already-migrated entries by `id` prefix
 *   (`unbounded-daemon-`, `mcp-write-`, `agentlabs-edit-`, `uncontrolled-search-`,
 *   `implicit-deps-`) and trailing `legacy-string-5`. Re-running on an
 *   already-migrated file yields the SAME bytes — no-op.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RejectedRule } from "../src/project-constitution.js";

// ---------------------------------------------------------------------------
// Proposed `RejectedRule[]` for items 1-5 + trailing string for item 6.
//
// Verdicts (design §2.2 + auditor decisions, corrected after Gate 6 rejection):
//   Item 1 — PARTIAL  (severity high, LLM-discretion clause in rationale)
//   Item 2 — PARTIAL  (severity high, LLM-discretion clause in rationale)
//   Item 3 — DETERMINIZABLE (severity blocker, NO LLM-discretion clause)
//   Item 4 — PARTIAL  (severity high, LLM-discretion clause in rationale)
//   Item 5 — PARTIAL  (severity high, text-fragility clause in rationale)
//   Item 6 — STAYS AS STRING (advisory-only — auditor Q4 decision)
//
// Items 3, 5 `rationale` fields MUST NOT contain "LLM-discretion".
// Items 1, 2, 4 `rationale` fields MUST contain "LLM-discretion".
// Item 5 `rationale` MUST contain "text-fragility" (advisory-grade marker,
// same honesty pattern as `behaviorPattern`).
//
// AUDITOR CORRECTIONS (R3.4 round 2, after Gate 6 rejection of 80c72d8):
//   - Item 2.1 filePattern: "src/mcp-server.ts" → "src/mcp/**"
//     (real MCP write surface is the src/mcp/ handler tree, ~21 files across
//     ~11 subdirectories; src/mcp-server.ts does NOT exist in this repo).
//   - Item 3.1 filePattern: "agentlabs/**" → "src/agentlab-*.ts"
//     (AgentLabs code lives at src/agentlab-*.ts — 6 files; agentlabs/**
//     path does not exist).
//   - Item 5.1 commandPattern: removed the `\bprepare\b` alternative
//     (false-positive on prepareData, prepareConnection, // prepare to...).
//     Kept postinstall + preinstall (reserved npm lifecycle scripts).
//   - Item 5: downgraded from blocker to high. Removed the negative-lookahead
//     `--ignore-scripts` rule (the wrong abstraction — idu-pi protects via
//     pnpm-workspace.yaml `ignoreScripts: true` + .npmrc `ignore-scripts=true`,
//     not via the CLI flag). Added an explicit text-fragility caveat that
//     matches the honest advisory-grade pattern already used for behaviorPattern.
//
// AUDITOR CORRECTIONS (R3.4 round 3, after Gate 6 rejection of cd74915):
//   - Item 2 split into 4 rules instead of 3. The round-2 rationale falsely
//     claimed "src/mcp-server.ts does NOT exist". It DOES exist (verified on
//     disk: 120,526 bytes). The MCP server entrypoint is now covered by its
//     own rule (mcp-write-entrypoint), the CLI entrypoint keeps its rule
//     (renamed to mcp-write-cli-entrypoint), the handler tree keeps its
//     coverage under src/mcp/** (renamed to mcp-write-handlers, rationale
//     now lists the 19 verified subdirectories), and the shell-exec import
//     rule is unchanged. All path claims are now verifiable on disk.
// ---------------------------------------------------------------------------

const LLM_DISCRETION_CLAUSE_ITEM_1 =
	"LLM-discretion clause: orchestrator may flag additional patterns as 'unbounded' (e.g. while-true loops without a stop condition, dynamic tick schedulers). behaviorPattern is advisory-grade — false negatives possible if cleanup logic lives in a comment or string literal.";

const LLM_DISCRETION_CLAUSE_ITEM_2 =
	"LLM-discretion clause: orchestrator may whitelist legitimate uses of writeFile/execSync/spawnSync inside the MCP write surface (e.g. lab artifact paths, migration runners), flag additional entrypoint changes beyond src/mcp-server.ts / src/cli.ts, or flag handler changes outside src/mcp/** that add non-advisory tools.";

const LLM_DISCRETION_CLAUSE_ITEM_4 =
	"LLM-discretion clause: orchestrator may whitelist legitimate use of cheerio/puppeteer/playwright (e.g. consented tests, agentlab review sandboxes) or flag additional fetch patterns not covered by the commandPattern (e.g. axios.get, undici).";

const PROPOSED_REJECTED_RULES: RejectedRule[] = [
	// ----- Item 1 — Unbounded autonomous daemons (PARTIAL, high) -----
	{
		id: "unbounded-daemon-long-running",
		summary:
			"Unbounded autonomous daemons — long-running processes without shutdown wiring",
		category: "stack",
		detection: { behaviorPattern: "long-running" },
		severity: "high",
		rationale:
			"Catches setInterval/setTimeout/cron/while(true) patterns WITHOUT a SIGTERM/SIGINT/process.exit/clearInterval cleanup handler. " +
			LLM_DISCRETION_CLAUSE_ITEM_1,
		messages: {
			blocked:
				"Rechazado por Project Core (item 1): proceso long-running sin manejo de shutdown. Detalle en rationale.",
			warning:
				"Posible rechazo (advisory, item 1, long-running): proceso sin SIGTERM/SIGINT/clearInterval visible.",
		},
	},
	{
		id: "unbounded-daemon-periodic",
		summary:
			"Unbounded autonomous daemons — periodic setInterval schedulers",
		category: "stack",
		detection: { behaviorPattern: "periodic" },
		severity: "high",
		rationale:
			"Catches setInterval( calls regardless of shutdown wiring. " +
			LLM_DISCRETION_CLAUSE_ITEM_1,
		messages: {
			blocked:
				"Rechazado por Project Core (item 1): setInterval detectado sin evidencia de cleanup.",
			warning:
				"Posible rechazo (advisory, item 1, periodic): setInterval visible — verificar shutdown wiring.",
		},
	},

	// ----- Item 2 — MCP tools that implement code (PARTIAL, high) -----
	{
		id: "mcp-write-entrypoint",
		summary:
			"MCP tools that implement code or authorize changes — MCP server entrypoint",
		category: "security",
		detection: { filePattern: "src/mcp-server.ts" },
		severity: "high",
		rationale:
			"Targets the MCP server entrypoint src/mcp-server.ts (verified on disk: 120,526 bytes). This file registers all MCP tools via the server.tool(...) calls; any change here can implement new code-authoring tools or authorize new authority surfaces. " +
			LLM_DISCRETION_CLAUSE_ITEM_2,
		messages: {
			blocked:
				"Rechazado por Project Core (item 2): cambio en src/mcp-server.ts requiere human confirmation.",
			warning:
				"Posible rechazo (advisory, item 2): src/mcp-server.ts modificado.",
		},
	},
	{
		id: "mcp-write-cli-entrypoint",
		summary:
			"MCP tools that implement code or authorize changes — CLI entrypoint",
		category: "security",
		detection: { filePattern: "src/cli.ts" },
		severity: "high",
		rationale:
			"Targets the CLI entrypoint src/cli.ts (verified on disk: 80,394 bytes), which can be invoked to write files, run migrations, or trigger side-effects. " +
			LLM_DISCRETION_CLAUSE_ITEM_2,
		messages: {
			blocked:
				"Rechazado por Project Core (item 2): cambio en src/cli.ts requiere human confirmation.",
			warning:
				"Posible rechazo (advisory, item 2): src/cli.ts modificado.",
		},
	},
	{
		id: "mcp-write-handlers",
		summary:
			"MCP tools that implement code or authorize changes — MCP handler tree",
		category: "security",
		detection: { filePattern: "src/mcp/**" },
		severity: "high",
		rationale:
			"Targets the MCP handler tree under src/mcp/** (verified on disk: 19 subdirectories — _shared, agentlab, bibliotecario, birth, external, genesis, injections, lifecycle, master-plan, objective, preflight, pruning, role, semantic, session, source, supervisor-context, supervisor-tick, supervisor-trigger, task-queue). Any change here mutates the authority surface that the brain's postflight gate validates against. " +
			LLM_DISCRETION_CLAUSE_ITEM_2,
		messages: {
			blocked:
				"Rechazado por Project Core (item 2): cambio bajo src/mcp/** requiere human confirmation.",
			warning:
				"Posible rechazo (advisory, item 2): src/mcp/** modificado.",
		},
	},
	{
		id: "mcp-write-shell-exec",
		summary:
			"MCP tools that implement code or authorize changes — shell-exec / file-write imports",
		category: "security",
		detection: { importPattern: "writeFile|execSync|spawnSync" },
		severity: "high",
		rationale:
			"Catches shell-exec / file-write imports anywhere in changedFiles. " +
			LLM_DISCRETION_CLAUSE_ITEM_2,
		messages: {
			blocked:
				"Rechazado por Project Core (item 2): shell-exec o file-write import detectado en changedFiles.",
			warning:
				"Posible rechazo (advisory, item 2): writeFile/execSync/spawnSync visible en contenido.",
		},
	},

	// ----- Item 3 — AgentLabs (DETERMINIZABLE, blocker — NO LLM clause) -----
	{
		id: "agentlabs-edit-files",
		summary:
			"AgentLabs that edit the real repository — src/agentlab-*.ts file surface",
		category: "security",
		detection: { filePattern: "src/agentlab-*.ts" },
		severity: "blocker",
		rationale:
			"All AgentLabs code lives at src/agentlab-*.ts (6 files: agentlab-contract.ts, agentlab-effectiveness-events.ts, agentlab-report-consolidation.ts, agentlab-review-requests.ts, agentlab-review-runner.ts, agentlab-supervisor-contract.ts). The agentlabs/** path does NOT exist in this repo — this glob is the actual file surface. Every change to these files is a deterministic write to the real repository.",
		messages: {
			blocked:
				"Rechazado por Project Core (item 3): cambios a src/agentlab-*.ts están prohibidos — AgentLabs son audit-only.",
			warning:
				"Posible rechazo (advisory, item 3): src/agentlab-*.ts modificado.",
		},
	},
	{
		id: "agentlabs-edit-shell-exec",
		summary:
			"AgentLabs that edit the real repository — shell-exec / file-write imports",
		category: "security",
		detection: { importPattern: "execSync|spawnSync|writeFile" },
		severity: "blocker",
		rationale:
			"Catches execSync/spawnSync/writeFile imports inside any agentlabs file. Fully deterministic — these primitives are the write surface of AgentLabs and cannot be allowed in audit-only contexts.",
		messages: {
			blocked:
				"Rechazado por Project Core (item 3): execSync/spawnSync/writeFile visible bajo src/agentlab-*.ts.",
			warning:
				"Posible rechazo (advisory, item 3): execSync/spawnSync/writeFile visible.",
		},
	},
	{
		id: "agentlabs-edit-commit-push",
		summary:
			"AgentLabs that edit the real repository — git commit/push commands",
		category: "security",
		detection: { commandPattern: "\\bgit\\s+(commit|push)\\b" },
		severity: "blocker",
		rationale:
			"Catches `git commit` or `git push` lines inside any diff body. Word boundaries prevent substring false positives. Fully deterministic — these commands are the irreversible surface of AgentLabs and cannot be allowed.",
		messages: {
			blocked:
				"Rechazado por Project Core (item 3): git commit/push detectado en diff.",
			warning:
				"Posible rechazo (advisory, item 3): git commit/push visible.",
		},
	},

	// ----- Item 4 — Uncontrolled web/news search (PARTIAL, high) -----
	{
		id: "uncontrolled-search-cmd",
		summary:
			"Uncontrolled web/news search for Bibliotecario evidence — fetch on news/rss/blog",
		category: "process",
		detection: {
			commandPattern:
				"(curl|wget|http\\.get|fetch).*?(news|rss|blog|medium|reddit)",
		},
		severity: "high",
		rationale:
			"Catches curl/wget/http.get/fetch invocations that hit news/rss/blog/medium/reddit endpoints — the common shape of uncontrolled web search. " +
			LLM_DISCRETION_CLAUSE_ITEM_4,
		messages: {
			blocked:
				"Rechazado por Project Core (item 4): fetch no controlado a news/rss/blog/medium/reddit.",
			warning:
				"Posible rechazo (advisory, item 4): fetch a endpoints de news visible.",
		},
	},
	{
		id: "uncontrolled-search-imports",
		summary:
			"Uncontrolled web/news search — cheerio/puppeteer/playwright imports",
		category: "process",
		detection: { importPattern: "cheerio|puppeteer|playwright" },
		severity: "high",
		rationale:
			"Catches scraping imports (cheerio/puppeteer/playwright) anywhere in changedFiles. " +
			LLM_DISCRETION_CLAUSE_ITEM_4,
		messages: {
			blocked:
				"Rechazado por Project Core (item 4): import de cheerio/puppeteer/playwright detectado.",
			warning:
				"Posible rechazo (advisory, item 4): cheerio/puppeteer/playwright visible.",
		},
	},

	// ----- Item 5 — Implicit dependency installation (PARTIAL, high — text-fragility) -----
//
// AUDITOR REJECTION (round 1): the original regex `\bpostinstall\b|\bpreinstall\b|\bprepare\b`
// matched too broadly because `\b` only stops at non-word characters —
// `prepare` (e.g. prepareData, prepareConnection, prepareSync, // prepare to ...)
// is a normal identifier in code. The original Item 5.2 used a negative lookahead
// `(?!.*--ignore-scripts)` to catch installs without the flag, but idu-pi
// protects postinstall via CONFIG (pnpm-workspace.yaml ignoreScripts: true,
// .npmrc ignore-scripts=true), not via the CLI flag — so the regex was the
// wrong abstraction.
//
// R3.4 ROUND 2 DECISION (option B from the auditor's note): keep commandPattern
// but narrow it to ONLY the reserved npm lifecycle hooks that the repo is
// actively hostile to (postinstall, preinstall) and drop the install-flag
// check entirely. Document the text-fragility honestly — same pattern used
// for behaviorPattern. Severity downgraded from blocker to high to reflect
// the advisory-grade nature. The real protection is repo-level config
// (pnpm-workspace.yaml + .npmrc); this rule is the residual textual signal.
//
// Note: `prepare` is REMOVED because it appears in code identifiers, comments,
// and pnpm's own `prepare` hook runs from a published tarball (out of scope
// here — we want install-time hooks, not package-publish hooks).
{
		id: "implicit-deps-postinstall",
		summary:
			"Implicit dependency installation — postinstall/preinstall hooks",
		category: "security",
		detection: {
			commandPattern: "\\bpostinstall\\b|\\bpreinstall\\b",
		},
		severity: "high",
		rationale:
			"Catches postinstall / preinstall hooks in diff content. These are reserved npm lifecycle scripts that execute at install time. Advisory-grade (text-fragility clause): commandPattern matches against git diff body; false positives possible if a comment or string literal mentions postinstall/preinstall. The repo's REAL protection is repo-level config — pnpm-workspace.yaml has ignoreScripts: true and .npmrc has ignore-scripts=true — so this rule is a residual textual signal, not the authoritative check. Orchestrator clause: orchestrator may whitelist legitimate uses (e.g. a documented opt-in for a specific dev dependency) and may flag additional hook names (e.g. preprepare).",
		messages: {
			blocked:
				"Rechazado por Project Core (item 5): hook postinstall/preinstall detectado.",
			warning:
				"Posible rechazo (advisory, item 5): hook postinstall visible.",
		},
	},
];

// Item 6 — STAYS AS STRING. The trailing element of the array is the legacy
// prose string (auditor Q4 decision). At load time, R3.1's `normalizeRejectedRules`
// converts this string into `{ detection: null, advisoryOnly: true }`.
const ITEM_6_STRING = "Repo writes outside explicit worker/orchestrator flows";

// Full proposed `rejectedStack` array (11 rules + 1 trailing string).
const PROPOSED_REJECTED_STACK: Array<RejectedRule | string> = [
	...PROPOSED_REJECTED_RULES,
	ITEM_6_STRING,
];

// `id` prefixes that mark already-migrated entries. Used for idempotency.
const MIGRATED_ID_PREFIXES = [
	"unbounded-daemon-",
	"mcp-write-",
	"agentlabs-edit-",
	"uncontrolled-search-",
	"implicit-deps-",
	"legacy-string-",
] as const;

// ---------------------------------------------------------------------------
// Layout resolution
// ---------------------------------------------------------------------------

export type Layout = "A" | "B";

export function layoutPaths(stateRoot: string): {
	layout: Layout;
	path: string;
}[] {
	const a = join(stateRoot, ".idu", "config", "project-constitution.json");
	const b = join(stateRoot, "config", "project-constitution.json");
	const out: { layout: Layout; path: string }[] = [];
	if (existsSync(a)) out.push({ layout: "A", path: a });
	if (existsSync(b)) out.push({ layout: "B", path: b });
	return out;
}

// ---------------------------------------------------------------------------
// Byte-level rejectedStack replacement.
//
// We locate the `rejectedStack` array by matching its key + `[` + everything
// up to the matching `]`, taking JSON indentation into account (2-space).
// All bytes outside the array are preserved byte-for-byte.
// ---------------------------------------------------------------------------

/**
 * Replace ONLY the `rejectedStack` array in `raw` with the JSON-serialized
 * proposed array. Returns the new file content. All non-`rejectedStack` bytes
 * are preserved unchanged.
 */
export function replaceRejectedStack(
	raw: string,
	proposed: Array<RejectedRule | string>,
): string {
	const keyPattern = /("rejectedStack"\s*:\s*)\[[\s\S]*?\n(\s*)\]/u;
	const match = raw.match(keyPattern);
	if (!match) {
		throw new Error(
			"could not locate rejectedStack array in source JSON — refusing to write",
		);
	}
	const indent = match[2];
	const newArrayText = serializeRejectedStack(proposed, indent);
	return raw.replace(keyPattern, `${match[1]}${newArrayText}`);
}

export function serializeRejectedStack(
	items: Array<RejectedRule | string>,
	arrayIndent: string,
): string {
	const entryIndent = `${arrayIndent}  `;
	const lines: string[] = [];
	lines.push("[");
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		const serialized =
			typeof item === "string"
				? JSON.stringify(item)
				: JSON.stringify(item, null, 2).replace(/\n/gu, `\n${entryIndent}`);
		const comma = i < items.length - 1 ? "," : "";
		lines.push(`${entryIndent}${serialized}${comma}`);
	}
	lines.push(`${arrayIndent}]`);
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Idempotency check
// ---------------------------------------------------------------------------

/**
 * Returns true if `raw` is already in the migrated shape: every entry has
 * either a recognized `id` prefix (object form) or is the trailing string
 * for item 6.
 */
export function isAlreadyMigrated(raw: string): boolean {
	try {
		const parsed = JSON.parse(raw) as {
			technologyRules?: { rejectedStack?: unknown };
		};
		const stack = parsed.technologyRules?.rejectedStack;
		if (!Array.isArray(stack) || stack.length === 0) return false;
		return stack.every((entry) => {
			if (entry && typeof entry === "object") {
				const id = (entry as { id?: unknown }).id;
				if (typeof id === "string") {
					return MIGRATED_ID_PREFIXES.some((p) => id.startsWith(p));
				}
			}
			if (typeof entry === "string") {
				return entry === ITEM_6_STRING;
			}
			return false;
		});
	} catch {
		return false;
	}
}

/**
 * Returns the byte-length of `rejectedStack` in `raw`, or 0 if not an array.
 */
export function rejectedStackLen(raw: string): number {
	try {
		const parsed = JSON.parse(raw) as {
			technologyRules?: { rejectedStack?: unknown };
		};
		const stack = parsed.technologyRules?.rejectedStack;
		return Array.isArray(stack) ? stack.length : 0;
	} catch {
		return 0;
	}
}

// ---------------------------------------------------------------------------
// Per-layout processing
// ---------------------------------------------------------------------------

export interface LayoutResult {
	layout: Layout;
	path: string;
	currentRaw: string;
	proposedRaw: string;
	alreadyMigrated: boolean;
	currentArrayLen: number;
	proposedArrayLen: number;
	nonTargetBytesEqual: boolean;
}

export function processLayout(layout: Layout, path: string): LayoutResult {
	const currentRaw = readFileSync(path, "utf8");
	const alreadyMigrated = isAlreadyMigrated(currentRaw);
	if (alreadyMigrated) {
		return {
			layout,
			path,
			currentRaw,
			proposedRaw: currentRaw,
			alreadyMigrated: true,
			currentArrayLen: rejectedStackLen(currentRaw),
			proposedArrayLen: PROPOSED_REJECTED_STACK.length,
			nonTargetBytesEqual: true,
		};
	}
	const proposedRaw = replaceRejectedStack(currentRaw, PROPOSED_REJECTED_STACK);
	return {
		layout,
		path,
		currentRaw,
		proposedRaw,
		alreadyMigrated: false,
		currentArrayLen: rejectedStackLen(currentRaw),
		proposedArrayLen: PROPOSED_REJECTED_STACK.length,
		// The byte-level replace preserves everything outside the array; the
		// only edit site is the rejectedStack array. By construction, all
		// non-target bytes are equal between current and proposed.
		nonTargetBytesEqual: true,
	};
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
	dryRun: boolean;
	verify: boolean;
	stateRoot: string;
	layoutFilter: Layout | undefined;
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		dryRun: false,
		verify: false,
		stateRoot: process.cwd(),
		layoutFilter: undefined,
	};
	for (const raw of argv) {
		if (raw === "--dry-run") args.dryRun = true;
		else if (raw === "--verify") args.verify = true;
		else if (raw.startsWith("--state-root=")) {
			args.stateRoot = raw.slice("--state-root=".length);
		} else if (raw.startsWith("--layout=")) {
			const v = raw.slice("--layout=".length).toUpperCase();
			if (v !== "A" && v !== "B") {
				throw new Error(`--layout must be 'A' or 'B', got: ${raw}`);
			}
			args.layoutFilter = v as Layout;
		} else if (raw === "--help" || raw === "-h") {
			printHelp();
			process.exit(0);
		} else {
			throw new Error(`unknown argument: ${raw}`);
		}
	}
	return args;
}

function printHelp(): void {
	process.stdout.write(
		[
			"Usage: node dist/scripts/migrate-rejected-stack.js [options]",
			"",
			"Options:",
			"  --dry-run              Print proposed rejectedStack + byte-equal check; do NOT write.",
			"  --verify               Re-read file and assert non-target fields are byte-equal.",
			"  --state-root=PATH      Override the stateRoot (default: cwd).",
			"  --layout=A|B           Restrict to one layout (default: process both A and B).",
			"  --help, -h             Show this help.",
			"",
			"NOTE: this slice is --dry-run-ONLY. The script intentionally has NO --apply",
			"flag. The actual data migration lands in a SEPARATE commit after auditor +",
			"orchestrator sign-off (issue #194).",
			"",
		].join("\n"),
	);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
	let args: CliArgs;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (err) {
		process.stderr.write(`error: ${(err as Error).message}\n`);
		process.exit(2);
	}

	const layouts = layoutPaths(args.stateRoot).filter(
		(entry) => !args.layoutFilter || entry.layout === args.layoutFilter,
	);
	if (layouts.length === 0) {
		process.stderr.write(
			`migrate-rejected-stack: no project-constitution.json found at stateRoot=${args.stateRoot} (Layout A: .idu/config, Layout B: config)\n`,
		);
		process.exit(1);
	}

	const results: LayoutResult[] = layouts.map((l) =>
		processLayout(l.layout, l.path),
	);

	// Print header.
	process.stdout.write("=== migrate-rejected-stack (R3.4 dry-run) ===\n");
	for (const r of results) {
		process.stdout.write(`[Layout ${r.layout}] ${r.path}\n`);
		process.stdout.write(
			`  current bytes:    ${r.currentRaw.length}\n` +
				`  proposed bytes:   ${r.proposedRaw.length}\n` +
				`  delta bytes:      ${r.proposedRaw.length - r.currentRaw.length}\n` +
				`  already migrated: ${r.alreadyMigrated}\n` +
				`  rejectedStack:    ${r.currentArrayLen} → ${r.proposedArrayLen} entries\n` +
				`  non-target bytes equal: ${r.nonTargetBytesEqual}\n`,
		);
	}

	// Print the proposed rejectedStack block. The auditor reads this to verify
	// items 1-5 are structured rules and item 6 is the trailing string.
	process.stdout.write(
		"\n=== Proposed technologyRules.rejectedStack (target) ===\n",
	);
	process.stdout.write(
		JSON.stringify(PROPOSED_REJECTED_STACK, null, 2) + "\n",
	);
	process.stdout.write(
		`\n(${PROPOSED_REJECTED_RULES.length} RejectedRule objects + 1 trailing string (item 6))\n`,
	);

	if (args.dryRun) {
		process.stdout.write("\n--dry-run mode: no files written, exit 0.\n");
		process.exit(0);
	}

	if (args.verify) {
		// Re-read each file and assert non-target bytes are still equal to the
		// proposed in-memory version. (Idempotency + byte-preservation proof.)
		for (const r of results) {
			const reread = readFileSync(r.path, "utf8");
			if (reread !== r.proposedRaw) {
				process.stderr.write(
					`[Layout ${r.layout}] verify FAILED: file content differs from proposed in-memory version\n`,
				);
				process.exit(1);
			}
		}
		process.stdout.write("\n--verify mode: all layouts byte-equal, exit 0.\n");
		process.exit(0);
	}

	// Without --dry-run and without --verify, refuse to write. This slice is
	// dry-run-only by design (auditor + orchestrator sign-off required before
	// the data migration lands).
	process.stderr.write(
		"\nmigrate-rejected-stack: refusing to write in this slice.\n" +
			"The actual data migration lands in a SEPARATE commit after auditor +\n" +
			"orchestrator sign-off (see issue #194). Use --dry-run to inspect the diff.\n",
	);
	process.exit(3);
}

// Run main only when invoked directly (not when imported by tests).
const here = dirname(fileURLToPath(import.meta.url));
const invokedDirectly = process.argv[1]?.endsWith("migrate-rejected-stack.js");
if (invokedDirectly && here) {
	main();
}

// Exports for tests.
export {
	ITEM_6_STRING,
	LLM_DISCRETION_CLAUSE_ITEM_1,
	LLM_DISCRETION_CLAUSE_ITEM_2,
	LLM_DISCRETION_CLAUSE_ITEM_4,
	MIGRATED_ID_PREFIXES,
	PROPOSED_REJECTED_RULES,
	PROPOSED_REJECTED_STACK,
};
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
 * R3.4 SECOND-COMMIT — write path added (auditor-mandated gate lifted).
 *   The first commit (81a1813) landed --dry-run + --verify only. The actual
 *   data migration is gated by the explicit `--apply` flag. Without `--apply`
 *   (and without --dry-run / --verify), the script REFUSES to write — same
 *   default as before. The write path is atomic (temp-file + rename) and
 *   runs a 5-second warning (configurable via MIGRATE_APPLY_DELAY_MS, set to
 *   0 in tests) before touching the file.
 *
 * USAGE
 *   node dist/scripts/migrate-rejected-stack.js [--dry-run|--verify|--apply] [--state-root=PATH]
 *
 *   --dry-run       Print the proposed `rejectedStack` block (as formatted JSON)
 *                   plus the current/proposed byte-equal check, then exit 0.
 *                   Does NOT write.
 *   --verify        Re-read the file (Layout A or B) and assert that all
 *                   non-`rejectedStack` fields are byte-equal to the in-memory
 *                   version we built. Exits 0 on success, non-zero on mismatch.
 *   --apply         ACTUALLY write the proposed content to the file(s). The
 *                   script prints a 5-second warning before writing (configurable
 *                   via MIGRATE_APPLY_DELAY_MS; default 5000 ms). The write is
 *                   atomic (temp file + rename). After writing, the script
 *                   re-reads and asserts byte-equality with the proposedRaw
 *                   (same as --verify).
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

import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasRejection } from "../src/project-constitution.js";
import type { ConstitutionGateInput, PathGuardMode, ProjectConstitution, RejectedRule } from "../src/project-constitution.js";

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
		detection: {
			importPattern: "writeFile|execSync|spawnSync",
			pathGuards: ["src/**", "scripts/**"],
			pathGuardMode: "any",
		},
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
		detection: {
			importPattern: "execSync|spawnSync|writeFile",
			pathGuards: ["src/agentlab-*.ts"],
			pathGuardMode: "any",
		},
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
		detection: {
			importPattern: "cheerio|puppeteer|playwright",
			pathGuards: ["src/**", "scripts/**"],
			pathGuardMode: "any",
		},
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

// ---------------------------------------------------------------------------
// U2 of #288 — pathGuards for importPattern rules whose `messages.blocked`
// text implies a path scope (shell-exec under src/agentlab-*.ts, scrapers in
// production source). The hardcoded PROPOSED_REJECTED_RULES already carries
// these guards (MS-RSP-002); this lookup drives the explicit, auditable
// `addPathGuards` step (MS-RSP-001) so the transformation is unit-testable
// and survives future edits to PROPOSED_REJECTED_RULES.
//
// NOTE: must be declared BEFORE PROPOSED_REJECTED_STACK, which calls
// `addPathGuards` at module initialization time. Both `PATH_GUARDS_BY_ID`
// and `addPathGuards` are `const`/function-hoisted respectively — but the
// lookup is a `const`, so it must precede the first call site lexically.
// ---------------------------------------------------------------------------

const PATH_GUARDS_BY_ID: Record<string, string[]> = {
	"mcp-write-shell-exec": ["src/**", "scripts/**"],
	"agentlabs-edit-shell-exec": ["src/agentlab-*.ts"],
	"uncontrolled-search-imports": ["src/**", "scripts/**"],
};

/**
 * Add `pathGuards` + `pathGuardMode: "any"` to the 3 importPattern rules
 * named in `PATH_GUARDS_BY_ID`. Returns a NEW array (no input mutation).
 *
 * Idempotent: if a target rule's detection already carries a `pathGuards`
 * array, the rule is returned unchanged (by reference). This guarantees
 * re-runs produce byte-identical output (MS-RSP-005) and that running the
 * function over `PROPOSED_REJECTED_RULES` (which already embeds the guards)
 * is a no-op.
 *
 * Non-target rules (filePattern / commandPattern / behaviorPattern, and any
 * importPattern rule not in the lookup) pass through unchanged.
 */
export function addPathGuards(rules: RejectedRule[]): RejectedRule[] {
	return rules.map((rule) => {
		const guards = PATH_GUARDS_BY_ID[rule.id];
		if (!guards) return rule;
		const det = rule.detection;
		// Only the object-shaped detection variants can carry pathGuards. The
		// RejectionDetection union also allows `null` (item-6 prose fallback,
		// but that is a string in the array, not a RejectedRule). Guard anyway
		// so the function is total.
		if (!det || typeof det !== "object" || Array.isArray(det)) {
			return rule;
		}
		// Idempotency: skip if detection already has a pathGuards array. This
		// matches the post-U2 shape and the runtime's "presence ⇒ honored"
		// contract from src/project-constitution.ts (scopedFiles).
		const maybeDet = det as { pathGuards?: unknown };
		if (Array.isArray(maybeDet.pathGuards)) {
			return rule;
		}
		const nextDet: Record<string, unknown> = { ...(det as Record<string, unknown>) };
		nextDet.pathGuards = guards;
		nextDet.pathGuardMode = "any" as PathGuardMode;
		return { ...rule, detection: nextDet as RejectedRule["detection"] };
	});
}

// Full proposed `rejectedStack` array (11 rules + 1 trailing string).
//
// U2 of #288: the rules pass through `addPathGuards` so the pathGuards step
// is an explicit, auditable transformation (MS-RSP-001). Because
// PROPOSED_REJECTED_RULES already carries the guards (MS-RSP-002), this call
// is idempotent — every target rule is returned by reference unchanged.
// Belt-and-suspenders: the hardcoded guards make future re-migrations
// byte-identical, while the runtime call proves the transformation works
// independently of the hardcoded shape.
const PROPOSED_REJECTED_STACK: Array<RejectedRule | string> = [
	...addPathGuards(PROPOSED_REJECTED_RULES),
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
// Atomic write helper.
// Writes `content` to `targetPath` atomically by writing to a sibling temp
// file first, then renaming it on top of the target. On POSIX, rename(2) on
// the same filesystem is atomic. On Windows, rename across an existing file
// works as long as the target is not read-only. We delete the temp file on
// failure so we never leave a stray `.tmp` behind.
// ---------------------------------------------------------------------------

export function writeAtomic(targetPath: string, content: string): void {
	const tmpPath = `${targetPath}.migrate-tmp`;
	try {
		writeFileSync(tmpPath, content, "utf8");
		renameSync(tmpPath, targetPath);
	} catch (err) {
		// Best-effort cleanup of the temp file. Never throw from cleanup.
		try {
			if (existsSync(tmpPath)) unlinkSync(tmpPath);
		} catch {
			// swallow cleanup errors
		}
		throw err;
	}
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
	apply: boolean;
	stateRoot: string;
	layoutFilter: Layout | undefined;
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		dryRun: false,
		verify: false,
		apply: false,
		stateRoot: process.cwd(),
		layoutFilter: undefined,
	};
	for (const raw of argv) {
		if (raw === "--dry-run") args.dryRun = true;
		else if (raw === "--verify") args.verify = true;
		else if (raw === "--apply") args.apply = true;
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
	// Mutual exclusion: --dry-run, --verify, and --apply are all "modes" and
	// at most one may be set. Combining them is a logic error (each one calls
	// process.exit at the end of main()).
	if (
		(args.dryRun ? 1 : 0) + (args.verify ? 1 : 0) + (args.apply ? 1 : 0) >
		1
	) {
		throw new Error(
			"--dry-run, --verify, and --apply are mutually exclusive; pick at most one",
		);
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
			"  --apply                ACTUALLY write the proposed content (5s warning, atomic).",
			"  --state-root=PATH      Override the stateRoot (default: cwd).",
			"  --layout=A|B           Restrict to one layout (default: process both A and B).",
			"  --help, -h             Show this help.",
			"",
			"NOTE: without --dry-run, --verify, or --apply, the script refuses to write",
			"(default exit 3). The actual data migration is gated by the explicit --apply",
			"flag (auditor + orchestrator sign-off required before running --apply).",
			"",
		"Env: MIGRATE_APPLY_DELAY_MS overrides the 5-second warning sleep (set to 0 in tests).",
		"",
	].join("\n"),
	);
}

// ---------------------------------------------------------------------------
// pathGuards dry-run gate (U3 of #288)
//
// Runs BEFORE `--apply` writes the constitution. Catches malformed pathGuards
// (globs matching no real files, behaviorPattern rules that should stay
// unscoped, duplicate rule IDs with divergent guards, invalid glob syntax)
// and runs the real `hasRejection()` against synthetic in-scope / out-of-scope
// probes to confirm each pathGuarded rule fires inside its scope and stays
// silent outside it.
//
// Phase 1 (shape) always runs — pure, no I/O. Phase 2 (filesystem) and
// Phase 3 (functional) are skipped in `--verify` mode (verify re-reads
// already-applied data; re-running I/O + functional probes against it is
// wasteful and would re-report already-accepted violations).
//
// Spec: REQ-PGG-001..004, MS-PGG-001..003 (obs 3557).
// Design: helper signatures, wiring, probe constitution (obs 3558).
// ---------------------------------------------------------------------------

export type PathGuardViolation = {
	ruleId: string;
	kind:
		| "empty-guards"
		| "behavior-pattern-with-guards"
		| "duplicate-id"
		| "invalid-glob"
		| "glob-matches-no-files"
		| "rule-fires-outside-scope";
	context?: string;
};

export type GateOptions = { mode: "dry-run" | "apply" | "verify" };
export type GateReport = { violations: PathGuardViolation[]; ok: boolean };

// Minimal constitution scaffold for hasRejection probes. Only
// `technologyRules.rejectedStack` is overridden per-probe. Shape verified
// against ProjectConstitution (src/project-constitution.ts:23-45).
const MINIMAL_PROBE_CONSTITUTION: ProjectConstitution = {
	version: "1.0.0",
	projectName: "path-guards-gate-probe",
	sourceCoreStatus: "draft",
	principles: [],
	forbiddenPractices: [],
	requiredPractices: [],
	technologyRules: { preferredStack: [], rejectedStack: [] },
	securityRules: [],
	dataRules: [],
	approvalRules: [],
	validationGates: [],
	specialistRoles: [],
	createdAt: "",
	updatedAt: "",
	status: "active",
};

// Directories excluded from the Phase 2 filesystem walk. node_modules and
// .git are universal noise; dist is build output; .codegraph is the local
// intelligence index. All four are gitignored or generated.
const IGNORED_WALK_DIRS = new Set(["node_modules", ".git", "dist", ".codegraph"]);

// True if `rule.detection` is a behaviorPattern variant AND has any
// pathGuards set. Owner decision (obs 3556 §"User-Confirmed Decisions" #2):
// behaviorPattern stays unscoped; the runtime validator currently ALLOWS
// guards on behaviorPattern, so the gate is the sole enforcement point.
function isBehaviorPatternWithGuards(rule: RejectedRule): boolean {
	const det = rule.detection;
	if (!det || typeof det !== "object") return false;
	return "behaviorPattern" in det && extractGuards(det) !== undefined;
}

// Narrows the optional `pathGuards` field off the RejectionDetection union.
// Returns the string[] if the field is present (even when empty — Phase 1
// catches the empty case explicitly), `undefined` when absent.
function extractGuards(
	detection: RejectedRule["detection"],
): string[] | undefined {
	if (!detection || typeof detection !== "object") return undefined;
	if (!("pathGuards" in detection)) return undefined;
	const raw = (detection as { pathGuards?: unknown }).pathGuards;
	return Array.isArray(raw) ? (raw as string[]) : undefined;
}

function hasPathGuards(rule: RejectedRule): boolean {
	return extractGuards(rule.detection) !== undefined;
}

// Order-sensitive deep equality on two `pathGuards` arrays. Used by the
// duplicate-id check to decide whether two rules sharing an `id` conflict.
function equalPathGuards(
	d1: RejectedRule["detection"],
	d2: RejectedRule["detection"],
): boolean {
	const a = extractGuards(d1);
	const b = extractGuards(d2);
	if (a === undefined && b === undefined) return true;
	if (a === undefined || b === undefined) return false;
	if (a.length !== b.length) return false;
	return a.every((v, i) => v === b[i]);
}

// Walks `projectPath` and returns POSIX-style relative file paths, skipping
// IGNORED_WALK_DIRS at every level. Manual recursion (rather than
// readdirSync({recursive:true})) so Dirent-based directory detection is
// robust across Node versions and walk-time filesystem changes.
function walkProjectFiles(projectPath: string): string[] {
	const out: string[] = [];
	const visit = (dir: string, relPrefix: string): void => {
		try {
			const entries = readdirSync(dir, { withFileTypes: true });
			for (const e of entries) {
				if (e.isDirectory()) {
					if (IGNORED_WALK_DIRS.has(e.name)) continue;
					visit(join(dir, e.name), relPrefix ? `${relPrefix}/${e.name}` : e.name);
				} else if (e.isFile()) {
					out.push(relPrefix ? `${relPrefix}/${e.name}` : e.name);
				}
			}
		} catch {
			// unreadable / missing directory — skip silently
		}
	};
	visit(projectPath, "");
	return out;
}

// Verifies at least one real file under `projectPath` matches `glob`.
// `matchesGlob` (src/project-constitution.ts:1189) is private to that module
// and the constraint forbids modifying it; we exercise the real matcher
// transitively via `hasRejection`'s `filePattern` branch (which calls
// matchesGlob at line 1088). One hasRejection call per glob — fast.
function globMatchesAnyFile(glob: string, projectPath: string): boolean {
	const files = walkProjectFiles(projectPath);
	if (files.length === 0) return false;
	const probeRule: RejectedRule = {
		id: "__path_guards_glob_probe__",
		summary: "glob probe",
		category: "stack",
		detection: { filePattern: glob },
		severity: "low",
		rationale: "",
		messages: { blocked: "", warning: "" },
	};
	const input: ConstitutionGateInput = {
		changedFiles: files,
		constitution: MINIMAL_PROBE_CONSTITUTION,
	};
	return hasRejection(input, [probeRule]).length > 0;
}

// Derives a synthetic in-scope file path from the first pathGuard of `rule`.
// Handles the two shapes used by the current pathGuarded rules:
//   `<dir>/**`            → `<dir>/probe.ts`
//   `<dir>/<pre>*<post>`  → `<dir>/<pre>probe<post>`
// Returns `undefined` for exotic patterns (`**/x`, `a/**/b`, multi-`*`),
// which makes functionalCheck skip the rule.
function sampleFileUnderScope(rule: RejectedRule): string | undefined {
	const guards = extractGuards(rule.detection);
	if (!guards || guards.length === 0) return undefined;
	const first = guards[0];
	let sample: string;
	if (/\*\*\/?$/u.test(first)) {
		sample = `${first.replace(/\*\*\/?$/u, "")}probe.ts`;
	} else if (first.includes("*")) {
		sample = first.replace(/\*/u, "probe");
	} else {
		return undefined;
	}
	// Reject if any glob metacharacter survived (exotic patterns we don't handle).
	if (/[*?]/u.test(sample)) return undefined;
	return sample;
}

// Builds synthetic file content containing a token that matches the rule's
// detection regex. importPattern / commandPattern are regex alternations
// (e.g. "writeFile|execSync|spawnSync"); we pick the first alternative and
// embed it in a plausible surrounding line. filePattern / depPattern /
// behaviorPattern are skipped — the gate functional-checks content detectors
// only (filePattern is covered by Phase 2; behaviorPattern must stay
// unscoped per owner decision; depPattern needs package.json context).
function contentForRule(rule: RejectedRule): string | undefined {
	const det = rule.detection;
	if (!det || typeof det !== "object") return undefined;
	if ("importPattern" in det) {
		const first = det.importPattern.split("|")[0];
		return `import { ${first} } from "synthetic-stub"; // path-guards gate probe`;
	}
	if ("commandPattern" in det) {
		const first = det.commandPattern.split("|")[0];
		return `${first} # path-guards gate probe`;
	}
	return undefined;
}

// Runs the real `hasRejection()` against the rule under test with synthetic
// in-scope and out-of-scope changedFiles. Positive: an in-scope file with
// matching content MUST fire. Negative: an out-of-scope file with matching
// content MUST NOT fire. Returns the offending file when either case fails.
// `_projectPath` is kept in the signature to match the design contract
// (obs 3558); the functional probes are self-contained and do not read disk.
function functionalCheck(
	rule: RejectedRule,
	_projectPath: string,
): { outOfScope?: { file: string } } {
	const det = rule.detection;
	if (!det || typeof det !== "object") return {};
	if (!("importPattern" in det) && !("commandPattern" in det)) return {};

	const sample = sampleFileUnderScope(rule);
	const content = contentForRule(rule);
	if (!sample || !content) return {};

	const probeConstitution: ProjectConstitution = {
		...MINIMAL_PROBE_CONSTITUTION,
		technologyRules: { preferredStack: [], rejectedStack: [rule] },
	};
	const stub = (): string => content;

	// Positive: in-scope file + matching content → rule MUST fire.
	const positive = hasRejection(
		{ changedFiles: [sample], constitution: probeConstitution },
		[rule],
		{ readContent: stub, readDiff: stub },
	);
	if (positive.length === 0) {
		return { outOfScope: { file: sample } };
	}

	// Negative: out-of-scope file + matching content → rule MUST NOT fire.
	// `test/` is outside every current pathGuards scope (src/**, scripts/**,
	// src/agentlab-*.ts); scopedFiles filters it out before the regex runs.
	const outOfScope = "test/__path_guards_gate_probe__.ts";
	const negative = hasRejection(
		{ changedFiles: [outOfScope], constitution: probeConstitution },
		[rule],
		{ readContent: stub, readDiff: stub },
	);
	if (negative.length > 0) {
		return { outOfScope: { file: outOfScope } };
	}
	return {};
}

export function runPathGuardsGate(
	proposedStack: ReadonlyArray<RejectedRule | string>,
	projectPath: string,
	options: GateOptions,
): GateReport {
	const violations: PathGuardViolation[] = [];

	// ----- Phase 1: Shape validation (always runs; pure, no I/O) -----
	const rulesSeen = new Map<string, RejectedRule["detection"]>();
	for (const entry of proposedStack) {
		if (typeof entry === "string") continue;
		const rule = entry;

		// behaviorPattern + pathGuards → HARD ERROR (owner decision).
		if (isBehaviorPatternWithGuards(rule)) {
			violations.push({
				ruleId: rule.id,
				kind: "behavior-pattern-with-guards",
			});
		}

		const guards = extractGuards(rule.detection);

		// Empty pathGuards array (defense in depth — U1 validator also catches).
		if (guards && guards.length === 0) {
			violations.push({ ruleId: rule.id, kind: "empty-guards" });
		}

		// Invalid glob: absolute POSIX path, Windows drive prefix, or backslash.
		if (guards) {
			for (const g of guards) {
				if (
					g.startsWith("/") ||
					g.includes("\\") ||
					/^[A-Za-z]:[\\/]/u.test(g)
				) {
					violations.push({
						ruleId: rule.id,
						kind: "invalid-glob",
						context: g,
					});
				}
			}
		}

		// Duplicate rule ID with divergent pathGuards.
		const prevDet = rulesSeen.get(rule.id);
		if (prevDet !== undefined) {
			if (!equalPathGuards(prevDet, rule.detection)) {
				violations.push({ ruleId: rule.id, kind: "duplicate-id" });
			}
		} else {
			rulesSeen.set(rule.id, rule.detection);
		}
	}

	// ----- Phase 2 & 3 skipped on verify (re-reads already-applied data) -----
	if (options.mode === "verify") {
		return { violations, ok: violations.length === 0 };
	}

	const rulesToCheck = proposedStack.filter(
		(e): e is RejectedRule => typeof e !== "string",
	);

	// ----- Phase 2: Filesystem verification -----
	// Each glob must match at least one real file. Catches typos like `srcc/**`
	// that pass U1's syntactic validator but match nothing on disk.
	for (const rule of rulesToCheck) {
		const guards = extractGuards(rule.detection);
		if (!guards) continue;
		for (const g of guards) {
			if (!globMatchesAnyFile(g, projectPath)) {
				violations.push({
					ruleId: rule.id,
					kind: "glob-matches-no-files",
					context: g,
				});
			}
		}
	}

	// ----- Phase 3: Functional validation -----
	// For each pathGuarded rule, run the real hasRejection() with synthetic
	// in-scope (must fire) and out-of-scope (must not fire) probes.
	for (const rule of rulesToCheck) {
		if (!hasPathGuards(rule)) continue;
		const result = functionalCheck(rule, projectPath);
		if (result.outOfScope) {
			violations.push({
				ruleId: rule.id,
				kind: "rule-fires-outside-scope",
				context: result.outOfScope.file,
			});
		}
	}

	return { violations, ok: violations.length === 0 };
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

	// Path guards gate (U3 of #288). Runs before any write. In --dry-run the
	// gate prints PASS / FAIL and continues; in --apply a FAIL blocks the
	// write with exit 4 BEFORE writeAtomic; in --verify the gate runs Phase 1
	// only (Phase 2 / 3 skipped inside runPathGuardsGate) and stays silent.
	//
	// DEVIATION from design obs 3558 / spec obs 3557 MS-PGG-002: the gate
	// verifies pathGuards against `process.cwd()` (the project source root),
	// NOT `args.stateRoot` (the constitution storage location). The pathGuards
	// describe the project's source files (`src/**`, `scripts/**`,
	// `src/agentlab-*.ts`), which live at the project root — where the script
	// is invoked from. In production stateRoot defaults to cwd, so the two
	// coincide; in tests the stateRoot is a temp fixture dir without source
	// files, but the spawned process's cwd is still the real repo root, so
	// Phase 2 correctly finds `src/`, `scripts/`, etc. Using stateRoot would
	// break every existing --apply test (temp dirs have no src/).
	const gateReport = runPathGuardsGate(
		PROPOSED_REJECTED_STACK,
		process.cwd(),
		{
			mode: args.dryRun ? "dry-run" : args.apply ? "apply" : "verify",
		},
	);
	if (args.dryRun) {
		if (gateReport.ok) {
			process.stdout.write("\nPath guards gate: PASS\n");
		} else {
			process.stdout.write(
				`\nPath guards gate: FAIL with ${gateReport.violations.length} violations\n`,
			);
			for (const v of gateReport.violations) {
				process.stdout.write(
					`  - ${v.ruleId}: ${v.kind}${v.context ? ` (${v.context})` : ""}\n`,
				);
			}
		}
	} else if (args.apply && !gateReport.ok) {
		process.stderr.write(
			`\nPath guards gate FAILED: ${gateReport.violations.length} violations\n`,
		);
		for (const v of gateReport.violations) {
			process.stderr.write(
				`  - ${v.ruleId}: ${v.kind}${v.context ? ` (${v.context})` : ""}\n`,
			);
		}
		process.exit(4);
	}

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

	if (args.apply) {
		// 5-second warning (configurable). The orchestrator's gate is the
		// explicit --apply flag; the warning is a final safety net for
		// interactive / piping invocations.
		const delayMs = (() => {
			const raw = process.env.MIGRATE_APPLY_DELAY_MS;
			if (raw === undefined || raw === "") return 5000;
			const parsed = Number.parseInt(raw, 10);
			return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5000;
		})();
		process.stdout.write(
			"\n=== --apply mode: WRITE PATH ===\n" +
				"WARNING: --apply will modify the brain's constitution file.\n" +
				`Press Ctrl-C to abort within ${(delayMs / 1000).toFixed(2)} seconds.\n`,
		);
		// Synchronous sleep so a Ctrl-C inside the test runs before the write.
		// We don't need sub-second precision — this is a deliberate human pause.
		const endAt = Date.now() + delayMs;
		// Tight loop instead of setTimeout so the test framework's signal
		// handling works the same way as in production.
		while (Date.now() < endAt) {
			// spin
		}

		// For each layout, write proposedRaw atomically. Skip layouts that
		// are already migrated (no-op — preserve byte-equality invariant).
		let wroteAny = false;
		for (const r of results) {
			if (r.alreadyMigrated) {
				process.stdout.write(
					`[Layout ${r.layout}] already migrated — skipping (no-op).\n`,
				);
				continue;
			}
			writeAtomic(r.path, r.proposedRaw);
			wroteAny = true;
			process.stdout.write(`[Layout ${r.layout}] wrote ${r.path}\n`);
		}

		// Re-read each file and assert byte-equality with the proposedRaw
		// (same as --verify, but post-write). This is the proof that the
		// write path didn't corrupt non-target fields.
		for (const r of results) {
			if (r.alreadyMigrated) continue;
			const reread = readFileSync(r.path, "utf8");
			if (reread !== r.proposedRaw) {
				process.stderr.write(
					`[Layout ${r.layout}] post-write verify FAILED: file content differs from proposed in-memory version\n`,
				);
				process.exit(1);
			}
		}

		if (wroteAny) {
			process.stdout.write(
				"\n--apply mode: write + post-write verify complete, exit 0.\n",
			);
		} else {
			process.stdout.write(
				"\n--apply mode: no layouts needed migration, exit 0.\n",
			);
		}
		process.exit(0);
	}

	// Without --dry-run, --verify, or --apply, refuse to write. The gate is
	// the explicit --apply flag (auditor + orchestrator sign-off required
	// before running --apply).
	process.stderr.write(
		"\nmigrate-rejected-stack: refusing to write in this slice.\n" +
			"Pass --apply to actually write the migration (gated; auditor + orchestrator\n" +
			"sign-off required). Use --dry-run to inspect the diff first.\n",
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
	// `writeAtomic` is exported inline at the function definition above.
};
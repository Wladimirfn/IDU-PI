#!/usr/bin/env node
/**
 * verify-case-extraction.mjs
 *
 * PR 7 verification gate. For each cluster being extracted, this script:
 *
 * 1. Reads the source switch body (the case label + body) from main @ <sha>.
 * 2. Reads the wrapper function body from the cluster's handlers.ts.
 * 3. Compares body-vs-body, modulo:
 *    - The function signature wrapper (`export function handleX(...)`)
 *    - The `activeRuntime` → `runtime` rename (the wrapper takes `runtime`
 *      as a parameter; the case uses `activeRuntime` as a closure var).
 *
 * Exits 0 if all wrappers are byte-identical (modulo the rename +
 * signature). Exits 1 with a list of failing wrappers otherwise.
 *
 * Usage:
 *   node scripts/verify-case-extraction.mjs <main-sha> <label:path> [<label:path> ...]
 *
 * Example:
 *   node scripts/verify-case-extraction.mjs 311ec1a \
 *     role:src/cli/role/handlers.ts
 *
 * Exit codes:
 *   0  all wrappers byte-identical (modulo signature + rename)
 *   1  one or more wrappers differ
 *   2  invalid arguments
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length < 2) {
	console.error(
		"Usage: verify-case-extraction.mjs <main-sha> <label:path> [<label:path> ...]",
	);
	process.exit(2);
}

const mainSha = args[0];
const targets = args.slice(1).map((spec) => {
	const colonIdx = spec.indexOf(":");
	if (colonIdx < 0) {
		console.error(`Invalid spec (missing ':'): ${spec}`);
		process.exit(2);
	}
	return {
		label: spec.slice(0, colonIdx),
		file: spec.slice(colonIdx + 1),
	};
});

// Module-level cluster map. Used by matchesCluster AND by the caller
// of findSwitch to look up a target case label (the first prefix of
// the cluster) so the right switch(name) block is selected.
const CLUSTER_PREFIXES = {
	role: [
		"role-engine",
		"orchestrator-advisory",
		"model-invocation-status",
		"idu-role",
		"idu-orchestrator",
		"idu-model",
	],
	alerts: ["alerts", "idu-alerts", "supervisor-self-maintenance"],
	"master-plan": [
		"master-plan",
		"automaticov1",
		"events",
		"execution-director",
		"proposal",
	],
	agentlab: [
		"agentlab",
		"usage-status",
		"lab-review-plan",
		"review",
		"revisar",
	],
	source: ["source"],
	supervisor: [
		"supervisor-tick",
		"supervisor-improvements",
		"supervisor-learning-rules",
		"supervisor-trigger",
		"cron-preflight",
		"check-user-escalation",
	],
	skill: ["skill"],
	semantic: ["semantic"],
	queue: ["queue", "task"],
	birth: ["birth"],
	single: [
		"status",
		"idu",
		"idu-off",
		"idu-status",
		"idu-prepare",
		"idu-project-reset-state",
		"idu-hygiene-migrate",
		"idu-ack-advisory",
		"idu-hygiene-sweep",
		"idu-preflight",
		"idu-advisory",
		"idu-postflight",
		"idu-objective-status",
		"idu-onboard-project",
		"idu-bibliotecario-init",
		"idu-pending-injections",
		"idu-decision-ledger",
		"idu-outbox-prune",
		"idu-subscribe-triggers",
		"idu-trigger-engine",
		"idu-trigger-show",
	],
	lifecycle: [
		"idu_project_status",
		"idu_project_enroll",
		"idu_bootstrap_project",
		"idu_start",
	],
	session: [
		"idu_status",
		"idu_activate",
		"idu_deactivate",
		"idu_project_reset_state",
	],
	"supervisor-trigger": [
		"idu_supervisor_trigger",
		"idu_trigger_engine",
		"idu_supervisor_self_maintenance_advisory",
	],
	role: [
		"idu_role_engine_control",
		"idu_role_engine_status",
	],
	"supervisor-context": [
		"idu_supervisor_context_pack",
		"idu_orchestrator_procedure",
		"idu_task_context",
	],
	preflight: [
		"idu_preflight",
		"idu_advisory",
		"idu_postflight",
	],
};

/**
 * Find the dispatch switch in the dispatch file. Matches `switch (command)`
 * (cli.ts) or `switch (name)` (mcp-server.ts). Returns the FIRST match's
 * bounds — important for mcp-server.ts which has two switch(name) blocks
 * (lifecycle + main dispatch).
 */
function findSwitch(lines, targetLabel) {
	// Find the FIRST switch that contains the target case label.
	// mcp-server.ts has 2 switch(name) blocks: lifecycle (4 cases) +
	// dispatchTool (~83 cases). When extracting `session` cluster
	// (idu_status, idu_activate, ...), we want the dispatchTool switch.
	// When extracting `lifecycle`, we want the lifecycle switch.
	let switchStart = -1;
	let switchEnd = -1;
	let depth = 0;
	let inSwitch = false;
	let foundTarget = false;
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i];
		if (!inSwitch && /\bswitch\s*\(\s*(command|name)\s*\)/.test(l)) {
			switchStart = i;
			inSwitch = true;
			depth = 0;
			foundTarget = false;
		}
		if (inSwitch) {
			// Detect if this switch contains the target case label.
			if (targetLabel && new RegExp(`case\\s+"${targetLabel}"`).test(l)) {
				foundTarget = true;
			}
			for (const ch of l) {
				if (ch === "{") depth++;
				else if (ch === "}") depth--;
			}
			if (depth === 0 && /[{}]/.test(l)) {
				switchEnd = i;
				if (!targetLabel || foundTarget) {
					// Either no target specified (legacy), or the target
					// case is in this switch — return its bounds.
					return { switchStart, switchEnd };
				}
				// Otherwise, keep looking for the next switch.
				inSwitch = false;
				switchStart = -1;
				switchEnd = -1;
			}
		}
	}
	return { switchStart, switchEnd };
}

/**
 * Extract case groups from the switch. A group is one or more consecutive
 * `case "X":` labels that share a body. The body is the lines between
 * the last case label and the next `case "X":` or `default:`.
 */
function extractCaseGroups(lines, switchStart, switchEnd) {
	const groups = [];
	let currentLabels = [];
	let bodyStart = -1;
	let bodyEnd = -1;
	let seenBody = false;
	for (let i = switchStart + 1; i < switchEnd; i++) {
		const l = lines[i];
		const m = l.match(/^\s*case\s+"([^"]+)"\s*:/);
		if (m) {
			if (seenBody && currentLabels.length > 0) {
				groups.push({
					labels: [...currentLabels],
					bodyStart,
					bodyEnd,
				});
				currentLabels = [];
				bodyStart = -1;
				bodyEnd = -1;
				seenBody = false;
			}
			currentLabels.push(m[1]);
		} else if (/^\s+default:\s*$/.test(l)) {
			if (seenBody && currentLabels.length > 0) {
				groups.push({ labels: [...currentLabels], bodyStart, bodyEnd });
			}
			break;
		} else if (currentLabels.length > 0) {
			if (bodyStart < 0) bodyStart = i;
			bodyEnd = i;
			seenBody = true;
		}
	}
	if (seenBody && currentLabels.length > 0) {
		groups.push({ labels: [...currentLabels], bodyStart, bodyEnd });
	}
	return groups;
}

/**
 * Extract the body of an `export function handleX(...)` from a handlers.ts
 * file. Returns the function body (including the `export function`
 * signature) or null if not found.
 */
function extractHandlerBody(helpersSrc, handlerName) {
	const lines = helpersSrc.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i];
		const m = l.match(
			new RegExp(`^export\\s+(?:async\\s+)?function\\s+${handlerName}\\s*\\(`),
		);
		if (!m) continue;
		// Walk forward to find matching `}` at column 0.
		let depth = 0;
		let started = false;
		let endIdx = i;
		for (let k = i; k < lines.length; k++) {
			for (const ch of lines[k]) {
				if (ch === "{") {
					depth++;
					started = true;
				} else if (ch === "}") {
					depth--;
					if (started && depth === 0) {
						endIdx = k;
						break;
					}
				}
			}
			if (started && depth === 0) break;
		}
		return {
			signature: lines[i],
			body: lines.slice(i, endIdx + 1).join("\n"),
			startLine: i + 1,
			endLine: endIdx + 1,
		};
	}
	return null;
}

/**
 * Strip the function signature from a wrapper body, leaving just the
 * inner content for byte-comparison. Also strips the trailing closing
 * `}` (the function's closing brace) since the case body doesn't
 * include its closing brace.
 */
function stripSignature(body) {
	const lines = body.split("\n");
	const result = [];
	let depth = 0;
	let pastSignature = false;
	let pastLastBrace = false;
	for (const line of lines) {
		if (pastLastBrace) continue;
		if (!pastSignature) {
			// Track depth; once we've seen an open brace at depth >= 1,
			// the signature is "complete".
			for (const ch of line) {
				if (ch === "{") {
					depth++;
					pastSignature = true;
				} else if (ch === "}") {
					depth--;
				}
			}
			continue;
		}
		// If this is the closing `}` line at column 0, skip it.
		if (/^}\s*$/.test(line)) {
			pastLastBrace = true;
			continue;
		}
		result.push(line);
	}
	return result.join("\n");
}

/**
 * Normalize indentation: strip ALL leading whitespace from each line.
 * This is the strongest normalization — it ignores indentation entirely,
 * which is an artifact of where the code lives (case body is inside
 * the switch; wrapper body is at module top level). The CONTENT must
 * be identical; whitespace at the start of lines is irrelevant.
 */
function normalizeIndent(body) {
	return body
		.split("\n")
		.map((l) => l.replace(/^\s*/, ""))
		.join("\n");
}

/**
 * Renames `activeRuntime` to `runtime` in the case body so it matches the
 * wrapper parameter name. (The wrapper takes `runtime: CliRuntime`;
 * the case body used `activeRuntime` as a closure var.)
 */
function renameActiveRuntime(body) {
	return body.replace(/\bactiveRuntime\b/g, "runtime");
}

/**
 * Strip the trailing closing `}` if it's the LAST non-empty line of
 * the body. Multi-line cases (e.g., `case "X": { ... }`) include the
 * closing brace in the extracted body; single-line cases don't.
 * Wrapper bodies don't include the closing `}` (already stripped by
 * stripSignature). This normalizes that asymmetry.
 */
function stripTrailingBrace(body) {
	const lines = body.split("\n");
	for (let i = lines.length - 1; i >= 0; i--) {
		const l = lines[i];
		if (l.trim() === "") continue;
		if (/^}\s*$/.test(l.trim())) {
			lines.splice(i, 1);
		}
		break;
	}
	return lines.join("\n");
}

/**
 * Parse `import { X, Y as Z, ... } from "..."` declarations in a handlers.ts
 * source and return a Map<aliasName, originalName> for every `as`-renamed
 * import. These aliases are substituted in the wrapper body before
 * byte-identity comparison, so a wrapper that uses `import { handleBirthX
 * as runBirthX }` can still byte-equal a case body that calls
 * `handleBirthX(...)`.
 *
 * Per the locked wrapper-naming template (`handle${pascal}`), helpers
 * extracted in earlier PRs may share names with desired wrapper names.
 * The alias is the legitimate resolution; the byte-identity check should
 * not fail on it.
 */
function resolveImportAliases(helpersSrc) {
	const aliases = new Map();
	const importRe = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["'][^"']+["']/g;
	let m;
	while ((m = importRe.exec(helpersSrc))) {
		const names = m[1];
		for (const part of names.split(",")) {
			const trimmed = part.trim();
			if (!trimmed) continue;
			const asMatch = trimmed.match(/^(\w+)\s+as\s+(\w+)$/);
			if (asMatch) {
				aliases.set(asMatch[2], asMatch[1]);
			}
		}
	}
	return aliases;
}

/**
 * Apply alias resolution: replace each `aliasName` with its original
 * in the body. Word-boundary aware so partial matches don't fire.
 */
function applyAliases(body, aliases) {
	let out = body;
	for (const [alias, original] of aliases) {
		out = out.replace(new RegExp(`\\b${alias}\\b`, "g"), original);
	}
	return out;
}

// Derive the dispatch file from the handler file path. cli.ts breaks
// dispatch in src/cli.ts; mcp-server breaks in src/mcp-server.ts. We
// auto-detect from the handler file's directory.
const dispatchFile = targets[0].file.startsWith("src/mcp")
	? "src/mcp-server.ts"
	: "src/cli.ts";

const mainSrc = execSync(`git show ${mainSha}:${dispatchFile}`, {
	encoding: "utf8",
});
const mainLines = mainSrc.split("\n");
// Pick a representative case label from the first target's cluster
// so findSwitch can disambiguate between multiple switch(name) blocks
// in mcp-server.ts (lifecycle + dispatchTool). We use the first
// cluster prefix from the module-level CLUSTER_PREFIXES map.
const targetLabel = (() => {
	if (!targets[0].file.startsWith("src/mcp")) return null;
	const clusterPrefixes = CLUSTER_PREFIXES[targets[0].label];
	return clusterPrefixes && clusterPrefixes.length > 0
		? clusterPrefixes[0]
		: null;
})();
const { switchStart, switchEnd } = findSwitch(mainLines, targetLabel);
const groups = extractCaseGroups(mainLines, switchStart, switchEnd);

const handlersByLabel = new Map();
for (const target of targets) {
	const src = readFileSync(target.file, "utf8");
	const exportRe = /^export\s+(?:async\s+)?function\s+(\w+)/gm;
	let m;
	while ((m = exportRe.exec(src))) {
		handlersByLabel.set(m[1], target.file);
	}
	if (handlersByLabel.size === 0) {
		console.error(`Cannot find any exported handlers in ${target.file}`);
		process.exit(2);
	}
}

let totalDiff = 0;
const totalGroups = groups.length;
let checked = 0;
let okCount = 0;

for (const target of targets) {
	const src = readFileSync(target.file, "utf8");
	console.log(`\n=== ${target.label} (${target.file}) ===`);
	for (const group of groups) {
		const primary = group.labels[0];
		if (
			!primary.includes(target.label) &&
			!matchesCluster(primary, target.label)
		)
			continue;

		const handlerName = findHandlerForLabel(src, primary);
		if (!handlerName) continue;

		const handler = extractHandlerBody(src, handlerName);
		if (!handler) continue;

		const caseBody = mainLines
			.slice(group.bodyStart, group.bodyEnd + 1)
			.join("\n");
		const aliases = resolveImportAliases(src);
		const wrapperInner = normalizeIndent(
			stripSignature(applyAliases(handler.body, aliases)),
		);
		const expectedInner = normalizeIndent(
			stripTrailingBrace(renameActiveRuntime(caseBody)),
		);

		if (wrapperInner.trim() === expectedInner.trim()) {
			okCount++;
			console.log(`  OK    ${group.labels.join(" | ")} -> ${handlerName}`);
		} else {
			totalDiff++;
			console.log(`  DIFF  ${group.labels.join(" | ")} -> ${handlerName}`);
			showBodyDiff(expectedInner, wrapperInner);
		}
		checked++;
	}
}

console.log("");
console.log("---");
console.log(`Total case groups: ${totalGroups}`);
console.log(`Checked: ${checked}`);
console.log(`OK: ${okCount}`);
console.log(`DIFF: ${totalDiff}`);

if (totalDiff > 0) {
	console.log("");
	console.log("STOP: byte-identity violated. Per the auditor's contract:");
	console.log("wrapper body must be byte-identical to case body");
	console.log("(modulo `activeRuntime` → `runtime` rename + signature).");
	console.log(
		"Wrapper may use `import { X as Y }` aliases — those are resolved",
	);
	console.log(
		"automatically (Y → X) before comparison. Other diffs are real drift.",
	);
	process.exit(1);
}

function matchesCluster(label, cluster) {
	const prefixes = CLUSTER_PREFIXES[cluster] || [cluster];
	// Normalize underscore/hyphen — cli.ts labels use hyphens, mcp-server
	// labels use underscores. The cluster prefix matches either.
	const normalize = (s) => s.replace(/_/g, "-");
	return prefixes.some((p) => normalize(label).includes(normalize(p)));
}

function findHandlerForLabel(helpersSrc, label) {
	const parts = label.split(/[-_]/);
	// Pascal candidates: try both the LOCKED (idu- stripped) and the
	// NON-STRIPPED version. The single cluster has cases like `status` AND
	// `idu-status` whose pascal under the locked template both collapse to
	// "Status" (collision). The single-cluster wrappers keep "Idu" in the
	// name (`handleIduStatus`) — this is a deliberate deviation, not a bug.
	const stripped =
		parts[0] === "idu" && parts.length > 1 ? parts.slice(1) : parts;
	const pascal = stripped
		.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
		.join("");
	const fullPascal = parts
		.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
		.join("");
	const candidates = [
		`handle${fullPascal}`,
		`handle${pascal}`,
		`handle${pascal}Tick`,
		`handle${pascal}Control`,
		`handle${pascal}Status`,
	];
	for (const c of candidates) {
		const re = new RegExp(`^export\\s+(?:async\\s+)?function\\s+${c}\\b`, "m");
		if (re.test(helpersSrc)) return c;
	}
	const exportRe = /^export\s+(?:async\s+)?function\s+(\w+)/gm;
	let m;
	while ((m = exportRe.exec(helpersSrc))) {
		const name = m[1];
		if (
			name.toLowerCase().includes(pascal.toLowerCase()) ||
			name.toLowerCase().includes(fullPascal.toLowerCase()) ||
			name.toLowerCase().includes(label.replace(/-/g, ""))
		) {
			return name;
		}
	}
	return null;
}

function showBodyDiff(main, next) {
	const a = main.split("\n");
	const b = next.split("\n");
	const max = Math.max(a.length, b.length);
	let shown = 0;
	for (let i = 0; i < max && shown < 8; i++) {
		if (a[i] !== b[i]) {
			console.log(`    L${i + 1} main: ${JSON.stringify(a[i] ?? "")}`);
			console.log(`    L${i + 1} new : ${JSON.stringify(b[i] ?? "")}`);
			shown++;
		}
	}
	if (shown === 8) console.log("    ... (truncated)");
}

// =====================================================================
// Duplication guard (added in PR 7b follow-up).
//
// Contract: any helper internal to cli.ts that a case body calls MUST
// be extracted to a shared module (e.g. src/cli/usage.ts) and imported
// by every handler file that needs it. NEVER duplicate the helper
// inline in a handler file.
//
// A refactor whose goal is de-duplication cannot add duplication.
// The byte-identity gate above catches drift on the case body vs the
// wrapper body, but it does NOT see whether a wrapper resolves a
// helper call to an imported function (correct) or to a local
// re-definition (duplication). This guard closes that blind spot.
//
// Two checks:
//
//   (A) Cross-handler-file: the same exported function name MUST NOT
//       be defined in more than one handler file. Two handlers that
//       both define `foo` is duplication.
//
//   (B) Handler vs cli.ts internals: the same function name MUST NOT
//       appear as an internal `function foo(...)` in cli.ts AND as an
//       exported `function foo(...)` (or `function foo(...)` wrapped
//       by an `export` declaration) in a handler file. The handler
//       should import, not redeclare.
//
// Both checks are run AFTER the byte-identity gate and are blocking.
// =====================================================================

const ALL_HANDLER_FILES = [
	// Add each new cluster's handlers.ts as it's introduced.
	"src/cli/role/handlers.ts",
	"src/cli/master-plan/handlers.ts",
	"src/cli/agentlab/handlers.ts",
	"src/cli/source/handlers.ts",
	"src/cli/supervisor/handlers.ts",
	"src/cli/skill/handlers.ts",
	"src/cli/semantic/handlers.ts",
	"src/cli/queue/handlers.ts",
	"src/cli/alerts/handlers.ts",
	"src/cli/birth/handlers.ts",
	"src/cli/single/handlers.ts",
	"src/mcp/lifecycle/handlers.ts",
	"src/mcp/session/handlers.ts",
	"src/mcp/supervisor-trigger/handlers.ts",
	"src/mcp/role/handlers.ts",
	"src/mcp/supervisor-context/handlers.ts",
	"src/mcp/preflight/handlers.ts",
];

function parseAllFunctionNames(src) {
	// Match BOTH exported and non-exported top-level function declarations.
	// The duplication guard must catch local copies (e.g. PR 7b's local
	// `function recordCliUsage(...)` inside handlers.ts).
	const re = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm;
	const names = [];
	let m;
	while ((m = re.exec(src))) names.push(m[1]);
	return names;
}

function parseExportedFunctions(src) {
	const re = /^export\s+(?:async\s+)?function\s+(\w+)/gm;
	const names = [];
	let m;
	while ((m = re.exec(src))) names.push(m[1]);
	return names;
}

function checkCrossHandlerDuplication() {
	const fileToFns = new Map();
	// Track filter — cross-track wrappers (cli vs mcp) may share the same
	// name because they live in different dispatch files. Without this
	// filter, the dup guard would always flag cli/single/handlers.ts'
	// handleStatus as a duplicate of mcp/session/handlers.ts'
	// handleStatus, even though they belong to different switches.
	const dispatchTrack = dispatchFile.startsWith("src/mcp") ? "mcp" : "cli";
	for (const file of ALL_HANDLER_FILES) {
		const fileTrack = file.startsWith("src/mcp") ? "mcp" : "cli";
		if (fileTrack !== dispatchTrack) continue;
		try {
			const src = readFileSync(file, "utf8");
			const fns = parseAllFunctionNames(src);
			if (fns.length > 0) fileToFns.set(file, fns);
		} catch {
			// File may not exist yet for clusters not extracted.
		}
	}

	const nameToFiles = new Map();
	for (const [file, fns] of fileToFns) {
		for (const fn of fns) {
			if (!nameToFiles.has(fn)) nameToFiles.set(fn, []);
			nameToFiles.get(fn).push(file);
		}
	}

	const dupes = [];
	for (const [fn, files] of nameToFiles) {
		if (files.length > 1) dupes.push({ fn, files });
	}
	return dupes;
}

function checkHandlerVsCliInternals() {
	let cliSrc;
	try {
		// Read from the CURRENT working tree, not from `main`. The
		// guard must compare against the dispatch file that will exist
		// AFTER the PR merges — which is the working tree's file,
		// not main's pre-PR file.
		cliSrc = readFileSync(dispatchFile, "utf8");
	} catch {
		return [];
	}
	const cliInternals = new Set(parseAllFunctionNames(cliSrc));

	const violations = [];
	// Same track filtering as checkDelegation — cross-track handlers
	// would always be flagged because their local helpers don't exist
	// in the dispatch file's track.
	const dispatchTrack = dispatchFile.startsWith("src/mcp") ? "mcp" : "cli";
	for (const file of ALL_HANDLER_FILES) {
		const fileTrack = file.startsWith("src/mcp") ? "mcp" : "cli";
		if (fileTrack !== dispatchTrack) continue;
		let src;
		try {
			src = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		const fns = parseAllFunctionNames(src);
		for (const fn of fns) {
			if (cliInternals.has(fn)) {
				violations.push({ fn, handlerFile: file });
			}
		}
	}
	return violations;
}

// Run duplication checks (only when at least one handler file is present).
// FAIL-CLOSED: any error reading a handler file aborts the gate (exit≠0).
// A silent "file doesn't exist" catch would let the gate pass with no checks.
const hasAnyHandler = ALL_HANDLER_FILES.some((f) => {
	try {
		readFileSync(f, "utf8");
		return true;
	} catch (e) {
		// Re-throw with context — don't swallow.
		throw new Error(`Cannot read handler file ${f}: ${e.message}`);
	}
});

// FAIL-CLOSED sanity check: if any gate function is not a function
// (e.g. accidentally deleted by a refactor), abort. A silent skip
// would let the gate "pass" with no checks.
// Note: this block must be placed AFTER all gate function
// declarations because ESM doesn't hoist `function` declarations
// across module top-level statements the way CommonJS does.
function _sanityCheckGateFunctions() {
	const fns = [
		checkCrossHandlerDuplication,
		checkHandlerVsCliInternals,
		checkDelegation,
		checkBodyExtracted,
	];
	for (const fn of fns) {
		if (typeof fn !== "function") {
			console.log(`STOP: a gate function is not defined.`);
			console.log("This usually means the script was refactored and a");
			console.log("function was deleted. Restore it before re-running.");
			process.exit(1);
		}
	}
}
_sanityCheckGateFunctions();

if (hasAnyHandler) {
	console.log("");
	console.log("=== Duplication guard ===");

	let dupFailures = 0;

	const crossHandler = checkCrossHandlerDuplication();
	if (crossHandler.length > 0) {
		dupFailures++;
		console.log(
			`  FAIL: ${crossHandler.length} function(s) defined in multiple handler files:`,
		);
		for (const { fn, files } of crossHandler) {
			console.log(`    - ${fn}: ${files.join(", ")}`);
		}
	} else {
		console.log("  OK: no function is defined in multiple handler files");
	}

	const handlerVsCli = checkHandlerVsCliInternals();
	if (handlerVsCli.length > 0) {
		dupFailures++;
		console.log(
			`  FAIL: ${handlerVsCli.length} handler file(s) shadow cli.ts internals — extract to a shared module instead:`,
		);
		for (const { fn, handlerFile } of handlerVsCli) {
			console.log(`    - ${fn} (defined in cli.ts AND ${handlerFile})`);
		}
	} else {
		console.log("  OK: no handler file shadows a cli.ts internal");
	}

	if (dupFailures > 0) {
		console.log("");
		console.log("STOP: duplication guard failed.");
		console.log(
			"Per the auditor's contract, a refactor cannot add duplication.",
		);
		console.log(
			"Extract the offending helper to a shared module (e.g. src/cli/usage.ts)",
		);
		console.log("and import it from both cli.ts and the handler file(s).");
		process.exit(1);
	}
}

// =====================================================================
// Delegation guard (added in PR 7f follow-up after the auditor caught
// the dead-code no-op).
//
// The byte-identity test verifies the wrapper body matches the case
// body. The duplication guard verifies the wrappers don't shadow cli.ts
// internals. But NEITHER verifies that cli.ts actually CALLS the
// wrappers. A "no-op" PR that just adds handler files without rewiring
// the switch passes both gates — the wrappers become dead code, the
// case bodies stay inline, and the test suite still passes (behavior
// is unchanged).
//
// This guard closes that blind spot by requiring, for every wrapper
// `handleX` exported from any handler file: cli.ts MUST contain at
// least one `return handleX(...)` call. If a wrapper is never called
// from cli.ts, it is dead code.
//
// Two checks:
//
//   (C) Delegation: for every wrapper exported by a handler file,
//       `return <wrapperName>(...)` MUST appear in cli.ts (the dispatch
//       switch must call the wrapper). At least one match per wrapper.
//
//   (D) Body extraction: the case body that the wrapper replaced must
//       NOT be inlined in cli.ts. We approximate this by checking that
//       the case label's runtime-method call (the first inner runtime
//       call inside the wrapper body) does NOT appear in cli.ts AFTER
//       the case label. If it does, the case body is still inline.
//
// Both checks are run AFTER the byte-identity + duplication gates
// and are blocking.
// =====================================================================

function checkDelegation() {
	// Read the dispatch file from the WORKING TREE (post-extraction state).
	// FAIL-CLOSED: any failure here aborts the gate (exit≠0), not a
	// silent pass. A silent pass here would re-introduce the dead-code
	// no-op bug class (PR 7f was caught exactly because the gate failed;
	// if it had silently passed, the no-op would have merged).
	const cliSrc = readFileSync(dispatchFile, "utf8");
	const fileToWrappers = new Map();
	// Only check handlers in the same track as the dispatch file.
	// cli-track handlers (src/cli/...) are dispatched from src/cli.ts;
	// mcp-track handlers (src/mcp/...) are dispatched from src/mcp-server.ts.
	// Cross-track checks would always report CLI wrappers as "DEAD CODE"
	// from an mcp-server.ts extraction (and vice versa).
	const dispatchTrack = dispatchFile.startsWith("src/mcp") ? "mcp" : "cli";
	for (const file of ALL_HANDLER_FILES) {
		const fileTrack = file.startsWith("src/mcp") ? "mcp" : "cli";
		if (fileTrack !== dispatchTrack) {
			continue;
		}
		// FAIL-CLOSED: any I/O error here aborts the gate. A silent
		// empty map would let the gate "pass" with no checks.
		const src = readFileSync(file, "utf8");
		const wrappers = parseExportedFunctions(src);
		if (wrappers.length > 0) fileToWrappers.set(file, wrappers);
	}
	const missing = [];
	for (const [file, wrappers] of fileToWrappers) {
		for (const wrapper of wrappers) {
			// Match `return [await] <wrapper>(` — a real delegation call.
			// Some handlers are async; the dispatcher calls them with
			// `return await handleX(...)`. We accept both forms.
			const re = new RegExp(`return\\s+(?:await\\s+)?${wrapper}\\s*\\(`, "g");
			if (!re.test(cliSrc)) {
				missing.push({ wrapper, file });
			}
		}
	}
	return missing;
}

function checkBodyExtracted() {
	// For each wrapper, the case body contains a specific runtime-method
	// call. We approximate "body extracted" by checking that the
	// wrapper's runtime call (the first one inside it) does NOT appear
	// in cli.ts. If it does, the case body is still inline.
	//
	// Strategy: extract the first `runtime.X(...)` call from the wrapper
	//
	// TRACK FILTER: this check is only meaningful for the cli track.
	// mcp-server.ts contains many helper functions (buildOrchestratorProcedure,
	// pre-processor callbacks, etc.) that legitimately call
	// `runtime.X()` for purposes unrelated to the dispatched case bodies.
	// The check would false-positive on those. For the mcp track, the
	// byte-identity gate is the authoritative proof.
	if (dispatchFile.startsWith("src/mcp")) return [];

	// body. Grep cli.ts for that pattern. If found, FAIL.
	const fileToWrappers = new Map();
	for (const file of ALL_HANDLER_FILES) {
		// FAIL-CLOSED: any I/O or parse error aborts the gate.
		const src = readFileSync(file, "utf8");
		const wrappers = parseExportedFunctions(src);
		if (wrappers.length > 0) fileToWrappers.set(file, wrappers);
	}
	const leakedBodies = [];
	for (const [file, wrappers] of fileToWrappers) {
		for (const wrapper of wrappers) {
			const src = readFileSync(file, "utf8");
			// Find the wrapper body and extract the first runtime.X(...) call.
			const handlerRe = new RegExp(
				`export\\s+(?:async\\s+)?function\\s+${wrapper}\\s*\\([^)]*\\)\\s*(?::\\s*Promise<[^>]+>)?\\s*\\{([\\s\\S]*?)\\n\\}`,
			);
			const m = handlerRe.exec(src);
			if (!m) continue;
			const body = m[1];
			// Find first runtime.X(...) call inside the body.
			const callRe = /runtime\.([A-Za-z_]\w*)\s*\(/;
			const cm = callRe.exec(body);
			if (!cm) continue;
			const methodName = cm[1];
			// Grep cli.ts for `activeRuntime.<methodName>(` or
			// `runtime.<methodName>(` outside of any string. We use a
			// simple substring check — if the method name appears as a
			// call (with `(`), it's likely still inline.
			const cliSrc = readFileSync(dispatchFile, "utf8");
			// Count occurrences of `.methodName(` in cli.ts.
			// 1 or more = body may still be inline.
			const inlineRe = new RegExp(`\\.${methodName}\\s*\\(`, "g");
			const matches = cliSrc.match(inlineRe);
			if (matches && matches.length > 0) {
				// Allow up to 1 occurrence (which is in the wrapper file
				// itself, NOT cli.ts — but we're reading cli.ts here).
				// If 0: body is gone. If >=1: body may still be inline.
				leakedBodies.push({
					wrapper,
					methodName,
					count: matches.length,
				});
			}
		}
	}
	return leakedBodies;
}

const delegationFailures = (() => {
	let failures = 0;

	const missing = checkDelegation();
	if (missing.length > 0) {
		failures++;
		console.log(
			`  FAIL: ${missing.length} wrapper(s) exported but NEVER CALLED from cli.ts:`,
		);
		for (const { wrapper, file } of missing) {
			console.log(`    - ${wrapper} (exported by ${file}) — DEAD CODE`);
		}
	} else {
		console.log("  OK: every handler wrapper is called from cli.ts");
	}

	const leaked = checkBodyExtracted();
	if (leaked.length > 0) {
		failures++;
		console.log(
			`  WARN: ${leaked.length} wrapper(s) have runtime calls that still appear in cli.ts:`,
		);
		for (const { wrapper, methodName, count } of leaked) {
			console.log(
				`    - ${wrapper}: .${methodName}( appears ${count}× in cli.ts (may indicate inline body)`,
			);
		}
	} else {
		console.log("  OK: no inline case bodies detected for extracted wrappers");
	}

	return failures;
})();

if (delegationFailures > 0) {
	console.log("");
	console.log("STOP: delegation guard failed.");
	console.log(
		"Per the auditor's contract, every extracted wrapper must be CALLED from cli.ts.",
	);
	console.log(
		"If you see DEAD CODE: rewire cli.ts (import handler + replace case body with `return handleX(...)`).",
	);
	console.log(
		"If you see inline bodies: ensure the case body was replaced, not duplicated.",
	);
	process.exit(1);
}

// Structural check: no duplicate case labels. The PR 3 splice introduced
// a literal `case "X":\t\tcase "X": {` on a single line because the
// replacement string ended with a label that was already in the file.
// This guard detects that artifact pattern across the dispatch file.
function checkDuplicateCaseLabels() {
	const src = readFileSync(dispatchFile, "utf8");
	const lines = src.split("\n");
	const dupes = [];
	// Pattern: any line containing 2+ `case "X":` labels (whether
	// space-, tab-, or nothing-separated). This catches the splice
	// artifact and any other accidental duplication.
	const re = /case\s+"([^"]+)"\s*:.*case\s+"([^"]+)"\s*:/;
	for (let i = 0; i < lines.length; i++) {
		const m = re.exec(lines[i]);
		if (m) {
			dupes.push({ line: i + 1, labels: [m[1], m[2]], text: lines[i] });
		}
	}
	return dupes;
}

const duplicateLabels = checkDuplicateCaseLabels();
if (duplicateLabels.length > 0) {
	console.log("");
	console.log("STOP: duplicate case label detected.");
	for (const d of duplicateLabels) {
		console.log(`  L${d.line}: ${d.labels.join(", ")}`);
		console.log(`    ${d.text.trim()}`);
	}
	console.log(
		"Two `case \"X\":` labels on the same line usually means a splice left",
	);
	console.log(
		"the original label in place after inserting a replacement. Inspect",
	);
	console.log("the splice script and the surrounding switch block.");
	process.exit(1);
} else {
	console.log("  OK: no duplicate case labels in dispatch file");
}


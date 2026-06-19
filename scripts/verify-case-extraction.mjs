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

/**
 * Find the dispatch switch in cli.ts. Returns the line index of the
 * opening `switch (command)` and a function that, given an inner line,
 * returns the depth of `{` from the switch's perspective.
 */
function findSwitch(lines) {
	let switchStart = -1;
	let switchEnd = -1;
	let depth = 0;
	let inSwitch = false;
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i];
		if (!inSwitch && /\bswitch\s*\(\s*command\s*\)/.test(l)) {
			switchStart = i;
			inSwitch = true;
			depth = 0;
		}
		if (inSwitch) {
			for (const ch of l) {
				if (ch === "{") depth++;
				else if (ch === "}") depth--;
			}
			if (depth === 0 && /[{}]/.test(l)) {
				switchEnd = i;
				inSwitch = false;
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

const mainSrc = execSync(`git show ${mainSha}:src/cli.ts`, {
	encoding: "utf8",
});
const mainLines = mainSrc.split("\n");
const { switchStart, switchEnd } = findSwitch(mainLines);
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
		const wrapperInner = normalizeIndent(stripSignature(handler.body));
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
	process.exit(1);
}

function matchesCluster(label, cluster) {
	const map = {
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
	};
	const prefixes = map[cluster] || [cluster];
	return prefixes.some((p) => label.includes(p));
}

function findHandlerForLabel(helpersSrc, label) {
	const parts = label.split(/[-_]/);
	const stripped = parts[0] === "idu" ? parts.slice(1) : parts;
	const pascal = stripped
		.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
		.join("");
	const candidates = [
		`handle${pascal}`,
		`handle${pascal}Tick`,
		`handle${pascal}Control`,
		`handle${pascal}Status`,
	];
	for (const c of candidates) {
		const re = new RegExp(
			`^export\\s+(?:async\\s+)?function\\s+${c}\\b`,
			"m",
		);
		if (re.test(helpersSrc)) return c;
	}
	const exportRe = /^export\s+(?:async\s+)?function\s+(\w+)/gm;
	let m;
	while ((m = exportRe.exec(helpersSrc))) {
		const name = m[1];
		if (
			name.toLowerCase().includes(pascal.toLowerCase()) ||
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

function checkCrossHandlerDuplication() {
	const fileToFns = new Map();
	for (const file of ALL_HANDLER_FILES) {
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
		// guard must compare against the cli.ts that will exist
		// AFTER the PR merges — which is the working tree's cli.ts,
		// not main's pre-PR cli.ts.
		cliSrc = readFileSync("src/cli.ts", "utf8");
	} catch {
		return [];
	}
	const cliInternals = new Set(parseAllFunctionNames(cliSrc));

	const violations = [];
	for (const file of ALL_HANDLER_FILES) {
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
const hasAnyHandler = ALL_HANDLER_FILES.some((f) => {
	try {
		readFileSync(f, "utf8");
		return true;
	} catch {
		return false;
	}
});

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
			console.log(
				`    - ${fn} (defined in cli.ts AND exported by ${handlerFile})`,
			);
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

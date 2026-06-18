#!/usr/bin/env node
/**
 * verify-cluster-move.mjs
 *
 * Byte-identity gate for Item 4 cluster moves. Compares each function in
 * a helpers.ts file against the corresponding function in the main
 * branch's src/cli.ts. Exits non-zero (and prints the offending
 * functions) if any function body differs from main modulo the
 * `export` keyword.
 *
 * Per the auditor's PR 3 feedback: a move-puro PR contains ZERO
 * source changes except (a) the `export` keyword and (b) forced type
 * annotations. Any other delta is a contract violation.
 *
 * Usage:
 *   node scripts/verify-cluster-move.mjs <main-sha> <cluster-name>:<path-to-helpers.ts> [<cluster>:<path> ...]
 *
 * Example:
 *   node scripts/verify-cluster-move.mjs 72dce39 \
 *     alerts:src/cli/alerts/helpers.ts \
 *     agentlab:src/cli/agentlab/helpers.ts \
 *     role:src/cli/role/helpers.ts
 *
 * Exit codes:
 *   0  all functions byte-identical (modulo `export`)
 *   1  one or more functions differ
 *   2  invalid arguments
 *
 * Function extraction algorithm:
 *   The function's closing `}` is the first line at column 0 that is
 *   exactly `}` (optionally followed by `;` and whitespace). This
 *   works because all the cli.ts functions are top-level (not nested)
 *   and the closing `}` is at column 0. Inline-type closing braces
 *   in signatures (like `}): DigestAlertRoutingResult {`) have
 *   content after the `}`, so they don't match.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length < 2) {
	console.error(
		"Usage: verify-cluster-move.mjs <main-sha> <cluster:path> [<cluster:path> ...]",
	);
	process.exit(2);
}

const mainSha = args[0];
const clusters = args.slice(1).map((spec) => {
	const colonIdx = spec.indexOf(":");
	if (colonIdx < 0) {
		console.error(`Invalid cluster spec (missing ':'): ${spec}`);
		process.exit(2);
	}
	return { name: spec.slice(0, colonIdx), file: spec.slice(colonIdx + 1) };
});

const mainSrc = execSync(`git show ${mainSha}:src/cli.ts`, { encoding: "utf8" });
const mainLines = mainSrc.split("\n");

const fnsByCluster = new Map();
for (const c of clusters) {
	const helperSrc = readFileSync(c.file, "utf8");
	const helperLines = helperSrc.split("\n");
	const fns = [];
	// Find every `^export function <name>` (or `^export async function <name>`) in helpers.ts.
	for (let i = 0; i < helperLines.length; i++) {
		const m = helperLines[i].match(/^export (async )?function (\w+)/);
		if (!m) continue;
		const fnName = m[2];
		const newFn = extractFn(helperLines, i);
		if (!newFn) continue;
		const mainFn =
			extractFn(mainLines, 0, `export ${m[1] ?? ""}function ${fnName}`) ??
			extractFn(mainLines, 0, `${m[1] ?? ""}function ${fnName}`);
		if (!mainFn) {
			fns.push({ name: fnName, status: "MISSING_IN_MAIN", body: null });
			continue;
		}
		const mainBody = stripExport(mainFn.body);
		const newBody = stripExport(newFn.body);
		if (mainBody === newBody) {
			fns.push({ name: fnName, status: "OK", body: null });
		} else {
			fns.push({ name: fnName, status: "DIFF", body: { main: mainBody, new: newBody } });
		}
	}
	fnsByCluster.set(c.name, { file: c.file, fns });
}

let totalDiffs = 0;
for (const [name, { file, fns }] of fnsByCluster) {
	console.log(`\n=== ${name} (${file}) ===`);
	for (const fn of fns) {
		if (fn.status === "OK") {
			console.log(`  OK    ${fn.name}`);
		} else if (fn.status === "MISSING_IN_MAIN") {
			totalDiffs++;
			console.log(`  MISS  ${fn.name}  (not found in main @ ${mainSha})`);
		} else {
			totalDiffs++;
			console.log(`  DIFF  ${fn.name}`);
			showBodyDiff(fn.body.main, fn.body.new);
		}
	}
}

console.log("");
console.log("---");
console.log(`Total functions: ${[...fnsByCluster.values()].reduce((s, c) => s + c.fns.length, 0)}`);
console.log(`Total diffs:     ${totalDiffs}`);

if (totalDiffs > 0) {
	console.log("");
	console.log(
		"STOP: byte-identity violated. Per the auditor's PR 3 contract,",
	);
	console.log(
		"a move-puro PR contains ZERO source changes except (a) `export`",
	);
	console.log(
		"and (b) forced type annotations (listed). Revert any non-export",
	);
	console.log("delta OR move it to a separate, labeled PR.");
	process.exit(1);
}

console.log("");
console.log("PASS: all functions byte-identical modulo `export`.");

function extractFn(lines, startHint, pattern) {
	const startIdx = pattern
		? lines.slice(startHint).findIndex((l) => l.startsWith(pattern))
		: 0;
	if (startIdx < 0) return null;
	const realStart = pattern ? startHint + startIdx : startHint;
	// Find the closing `}` at column 0 (optionally followed by `;`).
	// This is the function body's closing brace.
	for (let i = realStart + 1; i < lines.length; i++) {
		if (/^}\s*;?\s*$/.test(lines[i])) {
			return {
				body: lines.slice(realStart, i + 1).join("\n"),
				startLine: realStart + 1,
				endLine: i + 1,
			};
		}
	}
	return null;
}

function stripExport(body) {
	return body.replace(/^export (async )?function /, "$1function ");
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
	if (shown === 8) console.log("    ... (truncated; full diff available on request)");
}
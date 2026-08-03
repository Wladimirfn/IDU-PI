#!/usr/bin/env node
// Audits config/cluster-map.json against the tools actually registered in
// src/mcp-server.ts. Designed to run in CI on every PR/push, so a stale
// cluster map cannot merge the way a stale protocol table did.
//
// Four hard checks (any failure -> exit 1):
//   integrity   JSON parses and has the expected shape
//   coverage    every registered tool appears in the cluster map
//   orphan      every name in the cluster map is registered
//   duplicate   each tool appears exactly once
//
// Total tool count is reported as a stat but is never a failure condition.
// A legitimate 90th tool should add itself; the gate that fails for that
// reason would teach people to edit the guard to silence it.
//
// --emit-md writes a human-readable report to the path given by --md-out
// (default: docs/cluster-map.md). The .md is a view of the JSON, not a
// second source of truth.
//
// --verify combines --emit-md with a working-tree dirty check
// (`git status --porcelain`). It is what CI runs. Exit 0 only if the
// emitted .md matches what is already committed — i.e. the committed
// .md is in sync with the JSON.
//
// --map <path> audits a candidate map file instead of the committed one.
// Useful for local experimentation; CI does not pass it.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SERVER = "src/mcp-server.ts";
const MAP = "config/cluster-map.json";
const DEFAULT_MD_OUT = "docs/cluster-map.md";

const REGISTRATION = /\btool\(\s*["'`](idu_[a-z0-9_]+)["'`]/g;

const args = process.argv.slice(2);
const emitMd = args.includes("--emit-md") || args.includes("--verify");
const verify = args.includes("--verify");
const mdOutArgIdx = args.indexOf("--md-out");
const mdOut = mdOutArgIdx >= 0 ? args[mdOutArgIdx + 1] : DEFAULT_MD_OUT;
const mapArgIdx = args.indexOf("--map");
const mapPath = mapArgIdx >= 0 ? args[mapArgIdx + 1] : MAP;

function readOrFail(path) {
	if (!existsSync(path)) {
		console.error(`[cluster-drift] missing file: ${path}`);
		process.exit(2);
	}
	return readFileSync(path, "utf8");
}

const cwd = process.cwd();
const serverSrc = readOrFail(resolve(cwd, SERVER));
const mapSrc = readOrFail(resolve(cwd, mapPath));

// Parse registered tools from src/mcp-server.ts.
const registered = [...new Set(
	[...serverSrc.matchAll(REGISTRATION)].map((m) => m[1]),
)].sort();

if (registered.length === 0) {
	console.error(
		`[cluster-drift] parsed 0 tool registrations from ${SERVER}. ` +
			`The registration pattern likely changed — fix REGISTRATION in this ` +
			`script rather than trusting a vacuous pass.`,
	);
	process.exit(2);
}

// Parse cluster map.
let map;
try {
	map = JSON.parse(mapSrc);
} catch (e) {
	console.error(`[cluster-drift] FAIL: ${MAP} is not valid JSON: ${e.message}`);
	process.exit(1);
}

// integrity: shape.
const issues = [];
if (typeof map !== "object" || map === null) {
	issues.push(`${mapPath} is not a JSON object`);
} else if (typeof map.version !== "number") {
	issues.push(`${mapPath}.version must be a number`);
} else if (!Array.isArray(map.tools)) {
	issues.push(`${mapPath}.tools must be an array`);
} else {
	for (let i = 0; i < map.tools.length; i++) {
		const t = map.tools[i];
		if (typeof t !== "object" || t === null) {
			issues.push(`${mapPath}.tools[${i}] is not an object`);
			continue;
		}
		if (typeof t.name !== "string" || !/^idu_[a-z0-9_]+$/.test(t.name)) {
			issues.push(`${mapPath}.tools[${i}].name is not a valid idu_* string`);
		}
		if (typeof t.cluster !== "string" || t.cluster.length === 0) {
			issues.push(`${mapPath}.tools[${i}].cluster must be a non-empty string`);
		}
	}
}

if (issues.length > 0) {
	console.error(`[cluster-drift] FAIL: integrity:\n  ${issues.join("\n  ")}`);
	process.exit(1);
}

// coverage, orphan, duplicate.
const registeredSet = new Set(registered);
const mapNames = map.tools.map((t) => t.name);
const mapNameCounts = new Map();
for (const n of mapNames) mapNameCounts.set(n, (mapNameCounts.get(n) ?? 0) + 1);

const missingFromMap = registered.filter((n) => !mapNameCounts.has(n));
const orphans = mapNames.filter((n) => !registeredSet.has(n));
const duplicates = [...mapNameCounts.entries()]
	.filter(([, c]) => c > 1)
	.map(([n, c]) => `${n} x${c}`);

let failed = false;
if (missingFromMap.length > 0) {
	console.error(
		`[cluster-drift] FAIL: ${missingFromMap.length} registered tool(s) missing from ${mapPath}:\n  ${missingFromMap.join("\n  ")}`,
	);
	failed = true;
}
if (orphans.length > 0) {
	console.error(
		`[cluster-drift] FAIL: ${orphans.length} name(s) in ${mapPath} are not registered:\n  ${orphans.join("\n  ")}`,
	);
	failed = true;
}
if (duplicates.length > 0) {
	console.error(
		`[cluster-drift] FAIL: ${duplicates.length} duplicate(s) in ${mapPath}:\n  ${duplicates.join("\n  ")}`,
	);
	failed = true;
}

// Cluster stats (informational only).
const clusterSize = new Map();
for (const t of map.tools) {
	clusterSize.set(t.cluster, (clusterSize.get(t.cluster) ?? 0) + 1);
}
const clusters = [...clusterSize.entries()].sort((a, b) =>
	a[0].localeCompare(b[0]),
);

console.log(
	`[cluster-drift] registered: ${registered.length} | ` +
		`clustered: ${map.tools.length} | clusters: ${clusters.length} | ` +
		`missing: ${missingFromMap.length} | orphan: ${orphans.length} | ` +
		`duplicate: ${duplicates.length}`,
);
if (!failed) {
	console.log(`[cluster-drift] cluster distribution:`);
	for (const [c, n] of clusters) console.log(`  ${c}: ${n}`);
}

if (failed) process.exit(1);

// --emit-md: regenerate the human view. Caller verifies clean tree.
if (emitMd) {
	const mdLines = [];
	mdLines.push(`# Cluster map for idu-pi MCP tools (${registered.length} tools)`);
	mdLines.push("");
	mdLines.push(
		"> Auto-generated from `config/cluster-map.json` by `scripts/check-cluster-map-drift.mjs --emit-md`.",
	);
	mdLines.push(
		"> Do not edit by hand. To change a cluster, edit the JSON and re-run the script.",
	);
	mdLines.push("");
	mdLines.push(`Registered tools: **${registered.length}**. Clusters: **${clusters.length}**.`);
	mdLines.push("");
	mdLines.push("| Cluster | Size | Tools |");
	mdLines.push("|---|---:|---|");
	for (const [c, n] of clusters) {
		const tools = map.tools
			.filter((t) => t.cluster === c)
			.map((t) => t.name)
			.sort()
			.map((n) => `\`${n}\``)
			.join(", ");
		mdLines.push(`| \`${c}\` | ${n} | ${tools} |`);
	}
	mdLines.push("");
	mdLines.push(`## All tools (alphabetical)`);
	mdLines.push("");
	mdLines.push("| Tool | Cluster |");
	mdLines.push("|---|---|");
	for (const t of [...map.tools].sort((a, b) => a.name.localeCompare(b.name))) {
		mdLines.push(`| \`${t.name}\` | \`${t.cluster}\` |`);
	}
	mdLines.push("");
	const out = mdLines.join("\n") + "\n";
	const outPath = resolve(cwd, mdOut);
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, out);
	console.log(`[cluster-drift] wrote ${mdOut}`);
}

// --verify: confirm the committed .md matches what we just emitted. The
// emitted file may have been committed as-is (clean) or regenerated to
// match a JSON change (also clean). Anything else — untracked, modified,
// staged-and-different — is drift that CI must catch.
if (verify) {
	const { execSync } = await import("node:child_process");
	let dirty;
	try {
		dirty = execSync(`git status --porcelain -- ${mdOut}`, {
			cwd,
			encoding: "utf8",
		});
	} catch (e) {
		console.error(
			`[cluster-drift] FAIL: could not run git status --porcelain -- ${mdOut}: ${e.message}`,
		);
		process.exit(1);
	}
	if (dirty.trim().length > 0) {
		console.error(
			`[cluster-drift] FAIL: ${mdOut} is out of sync with ${mapPath}. ` +
				`Either run \`pnpm check:cluster-drift:emit\` and commit the .md, ` +
				`or revert the JSON change.\n${dirty.trim()}`,
		);
		process.exit(1);
	}
	console.log(`[cluster-drift] ${mdOut} is in sync with ${mapPath}.`);
}

process.exit(0);

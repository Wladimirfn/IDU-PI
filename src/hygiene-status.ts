/**
 * hygiene-status.ts — read-only surface for the hygiene sensor state.
 *
 * Consumed by:
 * - src/mcp-server.ts (idu_hygiene_status tool)
 * - src/cli.ts (idu-hygiene-status command)
 * - profile documentation
 *
 * Reads from:
 * - <stateRoot>/hygiene-sensor-last.json (snapshot from the last cron tick)
 * - <stateRoot>/hygiene-patterns.json (per-project override, optional)
 * - <stateRoot>/injections.jsonl (count of un-acked hygiene_junk_file)
 *
 * NEVER writes — this is the read surface. Writes happen in the cron
 * preflight (sensor run) and in idu_pending_injections ack:true
 * (telemetry recording).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadJunkPatterns } from "./junk-patterns.js";
import type { JunkPatterns } from "./junk-patterns.js";

export type Finding = {
	path: string;
	pattern: string;
	severity: "info" | "warning";
	fingerprint: string;
};

export type SensorSnapshot = {
	ts: string;
	scannedPaths: number;
	matchedPaths: number;
	truncated: boolean;
	findings: Finding[];
};

export type HygieneStatus = {
	lastRun: SensorSnapshot | null;
	patterns: JunkPatterns;
	pendingInjections: number;
};

/** Read the current sensor state. Read-only; never writes. */
export function readHygieneStatus(stateRoot: string): HygieneStatus {
	const snapshotPath = join(stateRoot, "hygiene-sensor-last.json");
	let lastRun: SensorSnapshot | null = null;
	if (existsSync(snapshotPath)) {
		try {
			const raw = readFileSync(snapshotPath, "utf8");
			const parsed = JSON.parse(raw) as SensorSnapshot;
			if (
				typeof parsed.ts === "string" &&
				typeof parsed.scannedPaths === "number" &&
				typeof parsed.matchedPaths === "number" &&
				typeof parsed.truncated === "boolean" &&
				Array.isArray(parsed.findings)
			) {
				lastRun = parsed;
			}
		} catch {
			// malformed JSON — fail safe to null
			lastRun = null;
		}
	}

	const patterns = loadJunkPatterns(stateRoot);
	const pendingInjections = countUnackedHygieneInjections(stateRoot);

	return { lastRun, patterns, pendingInjections };
}

/** Count un-acked hygiene_junk_file injections in <stateRoot>/injections.jsonl. */
function countUnackedHygieneInjections(stateRoot: string): number {
	const path = join(stateRoot, "injections.jsonl");
	if (!existsSync(path)) return 0;
	let count = 0;
	const lines = readFileSync(path, "utf8").split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const obj = JSON.parse(trimmed) as { kind?: string; acked?: boolean };
			if (obj.kind === "hygiene_junk_file" && obj.acked === false) {
				count++;
			}
		} catch {
			// skip malformed lines
		}
	}
	return count;
}

/** Format the status as a multi-line text report. Used by the CLI. */
export function formatHygieneStatus(status: HygieneStatus): string {
	const lines: string[] = [];
	lines.push("idu-pi hygiene status");
	lines.push("");

	if (status.lastRun) {
		lines.push(`Last run: ${status.lastRun.ts} (scanned ${status.lastRun.scannedPaths}, matched ${status.lastRun.matchedPaths}${status.lastRun.truncated ? ", truncated" : ""})`);
	} else {
		lines.push("Last run: never run");
	}

	lines.push(
		`Patterns: canonical=${status.patterns.canonical.length}, blocklist=${status.patterns.blocklist.length}, allowlist=${status.patterns.allowlist.length}`,
	);
	lines.push(`Pending injections: ${status.pendingInjections}`);

	if (status.lastRun && status.lastRun.findings.length > 0) {
		lines.push("");
		lines.push("Findings:");
		for (const f of status.lastRun.findings) {
			lines.push(`- ${f.path} (matched: ${f.pattern})`);
		}
	}

	return lines.join("\n") + "\n";
}

/**
 * Run the CLI command `idu-hygiene-status` against a stateRoot and
 * return the output. Used by tests to verify the CLI surface.
 * In production this is wired into src/cli.ts's main switch.
 */
export function runHygieneStatusCli(stateRoot: string, _repoRoot: string): { exitCode: number; stdout: string } {
	const status = readHygieneStatus(stateRoot);
	const stdout = formatHygieneStatus(status);
	return { exitCode: 0, stdout };
}

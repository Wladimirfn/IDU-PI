// src/lockfile-cleanup-command.ts
//
// CLI-only safe lockfile cleanup surface (spec #3098 rev4, design #3099 rev3).
//
// This module holds CLI-facing orchestration ONLY: flag parsing and output
// formatting. The pure, testable primitives (classifyLockfile / listLockfiles
// / cleanupStaleLockfiles) live in state-root-file-lock.ts. This command is
// NEVER exported from the MCP server and MUST NOT be invoked from any
// automatic code path (acquire / persist / postflight). It is reachable only
// via the explicit human operator command `idu lock-cleanup`.

import {
	cleanupStaleLockfiles,
	listLockfiles,
	type CleanupAction,
	type LockfileListing,
} from "./state-root-file-lock.js";
import { realpathSync } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";

export type LockCleanupInput = {
	/** Directory scanned for `*.lock` files (typically `${stateRoot}/reports`). */
	targetDir: string;
	/** When false (default) the command is a read-only listing. */
	confirm: boolean;
	/** When set, --confirm refuses if `targetDir` canonicalizes outside `allowedRoot` (path confinement). */
	allowedRoot?: string;
};

export type LockCleanupOutput = {
	exitCode: number;
	stdout: string;
};

/**
 * Parse `idu lock-cleanup` flags.
 *
 * - `--confirm`              → destructive-confirmation (enables deletion).
 * - `--state-root <path>`    → override stateRoot (resolved to reports dir by
 * - `--state-root=<path>`      the handler; this parser only captures it).
 *
 * Anything else is ignored (forward-compatible). Defaults to read-only.
 */
export function parseLockCleanupArgs(rest: string[]): {
	confirm: boolean;
	stateRoot?: string;
} {
	let confirm = false;
	let stateRoot: string | undefined;
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i]!;
		if (arg === "--confirm") {
			confirm = true;
			continue;
		}
		if (arg === "--state-root") {
			const next = rest[i + 1];
			if (next) {
				stateRoot = next;
				i++;
			}
			continue;
		}
		if (arg.startsWith("--state-root=")) {
			stateRoot = arg.slice("--state-root=".length);
			continue;
		}
	}
	return stateRoot === undefined ? { confirm } : { confirm, stateRoot };
}

/** Confined if `candidate` canonicalizes within `root` (realpath defeats symlink/relative escapes). */
function isPathConfined(candidate: string, root: string): boolean {
	try {
		const realRoot = realpathSync(root);
		let realCandidate: string;
		try {
			realCandidate = realpathSync(candidate);
		} catch {
			realCandidate = resolve(realpathSync(dirname(candidate)), basename(candidate));
		}
		return realCandidate === realRoot || realCandidate.startsWith(realRoot + sep);
	} catch {
		return false;
	}
}

/**
 * Run the lock-cleanup command against `targetDir`.
 *
 * - `confirm: false` → read-only listing with per-entry verdicts, exit 0,
 *   deletes nothing.
 * - `confirm: true` → deletes ONLY verified-dead local PIDs; refuses every
 *   other holder; exit 1 if any entry was refused, else 0.
 */
export async function runLockCleanup(
	input: LockCleanupInput,
): Promise<LockCleanupOutput> {
	if (input.confirm) {
		if (input.allowedRoot !== undefined && !isPathConfined(input.targetDir, input.allowedRoot)) {
			return {
				exitCode: 1,
				stdout: [
					"idu-pi lock-cleanup — REFUSED",
					"targetDir escapes the resolved runtime stateRoot (path confinement).",
					"Destructive cleanup may target only the canonical runtime stateRoot.",
				].join("\n"),
			};
		}
		const result = await cleanupStaleLockfiles(input.targetDir, {
			confirmDelete: true,
		});
		return {
			exitCode: result.exitCode,
			stdout: formatCleanupActions(result.actions),
		};
	}

	const listings = listLockfiles(input.targetDir);
	return {
		exitCode: 0,
		stdout: formatLockListing(listings),
	};
}

export function formatLockListing(listings: LockfileListing[]): string {
	const header = [
		"idu-pi lock-cleanup — READ-ONLY listing (use --confirm to delete verified-dead holders)",
		"",
	];
	if (listings.length === 0) {
		return [...header, "No lockfiles found."].join("\n");
	}
	const rows = listings.map((entry) => {
		const pid = entry.holderPid === undefined ? "-" : String(entry.holderPid);
		const host = entry.holderHost ?? "-";
		const startedAt = entry.holderStartedAt ?? "-";
		return `${entry.lockPath}\n  pid=${pid} host=${host} startedAt=${startedAt}\n  verdict=${entry.verdict}`;
	});
	return [...header, ...rows].join("\n");
}

export function formatCleanupActions(actions: CleanupAction[]): string {
	const header = [
		"idu-pi lock-cleanup — --confirm mode (verified-dead local PIDs only)",
		"",
	];
	if (actions.length === 0) {
		return [...header, "No lockfiles found."].join("\n");
	}
	const rows = actions.map((action) => {
		if (action.action === "deleted") {
			const startedAt = action.startedAt ? ` startedAt=${action.startedAt}` : "";
			return `${action.lockPath}\n  action=deleted pid=${action.pid}${startedAt}`;
		}
		return `${action.lockPath}\n  action=refused verdict=${action.verdict} reason=${action.reason}`;
	});
	const deleted = actions.filter((a) => a.action === "deleted").length;
	const refused = actions.filter((a) => a.action === "refused").length;
	const summary = `\nSummary: deleted=${deleted} refused=${refused}`;
	return [...header, ...rows, summary].join("\n");
}

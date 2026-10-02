import { appendFileSync, existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { IDU_HOME, ensureIduDirectories } from "./config.js";

export interface DecisionRecord {
	id?: number;
	projectId: string;
	decidedAt?: string;
	decidedBy: string;
	decision: string;
	targetKind: string;
	targetId: string;
	rationale?: string;
	profileRef?: string;
}

export interface ListDecisionsOptions {
	projectId?: string;
	limit?: number;
}

function getLedgerPath(): string {
	ensureIduDirectories();
	return join(IDU_HOME, "decisions.jsonl");
}

function getLegacyPath(): string {
	return join(IDU_HOME, "decision_ledger.json");
}

/**
 * One decision per line, appended.
 *
 * This is a log, not a document. The previous version kept the whole ledger as
 * one JSON array and rewrote it on every entry, which is a read-modify-write
 * over a shared file: two writers read the same state, both write, and one
 * entry is silently gone. Worse, a reader that caught the file mid-rewrite saw
 * unparseable JSON, and the old code read that as "no decisions yet" and wrote
 * a one-entry file over the top. Fourteen entries became one, with no error.
 *
 * An append does not have either failure. There is no read to lose: the append
 * lands or it does not, and the OS serialises concurrent appends of the same
 * file. A line that fails to parse costs one decision, never the file.
 *
 * `id` is informational and best-effort. Two writers that start at the same
 * millisecond can compute the same one. That is cosmetic next to the failure it
 * replaces: under the old design, colliding writers meant a lost decision.
 */
function readEntries(path: string): DecisionRecord[] {
	if (!existsSync(path)) return [];
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return [];
	}
	const out: DecisionRecord[] = [];
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const entry = JSON.parse(trimmed) as DecisionRecord;
			// A malformed line is skipped, not fatal: the rest of the log is
			// still readable and still worth showing.
			if (entry && typeof entry === "object" && typeof entry.decision === "string") {
				out.push(entry);
			}
		} catch {
			/* one bad line costs one decision, not the file */
		}
	}
	return out;
}

/**
 * Brings a `decision_ledger.json` written by the previous format over, once.
 * The old file is renamed rather than deleted so nothing is destroyed by a
 * migration that turns out wrong.
 */
function migrateLegacyIfPresent(path: string): void {
	const legacy = getLegacyPath();
	if (!existsSync(legacy)) return;
	// Only ever migrates into an empty log, and never from a file it cannot
	// parse. Both rules exist so a migration can never make things worse than
	// leaving the old file alone.
	if (readEntries(path).length > 0) return;
	const entries = readLegacyJson(legacy);
	if (!entries || entries.length === 0) return;
	appendEntries(path, entries);
	try {
		renameSync(legacy, `${legacy}.migrated-${randomUUID().slice(0, 8)}`);
	} catch {
		/* migration already succeeded; leaving the old file is the safe outcome */
	}
}

function readLegacyJson(legacyPath: string): DecisionRecord[] | null {
	try {
		const parsed = JSON.parse(readFileSync(legacyPath, "utf8")) as unknown;
		if (!Array.isArray(parsed)) return null;
		return parsed.filter(
			(e): e is DecisionRecord =>
				!!e && typeof e === "object" && typeof (e as DecisionRecord).decision === "string",
		);
	} catch {
		// Unparseable legacy file: leave it alone rather than destroy it.
		return null;
	}
}

function appendEntries(path: string, entries: DecisionRecord[]): void {
	if (entries.length === 0) return;
	const payload = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
	appendFileSync(path, payload, "utf8");
}

export function recordDecision(record: DecisionRecord): DecisionRecord {
	const filePath = getLedgerPath();
	migrateLegacyIfPresent(filePath);

	const previous = readEntries(filePath);
	const nextId = previous.length > 0 ? Math.max(...previous.map((d) => d.id || 0)) + 1 : 1;

	const entry: DecisionRecord = {
		id: nextId,
		projectId: record.projectId,
		decidedAt: record.decidedAt || new Date().toISOString(),
		decidedBy: record.decidedBy,
		decision: record.decision,
		targetKind: record.targetKind,
		targetId: record.targetId,
		rationale: record.rationale,
		profileRef: record.profileRef,
	};

	// One append, one line. Nothing read-modify-written, nothing truncated.
	appendEntries(filePath, [entry]);
	return entry;
}

export function listDecisions(options: ListDecisionsOptions = {}): DecisionRecord[] {
	const filePath = getLedgerPath();
	migrateLegacyIfPresent(filePath);
	const list = readEntries(filePath);
	// Newest first, matching what the previous implementation returned.
	const newestFirst = [...list].reverse();
	const filtered = options.projectId
		? newestFirst.filter((d) => d.projectId === options.projectId)
		: newestFirst;
	return filtered.slice(0, options.limit ?? 20);
}

/** Exposed for the migration test only; not part of the tool surface. */
export function __ledgerPaths(): { current: string; legacy: string } {
	return { current: getLedgerPath(), legacy: getLegacyPath() };
}

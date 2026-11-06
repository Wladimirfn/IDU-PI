import { appendFileSync, existsSync, readFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ensureIduDirectories, IDU_SESSIONS_DIR } from "./config.js";
import type { SessionTreeEntry } from "./types.js";

const SESSION_TREE_PATH = join(IDU_SESSIONS_DIR, "tree.json");
const SESSION_TREE_LOG_PATH = join(IDU_SESSIONS_DIR, "tree.jsonl");

/**
 * The session tree is a log of upserts, not a document.
 *
 * It used to be one JSON object rewritten in full by every finished run. Two
 * runs finishing at the same time (which `idu_delegate_parallel` produces on
 * purpose) read the same tree, both wrote, and one session vanished. And a
 * reader that caught the file mid-rewrite got unparseable JSON, was handed an
 * empty object, and then wrote that object back over everything.
 *
 * An append has neither failure. Every run appends one line; a line that does
 * not parse costs one run's record, never the file.
 */
export function loadSessionTree(): Record<string, SessionTreeEntry> {
	ensureIduDirectories();
	migrateSessionTreeJson();

	if (!existsSync(SESSION_TREE_LOG_PATH)) return {};
	const out: Record<string, SessionTreeEntry> = {};
	let raw: string;
	try {
		raw = readFileSync(SESSION_TREE_LOG_PATH, "utf8");
	} catch {
		return {};
	}
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const record = JSON.parse(trimmed) as { key?: unknown; entry?: unknown };
			if (typeof record?.key !== "string" || !record.entry || typeof record.entry !== "object") continue;
			out[record.key] = record.entry as SessionTreeEntry;
		} catch {
			/* one torn line costs one run's record, not the tree */
		}
	}
	return out;
}

/**
 * Records one session entry by appending it. The caller must not load, mutate
 * and save: that shape is what loses entries when two writers overlap, and
 * verifying after the write does not help because the loser already returned.
 */
export function upsertSessionTreeEntry(key: string, entry: SessionTreeEntry): void {
	ensureIduDirectories();
	migrateSessionTreeJson();
	appendFileSync(SESSION_TREE_LOG_PATH, `${JSON.stringify({ key, entry })}\n`, "utf8");
}

/**
 * Brings a `tree.json` written by the previous format over, once. The old file
 * is renamed rather than deleted, and an unreadable one is left untouched.
 */
function migrateSessionTreeJson(): void {
	if (!existsSync(SESSION_TREE_PATH)) return;
	if (existsSync(SESSION_TREE_LOG_PATH) && readFileSyncSafe(SESSION_TREE_LOG_PATH) !== "") return;

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(SESSION_TREE_PATH, "utf8"));
	} catch {
		// Torn legacy file. Leaving it in place keeps it recoverable by hand;
		// writing an empty log over it would destroy it.
		return;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;

	const payload = Object.entries(parsed as Record<string, SessionTreeEntry>)
		.map(([key, entry]) => `${JSON.stringify({ key, entry })}\n`)
		.join("");
	if (payload) appendFileSync(SESSION_TREE_LOG_PATH, payload, "utf8");
	try {
		renameSync(SESSION_TREE_PATH, `${SESSION_TREE_PATH}.migrated-${randomUUID().slice(0, 8)}`);
	} catch {
		/* migration already succeeded; leaving the old file is the safe outcome */
	}
}

function readFileSyncSafe(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

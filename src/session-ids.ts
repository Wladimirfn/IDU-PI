import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { SessionTreeEntry } from "./types.js";

export function isUuid(str: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

export function aliasToUuid(alias: string): string {
	if (isUuid(alias)) return alias;
	const hash = createHash("sha256").update(alias).digest("hex");
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function getSessionKey(cwd: string, sessionId: string): string {
	return `${resolve(cwd)}::${sessionId}`;
}

/**
 * Find the tree entry that owns a session id, accepting either spelling.
 *
 * A Claude session given as an alias is persisted under its deterministic UUID
 * (`aliasToUuid`), so a lookup with the raw alias follows a key that was never
 * written. That miss dropped profile inheritance on resume and fell back to a
 * default profile belonging to a different harness. Try the raw key first, then
 * the mapped one.
 */
export function findOwnerSessionEntry(
	tree: Record<string, SessionTreeEntry>,
	workingDir: string,
	sessionId: string | undefined,
): SessionTreeEntry | undefined {
	const raw = sessionId?.trim();
	if (!raw) return undefined;
	const rawKey = getSessionKey(workingDir, raw);
	if (tree[rawKey]) return tree[rawKey];
	const mappedKey = getSessionKey(workingDir, aliasToUuid(raw));
	return mappedKey === rawKey ? undefined : tree[mappedKey];
}

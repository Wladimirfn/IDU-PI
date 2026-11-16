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

function asJsonRecord(line: string): Record<string, unknown> | null {
	const t = line.trim();
	if (!t.startsWith("{") || !t.endsWith("}")) return null;
	try {
		const parsed: unknown = JSON.parse(t);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pickNestedString(parent: unknown, keys: string[]): string | undefined {
	if (!parent || typeof parent !== "object" || Array.isArray(parent)) return undefined;
	const rec = parent as Record<string, unknown>;
	for (const key of keys) {
		const hit = nonEmptyString(rec[key]);
		if (hit) return hit;
	}
	return undefined;
}

/**
 * Extracts a CLI harness's own native session/conversation/thread ID from raw
 * stdout/log text. Prefers parsed top-level JSON event fields so text discussed
 * inside an assistant message cannot spoof a native session ID.
 */
export function extractNativeSessionId(fullOutput: string, harness: string): string | undefined {
	if (!fullOutput || !harness) return undefined;
	const h = harness.toLowerCase();

	for (const line of fullOutput.split(/\r?\n/)) {
		const obj = asJsonRecord(line);
		if (!obj) continue;

		if (h === "opencode") {
			const sid = nonEmptyString(obj.sessionID);
			if (sid) return sid;
		} else if (h === "antigravity" || h === "agy") {
			const hit =
				pickNestedString(obj, ["conversation_id", "conversationId"]) ||
				pickNestedString(obj.result, ["conversation_id", "conversationId"]) ||
				pickNestedString(obj.step_update, ["conversation_id", "conversationId"]);
			if (hit) return hit;
		} else if (h === "commandcode" || h === "cmdc") {
			const top = nonEmptyString(obj.sessionId);
			if (top) return top;
			if (obj.event && typeof obj.event === "object") {
				const ev = obj.event as Record<string, unknown>;
				const evSid = nonEmptyString(ev.sessionId) || pickNestedString(ev.result, ["sessionId"]);
				if (evSid) return evSid;
			}
		} else if (h === "mcode" || h === "minimax-code") {
			const hit = nonEmptyString(obj.sessionId) || pickNestedString(obj.result, ["sessionId"]);
			if (hit) return hit;
		} else if (h === "codex") {
			const tid = nonEmptyString(obj.thread_id);
			if (tid) return tid;
		} else if (h === "claude" || h === "claude-code" || h === "qwen" || h === "qwen-code") {
			const sid = nonEmptyString(obj.session_id);
			if (sid) return sid;
		} else if (h === "pi" || h === "pi-cli" || h === "gentle-shell") {
			if (obj.type === "session") {
				const sid = nonEmptyString(obj.id);
				if (sid) return sid;
			}
		} else if (h === "kimi" || h === "kimi-code") {
			if (obj.type === "session.resume_hint") {
				const sid = nonEmptyString(obj.session_id);
				if (sid) return sid;
			}
		}
	}

	// Regex fallback when stdout ended on an incomplete/unclosed JSON line
	if (h === "opencode") {
		return fullOutput.match(/"sessionID"\s*:\s*"([^"]+)"/)?.[1];
	}
	if (h === "antigravity" || h === "agy") {
		return fullOutput.match(/"conversation_?id"\s*:\s*"([^"]+)"/i)?.[1];
	}
	if (h === "commandcode" || h === "cmdc" || h === "mcode" || h === "minimax-code") {
		return fullOutput.match(/"sessionId"\s*:\s*"([^"]+)"/i)?.[1];
	}
	if (h === "codex") {
		return fullOutput.match(/"thread_id"\s*:\s*"([^"]+)"/)?.[1];
	}
	if (h === "claude" || h === "claude-code" || h === "qwen" || h === "qwen-code") {
		return fullOutput.match(/"session_id"\s*:\s*"([^"]+)"/)?.[1];
	}
	if (h === "pi" || h === "pi-cli" || h === "gentle-shell") {
		return fullOutput.match(/"type"\s*:\s*"session"[^\r\n]*?"id"\s*:\s*"([^"]+)"/)?.[1];
	}
	if (h === "kimi" || h === "kimi-code") {
		return fullOutput.match(/"type"\s*:\s*"session\.resume_hint"[^\r\n]*?"session_id"\s*:\s*"([^"]+)"/)?.[1];
	}

	return undefined;
}

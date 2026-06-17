/**
 * junk-patterns.ts — canonical + per-project junk pattern set.
 *
 * The canonical set is auditor-approved (#2456). node_modules/,
 * __pycache__/, .vs/, .idea/ are EXCLUDED on purpose — those are
 * dependencies and IDE state, not garbage. Garbage is what idu-pi or
 * other tools ACCIDENTALLY leave behind.
 *
 * Per-project override: <stateRoot>/hygiene-patterns.json with shape
 *   { "blocklist": [...], "allowlist": [...] }
 *
 * Fail-safe: malformed or missing JSON falls back to canonical-only.
 * We never crash a scan over a bad config file.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Auditor-approved canonical pattern set (#2456). Do not extend without
// re-reviewing the auditor rationale (deps/IDE excluded by design).
export const CANONICAL_PATTERNS = [
	".DS_Store",
	"Thumbs.db",
	"*.bak",
	"*~",
	"*.swp",
	"tmp-*.mjs",
	"tmp-*.cjs",
	"sdd-*-output.md",
] as const;

export type JunkPatterns = {
	canonical: readonly string[];
	blocklist: readonly string[];
	allowlist: readonly string[];
};

export type CompiledJunkPatterns = {
	/** Effective set: canonical + blocklist, deduplicated. */
	patterns: readonly string[];
	/** Raw inputs preserved for callers that want to introspect. */
	raw: JunkPatterns;
};

/**
 * Read per-project junk pattern override from
 * <stateRoot>/hygiene-patterns.json. Fail-safe: any error (missing file,
 * malformed JSON, non-object) returns canonical-only with empty lists.
 */
export function loadJunkPatterns(stateRoot: string): JunkPatterns {
	const canonical: readonly string[] = CANONICAL_PATTERNS;
	const blocklist: string[] = [];
	const allowlist: string[] = [];

	const overridePath = join(stateRoot, "hygiene-patterns.json");
	if (!existsSync(overridePath)) {
		return { canonical, blocklist, allowlist };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(overridePath, "utf8"));
	} catch {
		// Fail-safe: malformed JSON -> canonical-only.
		return { canonical, blocklist, allowlist };
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		// Fail-safe: not a plain object -> canonical-only.
		return { canonical, blocklist, allowlist };
	}

	const obj = parsed as Record<string, unknown>;
	if (Array.isArray(obj.blocklist)) {
		for (const item of obj.blocklist) {
			if (typeof item === "string" && item.length > 0) {
				blocklist.push(item);
			}
		}
	}
	if (Array.isArray(obj.allowlist)) {
		for (const item of obj.allowlist) {
			if (typeof item === "string" && item.length > 0) {
				allowlist.push(item);
			}
		}
	}

	return { canonical, blocklist, allowlist };
}

/**
 * Compute the effective pattern set:
 *   canonical + blocklist, then allowlist removed (by exact pattern string).
 *
 * Two-layer allowlist semantics:
 *   1. Exact-string removal at compile time: `allowlist: ["*.bak"]` drops
 *      a canonical or blocklist pattern with the exact name "*.bak".
 *   2. Path-level filtering at sensor match time: `allowlist: ["tmp-debug.mjs"]`
 *      suppresses a match against the canonical `tmp-*.mjs` glob for that
 *      specific file (handled in `hygiene-sensor.ts`).
 *
 * This gives projects both knobs: drop a known pattern entirely, or
 * whitelist a specific path under a broader pattern.
 */
export function compileJunkPatterns(patterns: JunkPatterns): CompiledJunkPatterns {
	const allow = new Set(patterns.allowlist);
	const seen = new Set<string>();
	const effective: string[] = [];

	for (const p of patterns.canonical) {
		if (allow.has(p)) continue;
		if (seen.has(p)) continue;
		seen.add(p);
		effective.push(p);
	}
	for (const p of patterns.blocklist) {
		if (allow.has(p)) continue;
		if (seen.has(p)) continue;
		seen.add(p);
		effective.push(p);
	}

	return { patterns: effective, raw: patterns };
}

/**
 * Convert a glob pattern to a RegExp. Supports:
 *   - exact match  (e.g. ".DS_Store")
 *   - `*`          (any chars except `/`)
 *   - `**`         (any chars, including `/`)
 *   - `?`          (single non-`/` char)
 *
 * The compiled regex tests against the **relative path** from the repo
 * root, using forward slashes for portability (POSIX-style). Callers
 * must normalize backslashes to `/` before testing.
 *
 * Patterns without a `/` are treated as basename globs: the regex will
 * match the pattern as the final path segment at any depth
 * (`a/b/<pattern>`, `<pattern>`, etc.). Patterns that contain `/` are
 * matched against the full relative path.
 */
export function globToRegex(pattern: string): RegExp {
	const isBasename = !pattern.includes("/");
	const compiled = compileGlobBody(pattern);
	const regex = isBasename
		? `^(?:.*/)?${compiled}$`
		: `^${compiled}$`;
	return new RegExp(regex);
}

function compileGlobBody(pattern: string): string {
	let regex = "";
	let i = 0;
	while (i < pattern.length) {
		const ch = pattern[i];
		if (ch === "*") {
			if (pattern[i + 1] === "*") {
				// `**` matches anything including `/`.
				// If followed by `/`, swallow the slash so `**/foo` matches
				// `foo` at the root and `a/b/foo` deeper.
				if (pattern[i + 2] === "/") {
					regex += "(?:.*/)?";
					i += 3;
					continue;
				}
				regex += ".*";
				i += 2;
				continue;
			}
			// Single `*` matches anything except `/`.
			regex += "[^/]*";
			i += 1;
			continue;
		}
		if (ch === "?") {
			regex += "[^/]";
			i += 1;
			continue;
		}
		if (ch === "." || ch === "(" || ch === ")" || ch === "+" || ch === "|" ||
			ch === "^" || ch === "$" || ch === "{" || ch === "}" || ch === "\\") {
			regex += "\\" + ch;
			i += 1;
			continue;
		}
		regex += ch;
		i += 1;
	}
	return regex;
}
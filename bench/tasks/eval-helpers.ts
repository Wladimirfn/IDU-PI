import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { collectGitChangedFiles } from "../isolation.js";
import type { BenchmarkTaskDef, EvalCheckResult, EvalContext, TaskEvalResult } from "../types.js";

/** Aggregates pass/fail checks and hygiene violations into the uniform TaskEvalResult contract. */
export function summarizeTaskChecks(
	checks: EvalCheckResult[],
	forbiddenTouches: string[] = [],
): TaskEvalResult {
	const failToPass = checks.filter((c) => c.kind === "fail_to_pass");
	const passToPass = checks.filter((c) => c.kind === "pass_to_pass");
	const failToPassPassed = failToPass.filter((c) => c.passed).length;
	const passToPassPassed = passToPass.filter((c) => c.passed).length;
	const brokenPreExistingCount = passToPass.length - passToPassPassed;
	const hygieneClean = forbiddenTouches.length === 0 && checks.filter((c) => c.kind === "hygiene").every((c) => c.passed);

	return {
		resolved: failToPass.length > 0 && failToPassPassed === failToPass.length && brokenPreExistingCount === 0 && hygieneClean,
		failToPassPassed,
		failToPassTotal: failToPass.length,
		regressionsClean: brokenPreExistingCount === 0 && hygieneClean,
		passToPassPassed,
		passToPassTotal: passToPass.length,
		brokenPreExistingCount,
		forbiddenTouches,
		checks,
	};
}

/** Verifies byte-identical preservation of all declared `protectedPaths` in `task`. */
export function evaluateProtectedPaths(
	sandboxDir: string,
	task: Pick<BenchmarkTaskDef, "protectedPaths" | "fixtureFiles">,
): { checks: EvalCheckResult[]; forbiddenTouches: string[] } {
	const checks: EvalCheckResult[] = [];
	const forbiddenTouches: string[] = [];
	for (const rel of task.protectedPaths ?? []) {
		const expected = task.fixtureFiles[rel];
		const actual = existsSync(join(sandboxDir, rel)) ? readFileSync(join(sandboxDir, rel), "utf8") : null;
		const ok = actual === expected;
		if (!ok) forbiddenTouches.push(rel);
		checks.push({
			name: `protected:${rel}`,
			kind: "hygiene",
			passed: ok,
			detail: ok ? undefined : "Protected input/test file was modified or deleted",
		});
	}
	return { checks, forbiddenTouches };
}

/** Verifies that read-only workers left zero modified or untracked files in the sandbox. */
export function evaluateReadOnlyHygiene(
	sandboxDir: string,
	ctx?: EvalContext,
): { changedFiles: string[]; check: EvalCheckResult; forbiddenTouches: string[] } {
	const changedFiles = ctx?.changedFiles ?? collectGitChangedFiles(sandboxDir);
	const clean = changedFiles.length === 0;
	return {
		changedFiles,
		forbiddenTouches: clean ? [] : [...changedFiles],
		check: {
			name: "hygiene:read_only_no_workspace_mutations",
			kind: "hygiene",
			passed: clean,
			detail: clean ? undefined : `Read-only task altered files: ${changedFiles.join(", ")}`,
		},
	};
}

function matchesExpectedKeys(value: unknown, expectedKeys?: string[]): boolean {
	if (!expectedKeys || expectedKeys.length === 0) return true;
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	return expectedKeys.some((k) => Object.hasOwn(value, k));
}

function skipWs(text: string, start: number): number {
	let i = start;
	while (i < text.length && /\s/.test(text[i])) i++;
	return i;
}

/**
 * Strips stray unmatched closing brackets/braces outside JSON strings (e.g. a
 * duplicate `]` before `}`) and removes trailing commas before `}` or `]`.
 */
function sanitizeOuterJsonPunctuation(raw: string): string {
	const stack: Array<"{" | "["> = [];
	const out: string[] = [];
	let inStr = false;
	let escaped = false;

	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (inStr) {
			out.push(ch);
			if (escaped) {
				escaped = false;
			} else if (ch === "\\") {
				escaped = true;
			} else if (ch === '"') {
				inStr = false;
			}
			continue;
		}
		if (ch === '"') {
			inStr = true;
			out.push(ch);
		} else if (ch === "{" || ch === "[") {
			stack.push(ch);
			out.push(ch);
		} else if (ch === "}") {
			if (stack[stack.length - 1] === "{") {
				stack.pop();
				out.push(ch);
			}
		} else if (ch === "]") {
			if (stack[stack.length - 1] === "[") {
				stack.pop();
				out.push(ch);
			}
		} else {
			out.push(ch);
		}
	}

	// Remove trailing commas right before closing `}` or `]` outside strings.
	const collapsed = out.join("");
	const cleaned: string[] = [];
	inStr = false;
	escaped = false;
	for (let i = 0; i < collapsed.length; i++) {
		const ch = collapsed[i];
		if (inStr) {
			cleaned.push(ch);
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inStr = false;
			continue;
		}
		if (ch === '"') {
			inStr = true;
			cleaned.push(ch);
			continue;
		}
		if (ch === ",") {
			const next = collapsed[skipWs(collapsed, i + 1)];
			if (next === "}" || next === "]") continue;
		}
		cleaned.push(ch);
	}
	return cleaned.join("");
}

/**
 * Escapes stray unescaped `"` inside JSON string values (common when models quote
 * code or JSON snippets inside an explanation field without escaping quotes).
 */
function repairUnescapedQuotesInJson(raw: string): string {
	const stack: Array<"{" | "["> = [];
	let objExpectingKey = false;
	const out: string[] = [];

	const isValidClose = (quoteIdx: number, isKey: boolean): boolean => {
		const i1 = skipWs(raw, quoteIdx + 1);
		const c1 = raw[i1] ?? "";
		if (isKey) return c1 === ":";
		if (c1 === "") return true;
		if (c1 === "}" || c1 === "]") {
			const afterCloser = raw[skipWs(raw, i1 + 1)] ?? "";
			return afterCloser === "" || afterCloser === "," || afterCloser === "}" || afterCloser === "]";
		}
		if (c1 === ",") {
			const i2 = skipWs(raw, i1 + 1);
			if (stack[stack.length - 1] === "{") {
				return /^"[^"\\\r\n]+"\s*:/.test(raw.slice(i2, Math.min(raw.length, i2 + 120)));
			}
			const c2 = raw[i2] ?? "";
			return c2 === '"' || c2 === "{" || c2 === "[" || c2 === "]" || c2 === "}" || /[-0-9tfn]/.test(c2);
		}
		return false;
	};

	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (ch === '"') {
			const isKey = stack[stack.length - 1] === "{" && objExpectingKey;
			out.push('"');
			i++;
			let closed = false;
			while (i < raw.length) {
				const c = raw[i];
				if (c === "\\") {
					out.push(c);
					if (i + 1 < raw.length) {
						out.push(raw[i + 1]);
						i += 2;
					} else {
						i++;
					}
					continue;
				}
				if (c === '"') {
					if (isValidClose(i, isKey)) {
						out.push('"');
						closed = true;
						break;
					}
					out.push('\\"');
					i++;
					continue;
				}
				out.push(c);
				i++;
			}
			if (closed && isKey) {
				objExpectingKey = false;
			}
			continue;
		}
		out.push(ch);
		if (ch === "{") {
			stack.push("{");
			objExpectingKey = true;
		} else if (ch === "[") {
			stack.push("[");
			objExpectingKey = false;
		} else if (ch === "}") {
			if (stack.length > 0) stack.pop();
			objExpectingKey = false;
		} else if (ch === "]") {
			if (stack.length > 0) stack.pop();
			objExpectingKey = false;
		} else if (ch === ",") {
			objExpectingKey = stack[stack.length - 1] === "{";
		} else if (ch === ":") {
			objExpectingKey = false;
		}
	}
	return out.join("");
}

function tryParseJsonCandidate<T>(raw: string, expectedKeys?: string[]): T | null {
	const attempts = [
		() => JSON.parse(raw),
		() => JSON.parse(sanitizeOuterJsonPunctuation(raw)),
		() => JSON.parse(sanitizeOuterJsonPunctuation(repairUnescapedQuotesInJson(raw))),
	];
	for (const attempt of attempts) {
		try {
			const parsed = attempt() as T;
			if (matchesExpectedKeys(parsed, expectedKeys)) return parsed;
		} catch {
			// Escalate to next deterministic repair pass
		}
	}
	return null;
}

/**
 * Scans text for balanced JSON objects or arrays, preferring fenced ```json blocks.
 * When `expectedKeys` is supplied, prioritizes root objects carrying those keys
 * so an inner element never masks a broken or partial outer response object.
 */
export function extractLastJsonValue<T = unknown>(text: string, expectedKeys?: string[]): T | null {
	if (!text || !text.trim()) return null;

	const fencedMatches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
	for (let i = fencedMatches.length - 1; i >= 0; i--) {
		const candidate = fencedMatches[i][1]?.trim();
		if (!candidate) continue;
		const parsed = tryParseJsonCandidate<T>(candidate, expectedKeys);
		if (parsed !== null) return parsed;
	}

	const trimmed = text.trim();
	const wholeParsed = tryParseJsonCandidate<T>(trimmed, expectedKeys);
	if (wholeParsed !== null) return wholeParsed;

	const candidates: string[] = [];
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch !== "{") continue;
		let depth = 0;
		let inStr = false;
		let escaped = false;
		for (let j = i; j < text.length; j++) {
			const c = text[j];
			if (inStr) {
				if (escaped) {
					escaped = false;
				} else if (c === "\\") {
					escaped = true;
				} else if (c === '"') {
					inStr = false;
				}
				continue;
			}
			if (c === '"') {
				inStr = true;
			} else if (c === "{") {
				depth++;
			} else if (c === "}") {
				depth--;
				if (depth === 0) {
					candidates.push(text.slice(i, j + 1));
					break;
				}
			}
		}
	}

	for (let i = candidates.length - 1; i >= 0; i--) {
		const parsed = tryParseJsonCandidate<T>(candidates[i], expectedKeys);
		if (parsed !== null) return parsed;
	}
	return null;
}

/** Normalizes a repository-relative path and checks it exists inside `sandboxDir`. */
export function normalizeRepoPath(rawPath: string): string {
	return rawPath
		.trim()
		.replace(/\\/g, "/")
		.replace(/^\.\//, "")
		.replace(/^\/+/, "");
}

export function repoFileExists(sandboxDir: string, relPath: string): boolean {
	const norm = normalizeRepoPath(relPath);
	if (!norm || norm.includes("..")) return false;
	const abs = resolve(sandboxDir, norm);
	const root = resolve(sandboxDir);
	if (!abs.startsWith(root)) return false;
	return existsSync(abs);
}

/** Checks that text contains any required diagnostic signal words/patterns. */
export function includesAnyPattern(text: string, patterns: RegExp[]): boolean {
	return patterns.some((re) => re.test(text));
}

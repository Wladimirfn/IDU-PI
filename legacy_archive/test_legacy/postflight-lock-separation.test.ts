/**
 * postflight-lock-separation.test.ts — WU-4 invariant pin
 *
 * Static source-file invariant: `src/postflight-core.ts` (the postflight
 * comparison/report core) MUST NOT depend on, import, re-export, reference,
 * or name any cross-process file-lock primitive from the response-history
 * lock domain. The response-history writer owns the lock; postflight must
 * remain lock-agnostic so a postflight comparison can never acquire, wait on,
 * or be coupled to the supervisor response-history file lock.
 *
 * This is a STRICT STATIC scan (regex over source text), NOT a runtime
 * import-graph instrumentation. The test reads the two source files and applies
 * a reusable scanner. A positive control proves the scanner is non-vacuous by
 * asserting it DOES detect the existing lock import in
 * `src/supervisor-response-history.ts`. The invariant tests then assert the
 * same scanner finds ZERO lock coupling in `src/postflight-core.ts`.
 *
 * Spec #3098 rev7 · Design #3099 rev6 · Tasks #3100 rev19 (WU-4, Phase 6).
 * Issue-first: #286 (type:chore, status:approved). No production change.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the project root from the test file's own location, working for BOTH
 * execution layouts:
 *   - compiled: `dist/test/postflight-lock-separation.test.js` (HERE = <repo>/dist/test)
 *   - source:   `test/postflight-lock-separation.test.ts`            (HERE = <repo>/test)
 *
 * A blind `resolve(HERE, "..", "..")` is correct ONLY for the compiled layout
 * (two levels up); from the source layout it overshoots to the repo's parent.
 * Rather than swapping the depth, we walk up from HERE and return the first
 * directory that contains BOTH scanned source files. The `.ts` extension marks
 * the real source root — `dist/` holds compiled `.js` only, so it never matches,
 * and the bounded search stops at the true repo root in either layout. No new
 * dependencies: node:fs + node:path only.
 */
function findRepoRoot(start: string): string {
	let dir = start;
	for (let depth = 0; depth < 16; depth++) {
		if (
			existsSync(join(dir, "src", "postflight-core.ts")) &&
			existsSync(join(dir, "src", "supervisor-response-history.ts"))
		) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) break; // filesystem root reached
		dir = parent;
	}
	// Deterministic fallback (unreachable with intact project structure): the
	// compiled-layout depth, so REPO_ROOT is always a valid path string.
	return resolve(start, "..", "..");
}

const REPO_ROOT = findRepoRoot(HERE);
const POSTFLIGHT_CORE_SRC = join(REPO_ROOT, "src", "postflight-core.ts");
const SUPERVISOR_HISTORY_SRC = join(
	REPO_ROOT,
	"src",
	"supervisor-response-history.ts",
);

/**
 * Matches any module specifier that resolves to a lock-domain source file.
 * Covers both the normal O_EXCL lock helper and the node:net maintenance gate
 * (which lives inside `state-root-file-lock.ts` per WU-3 design rev6).
 */
const LOCK_MODULE_RE = /state-root-file-lock|maintenance-lock/u;

/**
 * Forbidden lock-domain identifiers. Any of these appearing in postflight-core
 * would indicate the postflight core reached into the lock surface.
 */
const FORBIDDEN_LOCK_SYMBOLS = [
	"acquireExclusiveFileLock",
	"acquireMaintenanceLock",
	"releaseExclusiveFileLock",
	"MaintenanceHandle",
	"MaintenanceAcquireResult",
	"MaintenanceDiagnostics",
	"LockDiagnostics",
	"FileLockAcquireResult",
	"TokenGatedLockHandle",
	"deriveMaintenanceEndpoint",
] as const;

/**
 * Lock module path segments that must never appear as string literals in
 * postflight-core (catches dynamic `import("./state-root-file-lock.js")` and
 * constructed require paths that the static import scan would miss).
 */
const FORBIDDEN_LOCK_PATH_SEGMENTS = [
	"state-root-file-lock",
	"maintenance-lock",
] as const;

interface ImportViolation {
	/** Raw module specifier exactly as written in the source. */
	specifier: string;
}

/**
 * Extract every static import / export-from module specifier from TypeScript
 * source text. Covers:
 *   - `import X from "m"`
 *   - `import { a, type B } from "m"`
 *   - `import * as N from "m"`
 *   - `import "m"` (bare side-effect import)
 *   - `export { a } from "m"`
 *   - `export * from "m"`
 *   - `export type { T } from "m"`
 *
 * The `from` clause regex excludes quotes and semicolons from its body so it
 * cannot swallow a following statement; the bare-import regex catches side-effect
 * imports that have no `from`.
 */
function findModuleSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	const fromRe =
		/(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gu;
	const bareRe = /\bimport\s*['"]([^'"]+)['"]/gu;
	let m: RegExpExecArray | null;
	while ((m = fromRe.exec(source)) !== null) {
		specifiers.push(m[1]);
	}
	while ((m = bareRe.exec(source)) !== null) {
		specifiers.push(m[1]);
	}
	return specifiers;
}

/** Return the import/export-from specifiers that resolve to a lock module. */
function findLockModuleImports(source: string): ImportViolation[] {
	return findModuleSpecifiers(source)
		.filter((specifier) => LOCK_MODULE_RE.test(specifier))
		.map((specifier) => ({ specifier }));
}

/** Return the forbidden lock symbols that appear as identifiers in the source. */
function findForbiddenIdentifiers(
	source: string,
	symbols: readonly string[],
): string[] {
	const found: string[] = [];
	for (const symbol of symbols) {
		const re = new RegExp(`\\b${symbol}\\b`, "u");
		if (re.test(source)) found.push(symbol);
	}
	return found;
}

/** Return the forbidden lock path segments present as string literals. */
function findForbiddenPathLiterals(
	source: string,
	segments: readonly string[],
): string[] {
	return segments.filter((segment) => source.includes(segment));
}

// ===========================================================================
// Repo-root discovery — location-aware (works compiled AND source).
//
// `REPO_ROOT` must resolve to the project root whether this test executes as
// compiled `dist/test/postflight-lock-separation.test.js` (HERE = <repo>/dist/test,
// two levels below root) or as source `test/postflight-lock-separation.test.ts`
// (HERE = <repo>/test, one level below root). The marker-file existence check
// pins the resolution: both scanned sources must exist directly under REPO_ROOT.
// ===========================================================================

test("repo-root discovery resolves to a directory containing both scanned source files", () => {
	assert.ok(
		existsSync(POSTFLIGHT_CORE_SRC),
		`REPO_ROOT resolved to ${REPO_ROOT} but src/postflight-core.ts is absent there`,
	);
	assert.ok(
		existsSync(SUPERVISOR_HISTORY_SRC),
		`REPO_ROOT resolved to ${REPO_ROOT} but src/supervisor-response-history.ts is absent there`,
	);
});

// ===========================================================================
// Positive control — proves the scanner is NON-VACUOUS.
//
// `src/supervisor-response-history.ts` genuinely imports the lock helper
// today. If any detector stops firing here, the invariant tests below are
// meaningless (a green zero would be a tautology). This test pins all three
// detectors against a known-positive file.
// ===========================================================================

test("positive control: scanner detects the existing lock import in supervisor-response-history.ts (non-vacuous)", () => {
	const src = readFileSync(SUPERVISOR_HISTORY_SRC, "utf8");

	const importHits = findLockModuleImports(src);
	assert.ok(
		importHits.length > 0,
		"import detector must find a lock module import in supervisor-response-history.ts",
	);
	assert.ok(
		importHits.some((hit) => LOCK_MODULE_RE.test(hit.specifier)),
		`expected a specifier matching ${LOCK_MODULE_RE}; got ${JSON.stringify(importHits)}`,
	);

	const identifierHits = findForbiddenIdentifiers(src, FORBIDDEN_LOCK_SYMBOLS);
	assert.ok(
		identifierHits.length > 0,
		"identifier detector must find forbidden lock symbols in supervisor-response-history.ts",
	);

	const literalHits = findForbiddenPathLiterals(
		src,
		FORBIDDEN_LOCK_PATH_SEGMENTS,
	);
	assert.ok(
		literalHits.length > 0,
		"string-literal detector must find a lock module path in supervisor-response-history.ts",
	);
});

// ===========================================================================
// Invariant — postflight-core must be lock-agnostic (three independent scans).
// ===========================================================================

test("postflight-core: no import/export-from resolves to a lock module (static import scan)", () => {
	const src = readFileSync(POSTFLIGHT_CORE_SRC, "utf8");
	const hits = findLockModuleImports(src);
	assert.deepEqual(
		hits,
		[],
		`postflight-core must not import/export-from any lock module; found ${JSON.stringify(hits)}`,
	);
});

test("postflight-core: references no forbidden lock-domain identifier", () => {
	const src = readFileSync(POSTFLIGHT_CORE_SRC, "utf8");
	const hits = findForbiddenIdentifiers(src, FORBIDDEN_LOCK_SYMBOLS);
	assert.deepEqual(
		hits,
		[],
		`postflight-core must not reference any forbidden lock symbol; found ${JSON.stringify(hits)}`,
	);
});

test("postflight-core: contains no lock module path string literal", () => {
	const src = readFileSync(POSTFLIGHT_CORE_SRC, "utf8");
	const hits = findForbiddenPathLiterals(src, FORBIDDEN_LOCK_PATH_SEGMENTS);
	assert.deepEqual(
		hits,
		[],
		`postflight-core must not contain any lock module path literal; found ${JSON.stringify(hits)}`,
	);
});

/**
 * AgentLab review-run selector parser and filename predicates.
 *
 * Public surface (behavior, not data):
 *   - `parseAgentLabRunSelector(input)` — typed parse to a discriminated union.
 *   - `isAgentLabRunFilename(name)` — true for run artifact filenames.
 *   - `isAgentLabDispatchFilename(name)` — true for dispatch placeholder filenames.
 *   - `RUN_SELECTOR_ERROR_HINT` — human-readable hint string for error messages.
 *   - `type RunSelector` — discriminated union (`current` | `run_id` | `legacy_file`).
 *
 * The 5 underlying regex patterns are intentionally MODULE-PRIVATE. Do NOT export
 * them — exporting them would re-leak the contract that REQ-FRS-1 unifies behind
 * this helper.
 *
 * Backwards compatibility: the legacy filename format
 * `agentlab-review-run-<YYYYMMDD>-<HHMMSS>.json` continues to parse to
 * `{ kind: 'legacy_file', filename }`. Do NOT break that path.
 *
 * The dispatch filename shape `<runId>.dispatch.json` is unchanged on disk.
 */

// Module-private regexes. NEVER export these.
const RUN_SELECTOR_RE = /^current$/u;
const RUN_ID_RE = /^run-\d+-[a-z0-9]+$/u;
const RUN_ID_FILE_RE = /^run-\d+-[a-z0-9]+\.json$/u;
const DISPATCH_FILE_RE = /^run-\d+-[a-z0-9]+\.dispatch\.json$/u;
const LEGACY_FILE_RE = /^agentlab-review-run-\d{8}-\d{6}\.json$/u;

/**
 * Discriminated union for an AgentLab review-run selector. Each kind
 * carries the data the caller needs to resolve a run path.
 */
export type RunSelector =
	| { kind: "current" }
	| { kind: "run_id"; runId: string }
	| { kind: "legacy_file"; filename: string };

/**
 * Human-readable hint surfaced alongside selector errors. Intentionally
 * carries no regex — the parser is the contract, this string is a UX layer.
 */
export const RUN_SELECTOR_ERROR_HINT =
	"Selector must be \"current\", \"latest\", a runId of the form run-<unix>-<hex>, or an absolute/relative path to an agentlab review-run file.";

/**
 * Parse an AgentLab review-run selector.
 *
 * Accepts:
 *   - bare `current`
 *   - bare runId (`run-<unix>-<hex>`)
 *   - bare legacy filename (`agentlab-review-run-<YYYYMMDD>-<HHMMSS>.json`)
 *   - absolute or relative paths (basename is inspected)
 *
 * Returns `null` for any input that does not match a known selector shape.
 * This function never throws on malformed input — callers MUST handle the
 * `null` case.
 */
export function parseAgentLabRunSelector(input: string): RunSelector | null {
	if (typeof input !== "string") return null;
	const raw = input.trim();
	if (!raw) return null;

	if (RUN_SELECTOR_RE.test(raw)) {
		return { kind: "current" };
	}

	if (RUN_ID_RE.test(raw)) {
		return { kind: "run_id", runId: raw };
	}

	// Resolve absolute/relative paths to their basename so the same parse
	// logic applies whether the caller hands us a bare filename or a path.
	const basename = stripDirectoryPrefix(raw);

	if (RUN_ID_FILE_RE.test(basename)) {
		const runId = basename.slice(0, -".json".length);
		return { kind: "run_id", runId };
	}

	if (LEGACY_FILE_RE.test(basename)) {
		return { kind: "legacy_file", filename: basename };
	}

	return null;
}

/**
 * Predicate: is `name` the filename of an AgentLab review-run artifact?
 *
 * Accepts:
 *   - `current.json`
 *   - `agentlab-review-run-<YYYYMMDD>-<HHMMSS>.json` (legacy)
 *   - `run-<unix>-<hex>.json` (new format)
 *
 * Rejects:
 *   - `*.dispatch.json` (dispatch placeholders, not run artifacts)
 *   - anything else
 */
export function isAgentLabRunFilename(name: string): boolean {
	if (typeof name !== "string" || !name) return false;
	const trimmed = name.trim();
	if (!trimmed) return false;
	const basename = trimmed.split(/[\\/]/).pop() ?? trimmed;
	return basename === "current.json" || isLegacyOrRunIdJson(basename);
}

/**
 * Predicate: is `name` the filename of an AgentLab review-run dispatch
 * placeholder? Dispatch placeholders carry the `.dispatch.json` suffix.
 */
export function isAgentLabDispatchFilename(name: string): boolean {
	if (typeof name !== "string" || !name) return false;
	const trimmed = name.trim();
	if (!trimmed) return false;
	const basename = trimmed.split(/[\\/]/).pop() ?? trimmed;
	return DISPATCH_FILE_RE.test(basename);
}

function isLegacyOrRunIdJson(basename: string): boolean {
	return LEGACY_FILE_RE.test(basename) || RUN_ID_FILE_RE.test(basename);
}

function stripDirectoryPrefix(input: string): string {
	const idx = Math.max(input.lastIndexOf("/"), input.lastIndexOf("\\"));
	return idx >= 0 ? input.slice(idx + 1) : input;
}
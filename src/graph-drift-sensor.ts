/**
 * graph-drift-sensor.ts — deterministic graph-drift sensor.
 *
 * Etapa 4a of the idu-pi supervisor vision. A non-LLM, deterministic
 * sensor that consults codegraph over the delta and emits an
 * advisory finding when a changed file's exported symbols have
 * callers that are NOT in the changeset (i.e. the orchestrator
 * changed something without touching its dependents — the
 * "blast radius uncovered" class).
 *
 * Why codegraph and not a from-scratch AST/CFG: codegraph is
 * already installed in this repo (`codegraph_explore` MCP and the
 * `codegraph` CLI both work). It exposes symbols + callers + file
 * paths deterministically and cheaply. The sensor shells out to
 * the CLI — the MCP is for an LLM, but the sensor is a process.
 *
 * Territory:
 *   - Only files whose path matches the project code extension set
 *     are inspected. Documentation/asset/binary files are skipped
 *     by territory (.md, .json, .png, etc.).
 *   - Only `function` and `method` symbols are considered as
 *     "potentially blown up" (constants, types and properties
 *     don't carry runtime blast radius the same way; the brief
 *     chose this tight scope deliberately).
 *
 * Failure mode:
 *   - If `codegraph` is not installed or the index is stale, the
 *     sensor returns an empty list (not an error). That matches
 *     the brief's "advisory" — when the hard layer is unavailable,
 *     we don't fire, we stay silent (PISO, not TECHO).
 *
 * Advisory severity: `warning` (not `blocker`). The brief is explicit:
 *     "Advisory only (PISO). La obligación (TECHO) es 4b."
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** File extensions whose symbols carry runtime blast radius. */
const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/u;

/** Symbol kinds we care about for blast-radius audit. */
const BLASTABLE_SYMBOL_KINDS = new Set(["function", "method"]);

/**
 * How many lines below the symbol header count as "signature
 * territory" for purposes of 4a.1 precision. Defaults to 8
 * because TypeScript function signatures (parameters with
 * default values, return types, generics, generic constraints)
 * can span 6-10 lines for complex symbols. The docstring or
 * body changes past `signatureEndLine` do NOT count as
 * signature drift.
 */
const SIGNATURE_TERRITORY_LINES = 8;

/**
 * Run `git show HEAD:<path>` to retrieve the pre-change source
 * for `path`. Used by the cross-reference check: a function
 * whose signature bytes differ between HEAD and worktree
 * counts as "contract changed". If HEAD doesn't have the file
 * (newly added), all symbols count as "signature changed"
 * because any caller may have been broken.
 */
function readHeadVersion(repoRoot: string, file: string): string | null {
	try {
		const out = execFileSync(
			"git",
			["show", `HEAD:${file}`],
			{
				encoding: "utf8",
				cwd: repoRoot,
				stdio: ["ignore", "pipe", "pipe"],
				timeout: 5_000,
			},
		);
		return out;
	} catch {
		return null;
	}
}

/**
 * Extract the signature bytes of every blastable function/method in
 * the given source text. The signature is the first
 * `SIGNATURE_TERRITORY_LINES` lines starting at the declaration
 * (`function name(...)` or `method name(...)`), with whitespace
 * and comments stripped.
 *
 * Parses the source FILE (not the CLI header), so the regex looks
 * for the keyword `function` / `method` at the start of a declaration
 * and walks the parameter list until the opening brace of the body.
 *
 * Returns a map: symbol name -> normalized signature string.
 */
function extractSignatures(
	source: string,
): Map<string, string> {
	const out = new Map<string, string>();
	if (!source) return out;
	const lines = source.split(/\r?\n/u);
	// Two patterns of declaration we care about:
	//   (a) `export? (async)? function NAME(` — top-level functions
	//   (b) `NAME(`, preceded by indentation — methods of a class or
	//       object literal (TypeScript has no `method` keyword; the
	//       shorthand is a name followed by `(`).
	// We bound each detection by scanning the next
	// SIGNATURE_TERRITORY_LINES lines for a `(` character so
	// identifiers that happen to contain `name(` (a rare but real
	// case, e.g. `typename(` in some tests) don't get false-positives.
	const fnDeclRe = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/u;
	const methodDeclRe = /^\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/u;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line) continue;
		let name: string | undefined;
		if (fnDeclRe.test(line)) {
			const m = fnDeclRe.exec(line);
			if (m) name = m[1];
		} else if (line.startsWith(" ") || line.startsWith("\t")) {
			// Indented line: candidate method. The regex requires a
			// `{` (with optional return type) within the SAME line.
			const m = methodDeclRe.exec(line);
			if (m) name = m[1];
		}
		if (!name) continue;
		// Capture a window starting at the declaration line. The
		// signature body must fit within that window for the
		// comparison to be stable across formatting churn.
		const window = lines
			.slice(i, i + SIGNATURE_TERRITORY_LINES)
			.join("\n");
		out.set(name, normalizeSignature(window));
	}
	return out;
}

/**
 * Normalize a signature string for whitespace/comment-insensitive
 * comparison. Strips line-comments (`//`) and collapses
 * whitespace. Keeps identifier names and punctuation intact —
 * that's what callers actually bind to.
 *
 * Scope: line comments only. Block comments (`/* ... *\/`) are
 * NOT stripped because they rarely appear inside a function
 * signature header and the regex for them is fragile across
 * nested cases. If a real signature change is hidden by a block
 * comment, the sensor will conservatively report it as "changed"
 * (a false positive) rather than miss it — fail-noisy is the
 * safer side for signatures.
 */
function normalizeSignature(input: string): string {
	return input
		// strip line comments after a `//` until end of line
		.replace(/\/\/[^\n]*/gu, "")
		// collapse whitespace (including newlines) into single space
		.replace(/\s+/gu, " ")
		.trim();
}

/**
 * Symbol-level drift verdict for one source file.
 *
 *   "changed"   — signature bytes differ between HEAD and worktree.
 *   "unchanged" — signature bytes match (after normalizeSignature).
 *   "skipped"   — the regex parser could not extract the
 *                 symbol's signature in the current source. The
 *                 most common cause: codegraph lists a symbol
 *                 (e.g. an `export const x = () => ...` arrow const)
 *                 that our regex does not match. We deliberately
 *                 do NOT default to "changed" here, because that
 *                 would re-introduce the false-positive class
 *                 4a.1 closed (any edit to a file with arrow
 *                 consts would fire spuriously). Trade-off: a
 *                 real signature change to an arrow-const would
 *                 also be skipped. That's the safe side of
 *                 fail-closed.
 */
export type SymbolDrift = "changed" | "unchanged" | "skipped";

/**
 * Decide whether each symbol's signature actually changed in the
 * worktree-vs-HEAD comparison.
 *
 * Returns:
 *   `undefined`  → file is new (no HEAD version); treat ALL
 *                  blastable symbols as "changed" (we have no
 *                  prior contract to diff).
 *   `Map(name → SymbolDrift)`:
 *     "changed"   → signature bytes differ.
 *     "unchanged" → signature bytes match after normalizeSignature.
 *     "skipped"   → the regex parser could not extract this
 *                  symbol's signature in the worktree source.
 *                  Common reason: `export const x = () => ...`
 *                  (arrow const) — codegraph lists it as
 *                  `function` but the regex doesn't match the
 *                  `function NAME(` or indented-method forms. We
 *                  skip rather than assume "changed" — false
 *                  negatives here are acceptable; false positives
 *                  are the noise class 4a.1 just closed.
 */
function signatureChanges(
	repoRoot: string,
	file: string,
	currentSymbols: ReadonlySet<string>,
): Map<string, SymbolDrift> | undefined {
	const headSource = readHeadVersion(repoRoot, file);
	if (headSource === null) return undefined;
	const headSigs = extractSignatures(headSource);
	const currentSource = readFileSync(join(repoRoot, file), "utf8");
	const currentSigs = extractSignatures(currentSource);
	const out = new Map<string, SymbolDrift>();
	for (const name of currentSymbols) {
		const currentSig = currentSigs.get(name);
		if (currentSig === undefined) {
			// The parser could not extract this symbol's signature
			// in the worktree source. Skip (see SymbolDrift doc).
			out.set(name, "skipped");
			continue;
		}
		const headSig = headSigs.get(name);
		if (headSig === undefined) {
			// Symbol didn't exist at HEAD (new export). Contract
			// change is implied for any caller that pinned against
			// the old signature. Be conservative: report as
			// "changed" so the orchestrator verifies nothing
			// imported this new name yet.
			out.set(name, "changed");
			continue;
		}
		out.set(name, currentSig === headSig ? "unchanged" : "changed");
	}
	return out;
}

/**
 * When true, exec codegraph via the `which codegraph` lookup (POSIX
 * shells and Windows shells that resolve `.cmd` shims automatically).
 * When false, fall back to the explicit `.cmd` path that the npm
 * installer creates at `%AppData%\npm\codegraph.cmd`. We resolve
 * `which codegraph.cmd` once at module init and cache the result.
 */
function resolveCodegraphCmd(): string | null {
	if (process.env.CODEGRAPH_BIN) return process.env.CODEGRAPH_BIN;
	// Try the executable form first (POSIX / direct binary on PATH).
	try {
		const out = execFileSync("where.exe", ["codegraph"], {
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim()
			.split(/\r?\n/u)[0];
		if (out) return out;
	} catch {
		// fall through
	}
	// Fallback: the Windows npm shim.
	const candidates = [
		join(process.env.APPDATA ?? "", "npm", "codegraph.cmd"),
		"/usr/local/bin/codegraph",
		"/usr/bin/codegraph",
	];
	for (const c of candidates) {
		try {
			execFileSync(c, ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
			return c;
		} catch {
			// not found / not executable
		}
	}
	return null;
}

let _codegraphCmd: string | null | undefined = undefined;
function codegraphCmd(): string | null {
	if (_codegraphCmd !== undefined) return _codegraphCmd;
	_codegraphCmd = resolveCodegraphCmd();
	return _codegraphCmd;
}

export type GraphDriftFinding = {
	/** Path to the changed file (relative to projectRoot). */
	file: string;
	/** Symbol within `file` that was modified. */
	symbol: string;
	/** Path (relative to projectRoot) to the caller file, with start line. */
	caller: { file: string; line: number };
	/**
	 * Etapa 4a: severity on the finding object is always "warning"
	 * (advisory). The actual envelope severity (warning|critical)
	 * is decided at emit time by `graphDriftSeverityForCurrentMode()`
	 * based on the IDU_PI_GRAPH_DRIFT_BLOCKING env var. The
	 * `severity` field on the finding stays as the per-finding
	 * advisory level (always "warning" today) so the structured
	 * signal inside JSONL is consistent regardless of mode.
	 */
	severity: "warning";
	/** Brief summary line. */
	summary: string;
};

export type DetectGraphDriftInput = {
	projectRoot: string;
	changedFiles: readonly string[];
	/** Where the .codegraph/ index lives. Usually = projectRoot. */
	graphProjectRoot?: string;
};

function isCodeFile(file: string): boolean {
	return CODE_EXTENSIONS.test(file);
}

/**
 * Read the symbol map of a single file. Returns just the
 * `name` strings of the symbols whose `kind ∈ {function, method}`.
 *
 * The output of `codegraph node -f FILE --symbols-only` is a
 * Markdown-like listing. The format of each line is:
 *
 *   `- \`<name>\` (<kind>) <rest> — :<line>`
 *
 * where the trailing `:line` is always present. We match the
 * header-style line with a regex that's robust to mid-line colon
 * characters (function signatures can include `:` as type
 * annotation).
 */
function listBlastableSymbols(file: string, graphRoot: string): string[] {
	if (!codegraphCmd()) return [];

	let stdout: string;
	try {
		// On Windows, codegraph is an npm-shim .cmd that requires
		// shell resolution to launch correctly. `shell: true`
		// enables that. The arguments are constants, not user
		// input, so the security warning is a non-issue here.
		stdout = execFileSync(
			"codegraph",
			["node", "-p", graphRoot, "-f", file, "--symbols-only"],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
				timeout: 10_000,
				shell: true,
			},
		);
	} catch {
		return [];
	}

	const out: string[] = [];
	// Matches: - `name` (kind) ... — :NN
	const re = /^- `([^`]+)` \((function|method)\)[\s\S]*?— :(\d+)\s*$/u;
	for (const line of stdout.split(/\r?\n/u)) {
		const m = re.exec(line);
		if (!m) continue;
		const [, name, kind] = m;
		if (BLASTABLE_SYMBOL_KINDS.has(kind)) out.push(name);
	}
	return out;
}

type CallerEntry = {
	name: string;
	kind: string;
	filePath: string;
	startLine: number;
};

/**
 * Shell out to `codegraph callers -j SYMBOL` and parse the JSON
 * output. Returns an empty list on any failure (binary missing,
 * network, parse error).
 */
function listCallers(symbol: string, graphRoot: string): CallerEntry[] {
	if (!codegraphCmd()) return [];

	let stdout: string;
	try {
		stdout = execFileSync(
			"codegraph",
			["callers", "-p", graphRoot, "-l", "50", "-j", symbol],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
				timeout: 10_000,
				shell: true,
			},
		);
	} catch {
		return [];
	}

	try {
		const parsed = JSON.parse(stdout) as {
			symbol?: string;
			callers?: CallerEntry[];
		};
		return Array.isArray(parsed.callers) ? parsed.callers : [];
	} catch {
		return [];
	}
}

/**
 * Etapa 4a main entry point.
 *
 * For each changed code file, list the file's `function`/`method`
 * symbols. For each such symbol, look up its callers via codegraph.
 * If a caller's file is NOT in the changed-set, the caller is
 * "out of the delta" — emit a graph-drift finding for it.
 *
 * Returns an empty list when:
 *   - `changedFiles` is empty,
 *   - no changed files are code files,
 *   - no symbol of a changed file has any caller,
 *   - all callers' files are in the changeset (clean delta).
 *
 * Symmetry note: if the orchestrator renames a function and
 * forgets to update callers, codegraph will report 0 callers (the
 * old name no longer exists in the index). That's an *unresolved
 * ref* and is detectable via a different signal (the "old call
 * sites" check). Etapa 4a specifically targets the
 * "blast-radius uncovered" class, per the brief.
 */
export function detectGraphDriftFindings(
	input: DetectGraphDriftInput,
): GraphDriftFinding[] {
	const { projectRoot, changedFiles } = input;
	const graphRoot = input.graphProjectRoot ?? projectRoot;

	if (changedFiles.length === 0) return [];

	// Build a relative-to-projectRoot set of changed files so we
	// can test caller membership in O(1).
	const changedSet = new Set<string>(
		changedFiles
			.filter((f) => isCodeFile(f))
			.map((f) => f.replace(/\\/gu, "/")),
	);
	if (changedSet.size === 0) return [];

	const out: GraphDriftFinding[] = [];

	for (const file of changedSet) {
		const symbols = listBlastableSymbols(file, graphRoot);
		if (symbols.length === 0) continue;

		// 4a.1 precision gate: only emit findings for symbols whose
		// signature/contract actually changed in this delta. If the
		// signature is byte-equivalent (whitespace/comments normalized),
		// the symbol is "modified" but its blast radius is the same —
		// skip it (silent on the source of truth level).
		//
		// 4a.2: when the regex parser cannot extract the symbol's
		// signature in the worktree source (e.g. codegraph lists an
		// arrow-const export as `function`), return "skipped" — do
		// not assume "changed" (that would re-introduce the
		// false-positive class on every docstring edit).
		const currentSymbolNames = new Set(symbols);
		const changed = signatureChanges(projectRoot, file, currentSymbolNames);
		// `changed === undefined` means the file is NEW (no HEAD
		// version). In that case the default for every symbol is
		// "signature changed" (we have no prior contract to diff).
		const symbolDriftVerdict = (name: string): boolean => {
			if (changed === undefined) return true;
			return changed.get(name) === "changed";
		};

		for (const symbol of symbols) {
			// 4a.1 gate: docstring-only edits, body-only refactors, or
			// whitespace/comment churn do NOT change the blast radius.
			// 4a.2 gate: when the regex parser cannot extract the
			// signature (e.g. arrow-const exports listed by codegraph
			// as `function`), skip — the safe side of fail-closed.
			if (!symbolDriftVerdict(symbol)) continue;

			const callers = listCallers(symbol, graphRoot);
			for (const caller of callers) {
				if (!caller.filePath) continue;
				const callerRel = relative(projectRoot, caller.filePath)
					.replace(/\\/gu, "/");
				// codegraph emits a "module-level" entry per file
				// at line 1 (the import statement that pulls the
				// symbol in). That's a file-level reference, not
				// a caller; skip it so the signal stays actionable.
				if (caller.startLine <= 1) continue;
				// Outside-the-delta callers are the deviation we
				// care about. In-the-delta callers are intentional
				// (orchestrator updated the caller together).
				if (!changedSet.has(callerRel)) {
					out.push({
						file,
						symbol,
						caller: { file: callerRel, line: caller.startLine },
						severity: "warning",
						summary:
							`symbol \`${symbol}\` contract changed in \`${file}\`; ` +
							`caller \`${caller.name}\` at ${callerRel}:${caller.startLine} ` +
							`is NOT in the changeset (blast radius uncovered)`,
					});
				}
			}
		}
	}
	return out;
}

/**
 * Etapa 4b mode: when this env var is set to `"critical"`, the sensor
 * emits advisories with severity="critical" so the preflight
 * (`readPendingBlockingInjection`) reports them as BLOCKING. When
 * the env var is unset (or any other value, including "warning"),
 * the sensor stays in PISO mode and emits severity="warning".
 *
 * The default is PISO on purpose: the brief §4.3 says the human
 * in the bridge is the training period. Hard-blocking from day 1
 * would make the ledger accumulate only "I ack'd because the
 * build broke" data, not "I ack'd because this finding was useful"
 * data. Once the ledger demonstrates the signal is real (4b+
 * meta-work), the operator flips IDU_PI_GRAPH_DRIFT_BLOCKING=critical
 * and the same sensor becomes the gate. The transition is one env
 * var, no code change.
 */
export function graphDriftSeverityForCurrentMode():
	| "info"
	| "warning"
	| "critical" {
	return process.env.IDU_PI_GRAPH_DRIFT_BLOCKING === "critical"
		? "critical"
		: "warning";
}

/**
 * Append a graph-drift advisory directly to the stateRoot's
 * `injections.jsonl` so it surfaces to `idu-pending-injections`
 * without going through the LLM supervisor-main path. The
 * determinism is the contract: this advisory is not derived from
 * a model response. Severity is decided by the env-var-gated
 * `graphDriftSeverityForCurrentMode()` so the operator can flip
 * between PISO (warning) and TECHO (critical) without code
 * change. The preflight (`readPendingBlockingInjection`) reads the
 * same JSONL file the sensor writes, so a mode flip is the entire
 * 4b surface — no other module changes are required.
 */
export function emitGraphDriftAdvisory(
	stateRoot: string,
	findings: readonly GraphDriftFinding[],
	now: Date = new Date(),
): number {
	if (findings.length === 0) return 0;
	const severity = graphDriftSeverityForCurrentMode();
	// We intentionally do not call appendInjection here. That helper
	// exists for LLM-categorized supervisor_advisory envelopes.
	// Graph-drift advisories are first-class data with their own
	// shape (deterministic, no LLM), so they need their own
	// write path.
	mkdirSync(stateRoot, { recursive: true });
	const path = join(stateRoot, "injections.jsonl");
	for (const f of findings) {
		const row = {
			ts: now.toISOString(),
			triggerId: "graph_drift_sensor",
			decisionEnvelope: {
				severity,
				summary: f.summary,
				options: ["review_callers", "update_caller", "acknowledge"],
				evidenceRefs: [
					`symbol:${f.file}:${f.symbol}`,
					`caller:${f.caller.file}:${f.caller.line}`,
				],
				orchestratorDecisionRequired: true,
			},
			injectionId: `gd-${now.getTime()}-${f.caller.line}`,
			kind: "graph_drift_finding",
			acked: false,
		};
		appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
	}
	return findings.length;
}

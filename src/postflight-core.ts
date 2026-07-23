export type PostflightTaskTraceInput = {
	actionId?: string;
	taskPackageId?: string;
	expectedContracts: string[];
	expectedFiles: string[];
	expectedChangeMode?: string;
	ignoredFiles?: string[];
	// Auto-ignore every changedFile that lives under `stateRoot`. Use this
	// when the report's diff includes stateRoot writes (e.g. constitution
	// re-saves, blueprint migrations) that must NOT be treated as unexpected
	// area changes — those are the supervisor's bookkeeping, not the
	// orchestrator's slice.
	stateRoot?: string;
	// Auto-ignore these exact changedFiles (typically the project
	// constitution's Layout A and Layout B paths). Useful when the caller
	// already knows the constitution files but does not want to recompute
	// stateRoot scope, or when the constitution sits outside stateRoot.
	constitutionPaths?: string[];
	report: {
		changedFiles: string[];
		ignoredFiles?: string[];
		observedChangeMode?: string;
		impactedAreas: string[];
		risk: string;
	};
};

export type PostflightTaskTrace = {
	actionId: string | null;
	taskPackageId: string | null;
	matchesIntent: boolean;
	unexpectedAreas: string[];
	ignoredFiles: string[];
	expectedChangeMode: string | null;
	observedChangeMode: string;
	modeDelta: { expected: string | undefined; observed: string } | null;
	expectedContracts: string[];
	observedContracts: string[];
	contractDelta: Array<{ contract: string; status: "expected_not_observed" }>;
	missingExpectedContracts: string[];
	objectiveProgress: "none" | "partial" | "unclear";
	nextAdvisory: string;
};

export function buildPostflightTaskTrace(
	input: PostflightTaskTraceInput,
): PostflightTaskTrace {
	const explicitIgnoredFiles = explicitIgnoredChangedFiles(
		input.report.changedFiles,
		input.ignoredFiles ?? [],
	);
	const stateRootIgnoredFiles = stateRootExcludedFiles(
		input.report.changedFiles,
		input.stateRoot,
		input.constitutionPaths,
	);
	const effectiveChangedFiles = input.report.changedFiles.filter(
		(file) =>
			!explicitIgnoredFiles.includes(file) &&
			!stateRootIgnoredFiles.includes(file),
	);
	const unexpectedAreas = input.expectedFiles.length
		? effectiveChangedFiles.filter(
				(file) =>
					!input.expectedFiles.some((expected) =>
						normalizePath(file).startsWith(normalizePath(expected)),
					),
			)
		: [];
	const observedContracts = contractsFromPostflightImpact(
		input.report.impactedAreas,
	);
	const missingExpectedContracts = input.expectedContracts.filter(
		(contract) => !observedContracts.includes(contract),
	);
	const observedChangeMode =
		effectiveChangedFiles.length === 0
			? "no-op"
			: (input.report.observedChangeMode ?? "code");
	const modeMatches = input.expectedChangeMode
		? input.expectedChangeMode === observedChangeMode
		: true;
	return {
		actionId: input.actionId ?? null,
		taskPackageId: input.taskPackageId ?? null,
		matchesIntent:
			unexpectedAreas.length === 0 &&
			missingExpectedContracts.length === 0 &&
			modeMatches,
		unexpectedAreas,
		ignoredFiles: dedupe([
			...(input.report.ignoredFiles ?? []),
			...explicitIgnoredFiles,
			...stateRootIgnoredFiles,
		]),
		expectedChangeMode: input.expectedChangeMode ?? null,
		observedChangeMode,
		modeDelta: modeMatches
			? null
			: { expected: input.expectedChangeMode, observed: observedChangeMode },
		expectedContracts: input.expectedContracts,
		observedContracts,
		contractDelta: missingExpectedContracts.map((contract) => ({
			contract,
			status: "expected_not_observed",
		})),
		missingExpectedContracts,
		objectiveProgress:
			effectiveChangedFiles.length === 0
				? "none"
				: input.report.risk === "low"
					? "partial"
					: "unclear",
		nextAdvisory:
			input.report.risk === "low"
				? "Puede pasar a revisión del orquestador y AgentLab si la política lo requiere."
				: "Revalidar contratos y considerar AgentLab audit-only antes de cerrar.",
	};
}

function explicitIgnoredChangedFiles(
	changedFiles: string[],
	ignoredFiles: string[],
): string[] {
	const normalizedIgnored = ignoredFiles.map((file) => normalizePath(file));
	return changedFiles.filter((changedFile) => {
		const normalizedChanged = normalizePath(changedFile);
		return normalizedIgnored.some((ignoredFile) => {
			if (!ignoredFile) return false;
			if (ignoredFile.endsWith("/")) {
				return normalizedChanged.startsWith(ignoredFile);
			}
			return normalizedChanged === ignoredFile;
		});
	});
}

/**
 * Return the subset of `changedFiles` that should be auto-ignored because they
 * live under `stateRoot` or match one of `constitutionPaths`. Comparison is
 * case-insensitive on win32 (consistent with `normalizePath`) and uses posix
 * separators internally so mixed `\` and `/` inputs still match.
 *
 * Empty or absent inputs return `[]`. The returned entries preserve the
 * original `changedFiles` strings (no normalization) so they round-trip
 * exactly into the report's `ignoredFiles` list.
 */
function stateRootExcludedFiles(
	changedFiles: string[],
	stateRoot: string | undefined,
	constitutionPaths: string[] | undefined,
): string[] {
	const hasStateRoot = typeof stateRoot === "string" && stateRoot.length > 0;
	const hasConstitutions =
		Array.isArray(constitutionPaths) && constitutionPaths.length > 0;
	if (!hasStateRoot && !hasConstitutions) return [];
	const toPosix = (p: string): string => normalizePath(p).replace(/\\/g, "/");
	const stateRootPrefix = hasStateRoot
		? toPosix(stateRoot!).replace(/\/+$/, "") + "/"
		: null;
	const constitutionSet = new Set(
		hasConstitutions ? constitutionPaths!.map((p) => toPosix(p)) : [],
	);
	return changedFiles.filter((changedFile) => {
		const normalized = toPosix(changedFile);
		if (stateRootPrefix && normalized.startsWith(stateRootPrefix)) {
			return true;
		}
		return constitutionSet.has(normalized);
	});
}

function contractsFromPostflightImpact(areas: string[]): string[] {
	const text = areas.join(" ").toLowerCase();
	return dedupe([
		...(text.match(/seguridad|auth|secret|env/u) ? ["security"] : []),
		...(text.match(/db|storage|datos|schema/u) ? ["data"] : []),
		...(text.match(/docs/u) ? ["docs"] : []),
		...(text.match(/tests?/u) ? ["tests"] : []),
		...(text.match(/ui|frontend|components|pages|html|css/u)
			? ["frontend"]
			: []),
		...(text.match(/orquestaci|code|flujos|mapa/u) ? ["agent"] : []),
		...(areas.length ? ["agent"] : []),
	]);
}

function normalizePath(path: string): string {
	return process.platform === "win32" ? path.toLowerCase() : path;
}

function dedupe(items: string[]): string[] {
	return [...new Set(items.filter((item) => item.trim().length > 0))];
}

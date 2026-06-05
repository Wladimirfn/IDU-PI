export type PostflightTaskTraceInput = {
	actionId?: string;
	taskPackageId?: string;
	expectedContracts: string[];
	expectedFiles: string[];
	expectedChangeMode?: string;
	ignoredFiles?: string[];
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
	const effectiveChangedFiles = input.report.changedFiles.filter(
		(file) => !explicitIgnoredFiles.includes(file),
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
	const observedChangeMode = input.report.observedChangeMode ?? "code";
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

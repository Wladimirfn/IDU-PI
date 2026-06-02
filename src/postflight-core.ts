export type PostflightTaskTraceInput = {
	actionId?: string;
	taskPackageId?: string;
	expectedContracts: string[];
	expectedFiles: string[];
	expectedChangeMode?: string;
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
	const unexpectedAreas = input.expectedFiles.length
		? input.report.changedFiles.filter(
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
		ignoredFiles: input.report.ignoredFiles ?? [],
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
			input.report.changedFiles.length === 0
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

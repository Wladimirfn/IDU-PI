/**
 * parsers.ts — small argument parsers and helpers used by the dispatch.
 * Internal-only (no exports). Re-exported by `index.ts`.
 */

export function primaryIntentConcept(concepts: string[] | undefined): string {
	return (
		concepts?.find((concept) => concept !== "task" && concept !== "queue") ??
		concepts?.[0] ??
		"unknown"
	);
}

export function cliCommandFor(telegramCommand: string): string {
	return telegramCommand
		.replace(/^\/idu_prepare\b/u, "idu-pi idu-prepare")
		.replace(
			/^\/config init_project_config\b/u,
			"Telegram: /config init_project_config",
		)
		.replace(/^\/addproject\b/u, "Telegram: /addproject")
		.replace(/^\/useproject\b/u, "Telegram: /useproject");
}

export function requiredText(parts: string[]): string {
	const text = parts.join(" ").trim();
	if (!text)
		throw new Error("Falta solicitud. Usá comillas si tiene espacios.");
	return text;
}

export function requiredArg(parts: string[], index: number, name: string): string {
	const value = parts[index]?.trim();
	if (!value) throw new Error(`Falta ${name}.`);
	return value;
}

export function requiredDecisionParts(parts: string[]): {
	pathOrLatest: string;
	proposalIdOrAll: string;
	reason?: string;
} {
	const [pathOrLatest = "", proposalIdOrAll = "", ...reasonParts] = parts;
	if (!pathOrLatest.trim() || !proposalIdOrAll.trim()) {
		throw new Error(
			"Uso: supervisor-improvements-approve latest <proposalId|all> [motivo]",
		);
	}
	const reason = reasonParts.join(" ").trim();
	return {
		pathOrLatest,
		proposalIdOrAll,
		...(reason ? { reason } : {}),
	};
}

export function requiredRuleDecisionParts(parts: string[]): {
	ruleId: string;
	reason?: string;
} {
	const [ruleId = "", ...reasonParts] = parts;
	if (!ruleId.trim()) {
		throw new Error("Uso: supervisor-learning-rules-disable <ruleId> [motivo]");
	}
	const reason = reasonParts.join(" ").trim();
	return { ruleId, ...(reason ? { reason } : {}) };
}

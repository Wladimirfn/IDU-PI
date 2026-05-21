export type AgentLabRole =
	| "security"
	| "database"
	| "code_quality"
	| "ui_ux"
	| "performance"
	| "docs"
	| "general";

export type AgentLabSeverity = "critical" | "high" | "medium" | "low" | "info";
export type AgentLabConfidence = "high" | "medium" | "low";

export type AgentLabProposal = {
	summary: string;
	steps: string[];
	risk: string;
	requiresHumanApproval: boolean;
};

export type AgentLabFinding = {
	title: string;
	description: string;
	evidence: string;
	severity: AgentLabSeverity;
	confidence: AgentLabConfidence;
	category: AgentLabRole;
	proposal?: AgentLabProposal;
	affectedFiles?: string[];
};

export type AgentLabReport = {
	role: AgentLabRole;
	summary: string;
	findings: AgentLabFinding[];
	commandsExecuted?: string[];
};

export type AgentLabReportValidationResult =
	| { ok: true; report: AgentLabReport; errors: [] }
	| { ok: false; errors: string[] };

const ROLES = new Set<AgentLabRole>([
	"security",
	"database",
	"code_quality",
	"ui_ux",
	"performance",
	"docs",
	"general",
]);
const SEVERITIES = new Set<AgentLabSeverity>([
	"critical",
	"high",
	"medium",
	"low",
	"info",
]);
const CONFIDENCES = new Set<AgentLabConfidence>(["high", "medium", "low"]);

export function validateAgentLabReport(
	value: unknown,
): AgentLabReportValidationResult {
	const errors: string[] = [];
	const report = asRecord(value);
	if (!report) {
		return { ok: false, errors: ["report must be an object"] };
	}

	const role = validateRole(report.role, "role", errors);
	const summary = validateRequiredString(report.summary, "summary", errors);
	const findings = validateFindings(report.findings, errors);
	const commandsExecuted = validateOptionalStringArray(
		report.commandsExecuted,
		"commandsExecuted",
		errors,
	);

	if (errors.length > 0 || !role || !summary || !findings) {
		return { ok: false, errors };
	}

	return {
		ok: true,
		errors: [],
		report: {
			role,
			summary,
			findings,
			...(commandsExecuted ? { commandsExecuted } : {}),
		},
	};
}

function validateFindings(
	value: unknown,
	errors: string[],
): AgentLabFinding[] | undefined {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		errors.push("findings must be an array");
		return undefined;
	}

	const findings: AgentLabFinding[] = [];
	value.forEach((item, index) => {
		const path = `findings[${index}]`;
		const finding = asRecord(item);
		if (!finding) {
			errors.push(`${path} must be an object`);
			return;
		}

		const title = validateRequiredString(
			finding.title,
			`${path}.title`,
			errors,
		);
		const description = validateRequiredString(
			finding.description,
			`${path}.description`,
			errors,
		);
		const evidence = validateRequiredString(
			finding.evidence,
			`${path}.evidence`,
			errors,
		);
		const severity = validateEnum(
			finding.severity,
			`${path}.severity`,
			SEVERITIES,
			errors,
		);
		const confidence = validateEnum(
			finding.confidence,
			`${path}.confidence`,
			CONFIDENCES,
			errors,
		);
		const category = validateRole(finding.category, `${path}.category`, errors);
		const affectedFiles = validateOptionalStringArray(
			finding.affectedFiles,
			`${path}.affectedFiles`,
			errors,
		);
		const proposal = validateProposal(
			finding.proposal,
			`${path}.proposal`,
			severity,
			errors,
		);

		if (
			title &&
			description &&
			evidence &&
			severity &&
			confidence &&
			category
		) {
			findings.push({
				title,
				description,
				evidence,
				severity,
				confidence,
				category,
				...(proposal ? { proposal } : {}),
				...(affectedFiles ? { affectedFiles } : {}),
			});
		}
	});

	return errors.length > 0 ? undefined : findings;
}

function validateProposal(
	value: unknown,
	path: string,
	severity: AgentLabSeverity | undefined,
	errors: string[],
): AgentLabProposal | undefined {
	if (value === undefined) {
		if (severity === "critical" || severity === "high") {
			errors.push(`${path} is required for critical/high findings`);
		}
		return undefined;
	}
	const proposal = asRecord(value);
	if (!proposal) {
		errors.push(`${path} must be an object`);
		return undefined;
	}

	const summary = validateRequiredString(
		proposal.summary,
		`${path}.summary`,
		errors,
	);
	const steps = validateRequiredStringArray(
		proposal.steps,
		`${path}.steps`,
		errors,
	);
	const risk = validateRequiredString(proposal.risk, `${path}.risk`, errors);
	const requiresHumanApproval = validateBoolean(
		proposal.requiresHumanApproval,
		`${path}.requiresHumanApproval`,
		errors,
	);

	if (
		(severity === "critical" || severity === "high") &&
		requiresHumanApproval === false
	) {
		errors.push(
			`${path}.requiresHumanApproval must be true for critical/high findings`,
		);
	}

	return summary && steps && risk && requiresHumanApproval !== undefined
		? { summary, steps, risk, requiresHumanApproval }
		: undefined;
}

function validateRole(
	value: unknown,
	path: string,
	errors: string[],
): AgentLabRole | undefined {
	return validateEnum(value, path, ROLES, errors);
}

function validateEnum<T extends string>(
	value: unknown,
	path: string,
	allowed: Set<T>,
	errors: string[],
): T | undefined {
	if (typeof value === "string" && allowed.has(value as T)) return value as T;
	errors.push(`${path} must be one of: ${[...allowed].join(", ")}`);
	return undefined;
}

function validateRequiredString(
	value: unknown,
	path: string,
	errors: string[],
): string | undefined {
	if (typeof value === "string" && value.trim()) return value.trim();
	errors.push(`${path} must be a non-empty string`);
	return undefined;
}

function validateBoolean(
	value: unknown,
	path: string,
	errors: string[],
): boolean | undefined {
	if (typeof value === "boolean") return value;
	errors.push(`${path} must be a boolean`);
	return undefined;
}

function validateRequiredStringArray(
	value: unknown,
	path: string,
	errors: string[],
): string[] | undefined {
	if (!Array.isArray(value)) {
		errors.push(`${path} must be an array of non-empty strings`);
		return undefined;
	}
	const strings = value.filter(
		(item): item is string =>
			typeof item === "string" && item.trim().length > 0,
	);
	if (strings.length !== value.length || strings.length === 0) {
		errors.push(`${path} must contain at least one non-empty string`);
		return undefined;
	}
	return strings.map((item) => item.trim());
}

function validateOptionalStringArray(
	value: unknown,
	path: string,
	errors: string[],
): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) {
		errors.push(`${path} must be an array of strings`);
		return undefined;
	}
	const strings = value.filter(
		(item): item is string =>
			typeof item === "string" && item.trim().length > 0,
	);
	if (strings.length !== value.length) {
		errors.push(`${path} must contain only non-empty strings`);
		return undefined;
	}
	return strings.map((item) => item.trim());
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/**
 * Pure parser for `<provider>/<model>` assignment strings. Reused by
 * the role router (T2.1) and AgentLab model-selection prompt (T2.2).
 *
 * No I/O, no Node-specific globals; safe to import in tests and from
 * either the CLI or MCP runtime.
 *
 * Valid format: `<provider>/<model>...` where:
 *   - provider is a non-empty single segment of `[A-Za-z0-9._~:@%+-]+`
 *   - model is a non-empty single segment, optionally followed by additional
 *     `/segment` parts (e.g. `openai/gpt-4o/vision`)
 *   - the combined string is exposed as `canonicalId`
 *
 * Errors thrown are subclasses of `Error` and use these messages
 * (regression-pinned by tests):
 *   - `"empty assignment"`
 *   - `"missing separator: ..."`
 *   - `"empty provider segment"`
 *   - `"empty model segment"`
 */

export type ParsedModelAssignment = {
	provider: string;
	model: string;
	canonicalId: string;
	raw: string;
};

const ASSIGNMENT_RE =
	/^([A-Za-z0-9._~:@%+-]+)\/([A-Za-z0-9._~:@%+-]+(?:\/[A-Za-z0-9._~:@%+-]+)*)$/u;

export class ModelAssignmentParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ModelAssignmentParseError";
	}
}

export function parseModelAssignment(raw: string): ParsedModelAssignment {
	if (typeof raw !== "string") {
		throw new ModelAssignmentParseError("empty assignment");
	}
	const trimmed = raw.trim();
	if (!trimmed) {
		throw new ModelAssignmentParseError("empty assignment");
	}
	if (!trimmed.includes("/")) {
		throw new ModelAssignmentParseError(
			`missing separator: ${JSON.stringify(trimmed)}`,
		);
	}
	const match = ASSIGNMENT_RE.exec(trimmed);
	if (!match) {
		const slashAtStart = trimmed.startsWith("/");
		const slashAtEnd = trimmed.endsWith("/");
		if (slashAtStart) {
			throw new ModelAssignmentParseError("empty provider segment");
		}
		if (slashAtEnd) {
			throw new ModelAssignmentParseError("empty model segment");
		}
		// Defensive fallback: any other shape that the regex rejects.
		throw new ModelAssignmentParseError(
			`invalid assignment: ${JSON.stringify(trimmed)}`,
		);
	}
	const provider = match[1];
	const model = match[2];
	return {
		provider,
		model,
		canonicalId: `${provider}/${model}`,
		raw: trimmed,
	};
}

export function isValidModelAssignment(raw: string): boolean {
	if (typeof raw !== "string") return false;
	const trimmed = raw.trim();
	if (!trimmed) return false;
	return ASSIGNMENT_RE.test(trimmed);
}

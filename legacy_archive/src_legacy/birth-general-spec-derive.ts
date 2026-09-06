import { readBirthArtifact, writeBirthArtifact } from "./birth-artifacts.js";
import {
	normalizeBirthGeneralSpec,
	type NormalizedBirthGeneralSpec,
} from "./birth-general-spec.js";

/**
 * G2 router fallback contract: if promptForRole("agentlab-ui-ux", …) returns
 * ok:false or throws, leave all visual sections in scan-empty state, emit a
 * human-readable warning, and return cleanly. Do not throw. Do not block birth.
 */

export type VisualDerivationPromptResult = {
	ok: boolean;
	output: string;
};

export type VisualDerivationPatchItem = {
	value?: unknown;
	evidence?: unknown;
};

export type VisualDerivationPrompt = (
	role: "agentlab-ui-ux",
	message: string,
	options?: { stateRoot?: string },
) => Promise<VisualDerivationPromptResult>;

export type VisualDerivationResult = {
	spec: NormalizedBirthGeneralSpec;
	appliedCount: number;
	droppedCount: number;
	routerFallbackWarning?: string;
};

const VISUAL_FIELDS = [
	"navigation",
	"interactionRules",
	"motionRules",
	"accessibilityCriteria",
	"performanceCriteria",
] as const;

export function applyVisualDerivation(input: {
	spec: NormalizedBirthGeneralSpec;
	modelPatch: unknown;
	uiFiles?: string[];
}): VisualDerivationResult {
	const spec = cloneSpec(input.spec);
	const patch = isRecord(input.modelPatch) ? input.modelPatch : {};
	const uiFiles = new Set((input.uiFiles ?? []).map(normalizePath));
	const isAllowedEvidence = (ref: string): boolean =>
		isAllowedEvidenceRef(ref, uiFiles);
	let appliedCount = 0;
	let droppedCount = 0;

	for (const field of VISUAL_FIELDS) {
		if (spec.provenance[field] === "human") {
			continue;
		}
		const rawItems = patch[field];
		if (!Array.isArray(rawItems)) continue;

		const values: string[] = [];
		const evidence: string[] = [];
		for (const rawItem of rawItems) {
			const item = parsePatchItem(rawItem);
			if (!item) {
				droppedCount++;
				continue;
			}
			const validEvidence = item.evidence.filter(isAllowedEvidence);
			if (validEvidence.length === 0) {
				droppedCount++;
				continue;
			}
			values.push(item.value);
			evidence.push(...validEvidence);
		}

		if (values.length > 0) {
			spec[field] = values;
			spec.provenance[field] = "model";
			spec.evidence[field] = unique(evidence);
			appliedCount += values.length;
		}
	}

	return { spec, appliedCount, droppedCount };
}

export function buildStage2Prompt(
	spec: NormalizedBirthGeneralSpec,
	uiFiles: string[],
): string {
	return [
		"You are deriving visual-only General Spec fields for Idu-pi Genesis G2.",
		"Return JSON only. Allowed keys: navigation, interactionRules, motionRules, accessibilityCriteria, performanceCriteria.",
		'Each item must be { value: string, evidence: ["file:line"] }. Evidence is mandatory; never invent content without file:line evidence.',
		"Do not emit non-visual fields such as baseComponents, pageStructureRules, or dataRules.",
		`Current specVersion: ${spec.specVersion}`,
		`Current visual provenance: ${JSON.stringify(spec.provenance)}`,
		"UI files:",
		...(uiFiles.length > 0
			? uiFiles.map((file) => `- ${file}`)
			: ["- none detected"]),
	].join("\n");
}

export async function runVisualDerivation(input: {
	spec?: NormalizedBirthGeneralSpec;
	stateRoot?: string;
	uiFiles?: string[];
	promptForRole: VisualDerivationPrompt;
}): Promise<VisualDerivationResult> {
	const spec =
		input.spec ??
		normalizeBirthGeneralSpec(
			input.stateRoot ? readBirthArtifact(input.stateRoot, "general-spec") : {},
		);
	const uiFiles = input.uiFiles ?? [];
	const prompt = buildStage2Prompt(spec, uiFiles);
	let promptResult: VisualDerivationPromptResult;
	try {
		promptResult = await input.promptForRole("agentlab-ui-ux", prompt, {
			stateRoot: input.stateRoot,
		});
	} catch (error) {
		return withOptionalWrite(input.stateRoot, {
			spec,
			appliedCount: 0,
			droppedCount: 0,
			routerFallbackWarning: `agentlab-ui-ux router fallback: ${
				error instanceof Error ? error.message : String(error)
			}`,
		});
	}
	if (!promptResult.ok) {
		return withOptionalWrite(input.stateRoot, {
			spec,
			appliedCount: 0,
			droppedCount: 0,
			routerFallbackWarning:
				"agentlab-ui-ux router fallback: role unavailable or unassigned; visual fields left scan-empty.",
		});
	}

	let patch: unknown;
	try {
		patch = JSON.parse(promptResult.output);
	} catch {
		return withOptionalWrite(input.stateRoot, {
			spec,
			appliedCount: 0,
			droppedCount: 0,
			routerFallbackWarning:
				"agentlab-ui-ux router fallback: response was not valid JSON; visual fields left unchanged.",
		});
	}
	return withOptionalWrite(
		input.stateRoot,
		applyVisualDerivation({ spec, modelPatch: patch, uiFiles }),
	);
}

function withOptionalWrite(
	stateRoot: string | undefined,
	result: VisualDerivationResult,
): VisualDerivationResult {
	if (stateRoot) {
		writeBirthArtifact(stateRoot, "general-spec", result.spec);
	}
	return result;
}

function cloneSpec(
	spec: NormalizedBirthGeneralSpec,
): NormalizedBirthGeneralSpec {
	return normalizeBirthGeneralSpec(JSON.parse(JSON.stringify(spec)));
}

function parsePatchItem(
	value: unknown,
): { value: string; evidence: string[] } | undefined {
	if (typeof value === "string") return undefined;
	if (!isRecord(value)) return undefined;
	if (typeof value.value !== "string" || !value.value.trim()) return undefined;
	const evidence = Array.isArray(value.evidence)
		? value.evidence.filter((item): item is string => typeof item === "string")
		: [];
	return { value: value.value.trim(), evidence };
}

function isAllowedEvidenceRef(ref: string, uiFiles: Set<string>): boolean {
	const match = /^(?<path>.+):(\d+)(?::\d+)?$/u.exec(ref.trim());
	if (!match?.groups?.path) return false;
	const path = normalizePath(match.groups.path);
	return uiFiles.has(path);
}

function normalizePath(value: string): string {
	return value.replace(/\\/gu, "/");
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

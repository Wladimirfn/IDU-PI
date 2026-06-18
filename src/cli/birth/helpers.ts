/**
 * helpers.ts — birth CLI input parsers + formatters.
 *
 * Internal-only. Re-exported by `index.ts`. Used by `src/cli.ts` for
 * the cases `idu-birth-*` and `birth-*` aliases.
 */

import { readFileSync } from "node:fs";
import type {
	approveBirthGeneralSpec,
	ApproveBirthGeneralSpecResult,
} from "../../birth-general-spec-runtime.js";
import type { VisualDerivationResult } from "../../birth-general-spec-derive.js";
import type {
	BirthStatusEnvelope,
	BirthExistingScanEnvelope,
	BirthBibliotecarioEnvelope,
	BirthValidateEnvelope,
	BirthRepoPlanEnvelope,
} from "../../birth-runtime.js";
import type { BirthPrototypeMasterEnvelope } from "../../birth-prototype-runtime.js";

export function parseBirthGeneralSpecCliInput(parts: string[]): {
	sections: Parameters<typeof approveBirthGeneralSpec>[0]["sections"];
	approvedBy: string;
} {
	const specFileIndex = parts.indexOf("--spec-file");
	let raw: unknown;
	if (specFileIndex >= 0) {
		const specPath = parts[specFileIndex + 1];
		if (!specPath)
			throw new Error("Uso: idu-birth-general-spec --spec-file <path>");
		raw = JSON.parse(readFileSync(specPath, "utf8"));
	} else {
		const json = parts.join(" ").trim();
		if (!json)
			throw new Error("Uso: idu-birth-general-spec --spec-file <path>");
		raw = JSON.parse(json);
	}
	const parsed = isObjectRecord(raw) ? raw : {};
	const sections = isObjectRecord(parsed.sections) ? parsed.sections : parsed;
	return {
		sections: parseGeneralSpecSections(sections),
		approvedBy:
			typeof parsed.approvedBy === "string" && parsed.approvedBy.trim()
				? parsed.approvedBy.trim()
				: "owner",
	};
}

export function parseGeneralSpecSections(
	value: Record<string, unknown>,
): Parameters<typeof approveBirthGeneralSpec>[0]["sections"] {
	return {
		navigation: requiredStringArray(value, "navigation"),
		baseComponents: requiredStringArray(value, "baseComponents"),
		pageStructureRules: requiredStringArray(value, "pageStructureRules"),
		dataRules: requiredStringArray(value, "dataRules"),
		interactionRules: requiredStringArray(value, "interactionRules"),
		motionRules: requiredStringArray(value, "motionRules"),
		accessibilityCriteria: requiredStringArray(value, "accessibilityCriteria"),
		performanceCriteria: requiredStringArray(value, "performanceCriteria"),
	};
}

export function requiredStringArray(
	value: Record<string, unknown>,
	key: string,
): string[] {
	const field = value[key];
	if (!Array.isArray(field) || field.some((item) => typeof item !== "string")) {
		throw new Error(`General Spec field '${key}' must be an array of strings.`);
	}
	return field;
}

export function isObjectRecord(
	value: unknown,
): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatBirthGeneralSpec(
	result: ApproveBirthGeneralSpecResult,
	status: BirthStatusEnvelope,
): string {
	const lines: string[] = [];
	lines.push(`Birth General Spec — ${result.projectId}`);
	lines.push(`status: ${result.generalSpec.status}`);
	lines.push(`specVersion: ${result.generalSpec.specVersion ?? 1}`);
	lines.push(`approvedBy: ${result.generalSpec.approvedBy ?? "—"}`);
	lines.push("");
	lines.push(formatBirthStatus(status));
	return lines.join("\n");
}

export function parseUiFiles(parts: string[]): string[] {
	const files: string[] = [];
	for (let index = 0; index < parts.length; index++) {
		const part = parts[index];
		if (part === "--ui-file") {
			const file = parts[index + 1];
			if (file) files.push(file);
			index++;
		} else if (part === "--ui-files") {
			const value = parts[index + 1];
			if (value)
				files.push(
					...value
						.split(",")
						.map((item) => item.trim())
						.filter(Boolean),
				);
			index++;
		}
	}
	return files;
}

export function formatBirthGeneralSpecDerivation(
	result: VisualDerivationResult,
): string {
	const lines: string[] = [];
	lines.push("Birth General Spec Derivation");
	lines.push(`applied: ${result.appliedCount}`);
	lines.push(`dropped: ${result.droppedCount}`);
	if (result.routerFallbackWarning) {
		lines.push(`warning: ${result.routerFallbackWarning}`);
	}
	return lines.join("\n");
}

export function formatBirthStatus(env: BirthStatusEnvelope): string {
	const lines: string[] = [];
	lines.push(`Birth Pipeline Status — ${env.projectId} (${env.mode})`);
	lines.push(`state: ${env.state}`);
	lines.push(`allowedToImplement: ${env.allowedToImplement}`);
	lines.push(`repoWritesAllowed: ${env.repoWritesAllowed}`);
	lines.push(`nextRequiredAction: ${env.nextRequiredAction}`);
	if (env.scopeLimit) lines.push(`scopeLimit: ${env.scopeLimit}`);
	if (env.blockingReasons.length > 0) {
		lines.push("blockingReasons:");
		for (const r of env.blockingReasons) lines.push(`  - ${r}`);
	}
	return lines.join("\n");
}

export function formatBirthExistingScan(
	env: BirthExistingScanEnvelope,
): string {
	const lines: string[] = [];
	lines.push(`Birth Existing Scan — ${env.projectId}`);
	const o = env.scan.observed;
	lines.push(`packageManager: ${o.packageManager}`);
	lines.push(`languages: ${o.languages.join(", ") || "(none)"}`);
	lines.push(`frameworks: ${o.frameworks.join(", ") || "(none)"}`);
	lines.push(`tests: ${o.tests.length} file(s)`);
	lines.push(`docs: ${o.docs.length} file(s)`);
	lines.push(`assets: ${o.assets.length} file(s)`);
	if (env.scan.risks.length > 0) {
		lines.push("risks:");
		for (const r of env.scan.risks) lines.push(`  - ${r}`);
	}
	lines.push(`detectedSpecs.status: ${env.detectedSpecs.status}`);
	lines.push(
		`detectedSpecs.approval.status: ${env.detectedSpecs.approval.status}`,
	);
	return lines.join("\n");
}

export function formatBirthBibliotecario(
	env: BirthBibliotecarioEnvelope,
): string {
	const d = env.discovery;
	const lines: string[] = [];
	lines.push(`Birth Bibliotecario Discovery — ${env.projectId}`);
	lines.push(`status: ${d.status}`);
	lines.push(`localSources: ${d.localSources.length}`);
	lines.push(`externalPermission: ${d.externalPermission}`);
	lines.push(
		`externalCategoriesNeeded: ${d.externalCategoriesNeeded.join(", ") || "(none)"}`,
	);
	lines.push(`ideas: ${d.ideas.length}`);
	if (d.ideas.length > 0) {
		for (const idea of d.ideas) {
			lines.push(
				`  - ${idea.sourcePath}: ${idea.compatibility} (${idea.decisionStatus})`,
			);
		}
	}
	if (d.limitations.length > 0) {
		lines.push("limitations:");
		for (const l of d.limitations) lines.push(`  - ${l}`);
	}
	lines.push(`nextRequiredAction: ${d.nextRequiredAction}`);
	return lines.join("\n");
}

export function formatBirthValidate(env: BirthValidateEnvelope): string {
	const lines: string[] = [];
	lines.push(
		formatBirthExistingScan({
			version: 1,
			kind: "birth_existing_scan",
			projectId: env.projectId,
			scan: env.scan,
			detectedSpecs: env.detectedSpecs,
		}),
	);
	lines.push("");
	lines.push(formatBirthBibliotecario(env.bibliotecario));
	lines.push("");
	lines.push(
		formatBirthStatus({ ...env.readiness, version: 1, kind: "birth_status" }),
	);
	return lines.join("\n");
}

export function formatBirthRepoPlan(env: BirthRepoPlanEnvelope): string {
	const d = env.decision;
	const lines: string[] = [];
	lines.push(`Birth Repo Plan — ${env.projectId}`);
	lines.push(`repoWritesAllowed: ${d.repoWritesAllowed}`);
	if (d.blockingReasons.length > 0) {
		lines.push("blockingReasons:");
		for (const r of d.blockingReasons) lines.push(`  - ${r}`);
	}
	lines.push(`nextRequiredAction: ${d.nextRequiredAction}`);
	return lines.join("\n");
}

export function formatBirthPrototype(
	env: BirthPrototypeMasterEnvelope,
): string {
	const p = env.prototype;
	const lines: string[] = [];
	lines.push(`Birth Master Prototype — ${env.projectId}`);
	lines.push(`status: ${p.status}`);
	if (p.approvedBy) lines.push(`approvedBy: ${p.approvedBy}`);
	if (p.approvedAt) lines.push(`approvedAt: ${p.approvedAt}`);
	lines.push(`productIntent: ${p.productIntent}`);
	lines.push(`visualStyle: ${p.visualStyle}`);
	lines.push(`layoutBase: ${p.layoutBase}`);
	lines.push(
		`stackRecommendation: ${p.stackRecommendation.packageManager} / ${p.stackRecommendation.runtime}`,
	);
	lines.push(`forbiddenPatterns: ${p.forbiddenPatterns.join(", ")}`);
	lines.push(`scalingRules: ${p.scalingRules.join(", ")}`);
	return lines.join("\n");
}

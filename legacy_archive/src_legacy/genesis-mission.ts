import { writeBirthArtifact } from "./birth-artifacts.js";
import type { BirthExistingScanResult } from "./birth-existing-scan.js";

/*
 * Genesis G3 consumer audit (2026-06-13):
 * - src/cli.ts currently treats runOnboardProject as an opaque report and reads only
 *   result.exitCode/result.ok to choose stdout vs stderr; it serializes the full object.
 * - src/mcp-server.ts has no current idu-onboard-project consumer/tool; G3 will add an
 *   explicit idu_genesis_mission_draft / idu_genesis_mission_confirm pair.
 * - src/index.ts has no direct Telegram handler for runOnboardProject output today. The
 *   future mirror must render truthful envelope fields and must not hardcode ready/aligned.
 * - test/onboard-project.test.ts currently asserts ok/exitCode, every step.status, and
 *   side effects for lab.db/bootstrap skill/supervisor-trigger.
 * The G3 truthful envelope must remain a superset for structural readers while removing
 * synthetic ready/aligned values from the onboard flow.
 */

export type ProjectDocs = {
	packageName?: string;
	packageDescription?: string;
	readmeTitle?: string;
	tsconfigStrict?: boolean;
};

export type MissionHierarchy = {
	languages: string[];
	frameworks: string[];
	packageManager: string;
};

export type MissionDraft = {
	version: 1;
	projectId: string;
	status: "draft";
	objective: string;
	unbreakableRules: string[];
	hierarchy: MissionHierarchy;
	derivedFrom: string[];
};

export type BlueprintArtifact = Omit<MissionDraft, "status" | "derivedFrom"> & {
	confirmedBy: string;
	confirmedAt: string;
};

export function inferMission(
	scan: BirthExistingScanResult,
	docs: ProjectDocs,
): MissionDraft {
	const observed = scan.scan.observed;
	const projectLabel =
		docs.packageDescription?.trim() ||
		docs.readmeTitle?.trim() ||
		docs.packageName?.trim() ||
		scan.scan.projectId;
	const contextParts = [
		docs.readmeTitle?.trim(),
		observed.frameworks.length > 0
			? `using ${observed.frameworks.join(", ")}`
			: undefined,
	]
		.filter((part): part is string => Boolean(part))
		.join(" ");
	const objective = contextParts
		? `The objective of this project is ${projectLabel} (${contextParts}).`
		: `The objective of this project is ${projectLabel}.`;
	const unbreakableRules = inferUnbreakableRules(scan, docs);

	return {
		version: 1,
		projectId: scan.scan.projectId,
		status: "draft",
		objective,
		unbreakableRules,
		hierarchy: {
			languages: unique(observed.languages),
			frameworks: unique(observed.frameworks),
			packageManager: observed.packageManager,
		},
		derivedFrom: ["existing-scan", "project-docs"],
	};
}

export function persistBlueprint(
	stateRoot: string,
	blueprint: BlueprintArtifact,
): string {
	return writeBirthArtifact(stateRoot, "blueprint", blueprint);
}

function inferUnbreakableRules(
	scan: BirthExistingScanResult,
	docs: ProjectDocs,
): string[] {
	const rules: string[] = [];
	if (scan.scan.observed.tests.length > 0) {
		rules.push("All changes ship with tests.");
	}
	if (docs.tsconfigStrict) {
		rules.push("TypeScript strict mode is mandatory.");
	}
	if (rules.length === 0) {
		rules.push("Mission changes require explicit owner confirmation.");
	}
	return rules;
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

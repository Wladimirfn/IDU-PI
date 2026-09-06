import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type TaxonomyGuideRule = {
	id: string;
	canonicalDir: string;
	mustIndex?: boolean;
	description?: string;
};

export type TaxonomyGuide = {
	version: 1;
	projectType: string;
	rules: TaxonomyGuideRule[];
};

export type ArtifactDescriptor = {
	path: string;
	indexed: boolean;
};

export type PlacementViolation = {
	ruleId: string;
	artifactPath: string;
	canonicalDir: string;
	message: string;
};

const BUILTIN_RULES: Record<string, TaxonomyGuideRule[]> = {
	web: [
		{
			id: "web-components",
			canonicalDir: "src/components",
			mustIndex: true,
			description: "UI components",
		},
		{
			id: "web-pages",
			canonicalDir: "src/pages",
			mustIndex: true,
			description: "Page components",
		},
		{
			id: "web-routes",
			canonicalDir: "src/routes",
			mustIndex: false,
			description: "Route handlers",
		},
	],
	program: [
		{
			id: "program-services",
			canonicalDir: "src/services",
			mustIndex: true,
			description: "Service modules",
		},
		{
			id: "program-lib",
			canonicalDir: "src/lib",
			mustIndex: false,
			description: "Library code",
		},
	],
	library: [
		{
			id: "library-src",
			canonicalDir: "src",
			mustIndex: true,
			description: "Library source",
		},
		{
			id: "library-tests",
			canonicalDir: "test",
			mustIndex: false,
			description: "Library tests",
		},
	],
};

function readGuideFile(
	stateRoot: string,
	projectType: string,
): TaxonomyGuide | null {
	const path = join(stateRoot, "birth", "taxonomy", `${projectType}.json`);
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf8");
		if (!raw.trim()) return null;
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			Array.isArray(parsed.rules)
		) {
			return {
				version: 1,
				projectType: String(parsed.projectType ?? projectType),
				rules: (parsed.rules as TaxonomyGuideRule[]).filter(
					(rule) =>
						typeof rule?.id === "string" &&
						typeof rule?.canonicalDir === "string",
				),
			};
		}
	} catch {
		// Lenient parse-or-default
	}
	return null;
}

export function readTaxonomyGuide(
	stateRoot: string,
	projectType: string,
): TaxonomyGuide {
	const fromFile = readGuideFile(stateRoot, projectType);
	if (fromFile) return fromFile;
	const builtin = BUILTIN_RULES[projectType] ?? BUILTIN_RULES.web;
	return {
		version: 1,
		projectType,
		rules: builtin,
	};
}

export function reviewPlacement(
	artifacts: ArtifactDescriptor[],
	guide: TaxonomyGuide,
): PlacementViolation[] {
	const violations: PlacementViolation[] = [];
	for (const artifact of artifacts) {
		const matchingRules = guide.rules.filter((rule) =>
			artifact.path.startsWith(`${rule.canonicalDir}/`),
		);
		if (matchingRules.length === 0) {
			const suggested = guide.rules[0];
			violations.push({
				ruleId: suggested?.id ?? "unknown",
				artifactPath: artifact.path,
				canonicalDir: suggested?.canonicalDir ?? "(none)",
				message: `Artifact '${artifact.path}' does not match any rule's canonical dir; expected under one of: ${guide.rules.map((r) => r.canonicalDir).join(", ")}.`,
			});
			continue;
		}
		for (const rule of matchingRules) {
			if (rule.mustIndex && !artifact.indexed) {
				violations.push({
					ruleId: rule.id,
					artifactPath: artifact.path,
					canonicalDir: rule.canonicalDir,
					message: `Artifact '${artifact.path}' must be indexed (mustIndex=true).`,
				});
			}
		}
	}
	return violations;
}

export function seedTaxonomyTemplates(
	stateRoot: string,
	projectType: string,
): void {
	const dir = join(stateRoot, "birth", "taxonomy");
	const path = join(dir, `${projectType}.json`);
	if (existsSync(path)) return; // Idempotent
	mkdirSync(dir, { recursive: true });
	const builtin = BUILTIN_RULES[projectType] ?? BUILTIN_RULES.web;
	const guide: TaxonomyGuide = {
		version: 1,
		projectType,
		rules: builtin,
	};
	writeFileSync(path, `${JSON.stringify(guide, null, 2)}\n`, "utf8");
}

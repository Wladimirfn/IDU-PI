import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { resolve } from "node:path";
import { readBirthArtifact, writeBirthArtifact } from "./birth-artifacts.js";
import { scanExistingProject } from "./birth-existing-scan.js";
import {
	inferMission,
	persistBlueprint,
	type BlueprintArtifact,
	type MissionDraft,
	type ProjectDocs,
} from "./genesis-mission.js";

export type GenesisMissionDraftInput = {
	stateRoot: string;
	projectPath: string;
};

export type GenesisMissionDraftResult = {
	ok: boolean;
	stateRoot: string;
	projectPath: string;
	missionDraft: MissionDraft;
	error?: string;
};

export type GenesisMissionConfirmInput = {
	stateRoot: string;
	projectPath: string;
	owner: string;
	now?: () => Date;
};

export type GenesisMissionConfirmResult = {
	ok: boolean;
	stateRoot: string;
	projectPath: string;
	blueprint: BlueprintArtifact;
	error?: string;
};

export function runGenesisMissionDraft(
	input: GenesisMissionDraftInput,
): GenesisMissionDraftResult {
	const stateRoot = resolve(input.stateRoot);
	const projectPath = resolve(input.projectPath);
	mkdirSync(stateRoot, { recursive: true });
	mkdirSync(joinBirth(stateRoot), { recursive: true });
	const scan = scanExistingProject({ projectPath, projectId: projectIdFromPath(projectPath) });
	writeBirthArtifact(stateRoot, "existing-scan", scan.scan);
	writeBirthArtifact(stateRoot, "detected-specs", scan.detectedSpecs);
	const docs: ProjectDocs = readProjectDocs(projectPath);
	const missionDraft = inferMission(scan, docs);
	writeBirthArtifact(stateRoot, "mission-draft", missionDraft);
	return { ok: true, stateRoot, projectPath, missionDraft };
}

export function runGenesisMissionConfirm(
	input: GenesisMissionConfirmInput,
): GenesisMissionConfirmResult {
	const stateRoot = resolve(input.stateRoot);
	const projectPath = resolve(input.projectPath);
	const existing = readBirthArtifact<MissionDraft>(stateRoot, "mission-draft");
	if (!existing) {
		return {
			ok: false,
			stateRoot,
			projectPath,
			blueprint: emptyBlueprint(projectPath),
			error: "No mission-draft persisted; call idu_genesis_mission_draft first.",
		};
	}
	const next: BlueprintArtifact = {
		version: 1,
		projectId: existing.projectId,
		objective: existing.objective,
		unbreakableRules: existing.unbreakableRules,
		hierarchy: existing.hierarchy,
		confirmedBy: input.owner,
		confirmedAt: (input.now?.() ?? new Date()).toISOString(),
	};
	persistBlueprint(stateRoot, next);
	return { ok: true, stateRoot, projectPath, blueprint: next };
}

function joinBirth(stateRoot: string): string {
	return dirname(`${stateRoot}/birth/blueprint.json`.replace(/\//gu, "/"));
}

function projectIdFromPath(projectPath: string): string {
	return projectPath.split(/[\\/]/u).filter(Boolean).pop() ?? "project";
}

function readProjectDocs(projectPath: string): ProjectDocs {
	const docs: ProjectDocs = {};
	try {
		const pkg = readJsonSafe(`${projectPath}/package.json`);
		if (pkg && typeof pkg === "object") {
			const p = pkg as Record<string, unknown>;
			if (typeof p.name === "string") docs.packageName = p.name;
			if (typeof p.description === "string") {
				docs.packageDescription = p.description;
			}
		}
	} catch {
		// fallthrough
	}
	try {
		const ts = readJsonSafe(`${projectPath}/tsconfig.json`);
		if (ts && typeof ts === "object") {
			const compiler = (ts as { compilerOptions?: { strict?: unknown } })
				.compilerOptions;
			if (compiler?.strict === true) {
				docs.tsconfigStrict = true;
			}
		}
	} catch {
		// fallthrough
	}
	try {
		const readme = readTextSafe(`${projectPath}/README.md`);
		if (readme) {
			const heading = readme.match(/^#\s+(.+)$/mu);
			if (heading) docs.readmeTitle = heading[1].trim();
		}
	} catch {
		// fallthrough
	}
	return docs;
}

function readJsonSafe(path: string): unknown {
	if (!existsSync(path)) return undefined;
	const raw = readFileSync(path, "utf8");
	return JSON.parse(raw);
}

function readTextSafe(path: string): string | undefined {
	if (!existsSync(path)) return undefined;
	return readFileSync(path, "utf8");
}

function emptyBlueprint(projectPath: string): BlueprintArtifact {
	return {
		version: 1,
		projectId: projectIdFromPath(projectPath),
		objective: "",
		unbreakableRules: [],
		hierarchy: { languages: [], frameworks: [], packageManager: "unknown" },
		confirmedBy: "",
		confirmedAt: "",
	};
}

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LabDbRepository } from "./lab-db-repository.js";
import { writeBirthArtifact } from "./birth-artifacts.js";
import type { BlueprintArtifact } from "./genesis-mission.js";
import type { BirthGeneralSpec } from "./birth-general-spec.js";
import type { BugFinding } from "./lab-db.js";

export type ProjectFlows = {
	version: string;
	projectType: string;
	[key: string]: unknown;
};

export type DraftInputs = {
	compactionEvents: unknown[];
	flows?: ProjectFlows;
	blueprint?: BlueprintArtifact;
	generalSpec?: BirthGeneralSpec;
	agentlabFindings?: BugFinding[];
};

function readJsonSafe<T>(path: string): T | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const raw = readFileSync(path, "utf8");
		if (!raw.trim()) return undefined;
		return JSON.parse(raw) as T;
	} catch {
		return undefined;
	}
}

function readBirthJson<T>(stateRoot: string, name: string): T | undefined {
	return readJsonSafe<T>(join(stateRoot, "birth", `${name}.json`));
}

export function collectDraftInputs(
	stateRoot: string,
	projectId: string,
): DraftInputs {
	const inputs: DraftInputs = {
		compactionEvents: [],
	};

	// 1. project-flows.json from synced config
	const flowsPath = join(stateRoot, "config", "project-flows.json");
	const flows = readJsonSafe<ProjectFlows>(flowsPath);
	if (flows) {
		inputs.flows = flows;
	}

	// 2. birth/blueprint.json
	const blueprint = readBirthJson<BlueprintArtifact>(stateRoot, "blueprint");
	if (blueprint) {
		inputs.blueprint = blueprint;
	}

	// 3. birth/general-spec.json
	const generalSpec = readBirthJson<BirthGeneralSpec>(
		stateRoot,
		"general-spec",
	);
	if (generalSpec) {
		inputs.generalSpec = generalSpec;
	}

	// 4. AgentLab findings from lab.db (parse-or-skip)
	const dbPath = join(stateRoot, "lab.db");
	if (existsSync(dbPath)) {
		try {
			const repo = new LabDbRepository(dbPath);
			const findings = repo.listOpenFindings(projectId);
			if (findings.length > 0) {
				inputs.agentlabFindings = findings;
			}
		} catch {
			// Corrupt or missing lab.db → skip silently
		}
	}

	return inputs;
}

// Keep the import live for callers that use writeBirthArtifact directly.
void writeBirthArtifact;

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LabDbRepository } from "./lab-db-repository.js";
import { writeBirthArtifact } from "./birth-artifacts.js";
import { readIdPathWithMigration } from "./hygiene-migrate.js";
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

	// 1. project-flows.json from synced config (F-Item3a: route through
	// the canonical path — Layout A via readIdPathWithMigration. The
	// previous version hardcoded Layout B `config/project-flows.json`
	// which does NOT exist on real projects; the canonical file lives
	// at `.idu/config/project-flows.json`. We only set `inputs.flows`
	// when the project has the file. The canonical `loadProjectFlows`
	// would validate the schema and throw on partial flows; the inputs
	// collector tolerates partial flows, so we read raw + parse JSON
	// without validation here.)
	const flowsMigrated = readIdPathWithMigration(stateRoot, "project-flows.json");
	if (flowsMigrated.content !== null) {
		try {
			inputs.flows = JSON.parse(flowsMigrated.content) as ProjectFlows;
		} catch {
			// Skip malformed flows — the canonical loader (elsewhere)
			// validates and would throw; the inputs collector is
			// lenient by design.
		}
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

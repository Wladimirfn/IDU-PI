import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LabDbRepository } from "./lab-db-repository.js";
import { seedBootstrapSkillIfMissing } from "./bibliotecario-init.js";

export type BibliotecarioInitResult = {
	ok: true;
	dbPath: string;
	dbCreated: boolean;
	bootstrapSkill: {
		inserted: boolean;
		id: string;
		name: string;
		version: string;
		status: string;
	};
	events: {
		labWrite: number;
	};
};

export type BibliotecarioInitFailure = {
	ok: false;
	error: string;
};

export type BibliotecarioInitOutcome =
	| BibliotecarioInitResult
	| BibliotecarioInitFailure;

export function runBibliotecarioInit(input: {
	stateRoot: string;
	projectId: string;
}): BibliotecarioInitOutcome {
	const { stateRoot, projectId } = input;

	try {
		// Ensure stateRoot exists
		if (!existsSync(stateRoot)) {
			mkdirSync(stateRoot, { recursive: true });
		}

		const dbPath = join(stateRoot, "lab.db");
		const dbCreated = !existsSync(dbPath);

		// REQ-SF-4: stamp events with the ACTIVE project id, not the
		// literal string "bibliotecario". The bibliotecario lifecycle
		// is per-project, so the event payload must carry the project
		// id of the caller.
		const repo = new LabDbRepository(dbPath, {
			bibliotecarioProjectId: projectId,
		});
		repo.init();

		// Count events before seeding
		const eventsPath = join(stateRoot, "events.jsonl");
		const eventsBefore = existsSync(eventsPath)
			? readFileSync(eventsPath, "utf8").split("\n").filter(Boolean).length
			: 0;

		// Seed bootstrap skill if missing
		const skill = seedBootstrapSkillIfMissing(stateRoot);
		if (!skill) {
			return {
				ok: false,
				error: `Failed to seed bootstrap skill in ${stateRoot}`,
			};
		}

		// Count events after seeding
		const eventsAfter = existsSync(eventsPath)
			? readFileSync(eventsPath, "utf8").split("\n").filter(Boolean).length
			: 0;

		return {
			ok: true,
			dbPath,
			dbCreated,
			bootstrapSkill: {
				inserted: dbCreated || eventsAfter > eventsBefore,
				id: skill.id,
				name: skill.name,
				version: skill.version,
				status: skill.status,
			},
			events: {
				labWrite: eventsAfter - eventsBefore,
			},
		};
	} catch (error) {
		return {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function formatBibliotecarioInit(
	result: BibliotecarioInitResult,
): string {
	const lines = [
		"Bibliotecario init",
		`  db path:        ${result.dbPath}`,
		`  db created:     ${result.dbCreated ? "yes" : "no"}`,
		`  bootstrap:      ${
			result.bootstrapSkill.inserted
				? `inserted (${result.bootstrapSkill.name} v${result.bootstrapSkill.version} ${result.bootstrapSkill.status})`
				: `already present (${result.bootstrapSkill.name} v${result.bootstrapSkill.version} ${result.bootstrapSkill.status})`
		}`,
		`  lab_write evt:  ${result.events.labWrite}`,
		"  exit:           0",
	];
	return lines.join("\n");
}

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readBirthArtifact } from "../src/birth-artifacts.js";
import type {
	BlueprintArtifact,
	MissionDraft,
} from "../src/genesis-mission.js";
import {
	runGenesisMissionDraft,
	runGenesisMissionConfirm,
} from "../src/genesis-mission-tools.js";

function makeRepoWithSource(): {
	stateRoot: string;
	projectPath: string;
} {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-mcp-genesis-"));
	const projectPath = join(stateRoot, "repo");
	mkdirSync(projectPath, { recursive: true });
	writeFileSync(
		join(projectPath, "package.json"),
		`${JSON.stringify(
			{
				name: "demo-app",
				description: "Maintenance dashboard for field teams",
				devDependencies: { typescript: "^5.0.0" },
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	writeFileSync(
		join(projectPath, "tsconfig.json"),
		'{"strict": true}\n',
		"utf8",
	);
	return { stateRoot, projectPath };
}

test("runGenesisMissionDraft returns a truthful unconfirmed draft", () => {
	const { stateRoot, projectPath } = makeRepoWithSource();
	try {
		const draft = runGenesisMissionDraft({ stateRoot, projectPath });
		assert.equal(draft.ok, true);
		assert.equal(draft.missionDraft.status, "draft");
		assert.match(
			draft.missionDraft.objective,
			/Maintenance dashboard for field teams/u,
		);
		const persisted = readBirthArtifact<MissionDraft>(
			stateRoot,
			"mission-draft",
		);
		assert.ok(persisted);
		assert.equal(persisted?.status, "draft");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("runGenesisMissionConfirm persists a confirmed blueprint", () => {
	const { stateRoot, projectPath } = makeRepoWithSource();
	try {
		runGenesisMissionDraft({ stateRoot, projectPath });
		const result = runGenesisMissionConfirm({
			stateRoot,
			projectPath,
			owner: "owner",
			now: () => new Date("2026-06-14T00:00:00.000Z"),
		});
		assert.equal(result.ok, true);
		assert.equal(result.blueprint.confirmedBy, "owner");
		assert.equal(result.blueprint.confirmedAt, "2026-06-14T00:00:00.000Z");
		const persisted = readBirthArtifact<BlueprintArtifact>(
			stateRoot,
			"blueprint",
		);
		assert.deepEqual(persisted, result.blueprint);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("runGenesisMissionConfirm fails clearly when no draft exists", () => {
	const { stateRoot, projectPath } = makeRepoWithSource();
	try {
		const result = runGenesisMissionConfirm({
			stateRoot,
			projectPath,
			owner: "owner",
		});
		assert.equal(result.ok, false);
		assert.match(result.error ?? "", /mission-draft/u);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

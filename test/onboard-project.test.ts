import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runOnboardProject } from "../src/cli-onboard-project.js";
import { readBirthArtifact } from "../src/birth-artifacts.js";
import type { BlueprintArtifact, MissionDraft } from "../src/genesis-mission.js";

test("runOnboardProject performs a real scan and returns a truthful mission draft", () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-onboard-truthful-"));
	try {
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
		writeFileSync(join(projectPath, "tsconfig.json"), "{ \"strict\": true }\n", "utf8");
		mkdirSync(join(projectPath, "test"), { recursive: true });
		writeFileSync(join(projectPath, "test", "app.test.ts"), "export {};\n", "utf8");

		const report = runOnboardProject(stateRoot, "demo", {
			projectPath,
			workspaceRoot: stateRoot,
			allowedRoots: [stateRoot, projectPath],
			registryPath: join(stateRoot, "registry", "projects.json"),
		});

		assert.equal(report.ok, true, JSON.stringify(report, null, 2));
		assert.equal(report.exitCode, 0);
		assert.match(
			report.missionDraft?.objective ?? "",
			/Maintenance dashboard for field teams/u,
		);
		assert.equal(
			"confirmedBy" in (report.missionDraft ?? {}),
			false,
			JSON.stringify(report.missionDraft, null, 2),
		);
		assert.ok(
			report.missionDraft?.unbreakableRules.includes(
				"All changes ship with tests.",
			),
		);
		assert.equal(
			report.steps.some(
				(step) => step.id === "scanExistingProject" && step.status === "success",
			),
			true,
		);
		assert.equal(
			report.steps.some(
				(step) => step.id === "inferMission" && step.status === "success",
			),
			true,
		);
		// Truthful inspection: no synthetic ready/aligned.
		assert.equal(
			JSON.stringify(report).match(/"ready"|"aligned"/u) === null,
			true,
			JSON.stringify(report, null, 2),
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("runOnboardProject persists the confirmed mission when owner accepts it", () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-onboard-confirm-"));
	try {
		const projectPath = join(stateRoot, "repo");
		mkdirSync(projectPath, { recursive: true });
		writeFileSync(join(projectPath, "package.json"), "{}\n", "utf8");

		const report = runOnboardProject(stateRoot, "demo", {
			projectPath,
			workspaceRoot: stateRoot,
			allowedRoots: [stateRoot, projectPath],
			registryPath: join(stateRoot, "registry", "projects.json"),
			confirmMission: {
				owner: "owner",
				now: () => new Date("2026-06-14T00:00:00.000Z"),
			},
		});

		assert.equal(report.ok, true, JSON.stringify(report, null, 2));
		assert.equal(report.exitCode, 0);
		const persisted = readBirthArtifact<BlueprintArtifact>(stateRoot, "blueprint");
		assert.ok(persisted, "blueprint must be persisted");
		assert.equal(persisted.confirmedBy, "owner");
		assert.equal(persisted.confirmedAt, "2026-06-14T00:00:00.000Z");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("runOnboardProject persists mission draft and skips blueprint when not confirmed", () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-onboard-draft-"));
	try {
		const projectPath = join(stateRoot, "repo");
		mkdirSync(projectPath, { recursive: true });
		writeFileSync(join(projectPath, "package.json"), "{}\n", "utf8");

		const report = runOnboardProject(stateRoot, "demo", {
			projectPath,
			workspaceRoot: stateRoot,
			allowedRoots: [stateRoot, projectPath],
			registryPath: join(stateRoot, "registry", "projects.json"),
		});

		assert.equal(report.ok, true, JSON.stringify(report, null, 2));
		const draft = readBirthArtifact<MissionDraft>(stateRoot, "mission-draft");
		assert.ok(draft, "draft must be persisted");
		assert.equal(draft?.status, "draft");
		const blueprint = readBirthArtifact<BlueprintArtifact>(stateRoot, "blueprint");
		assert.equal(blueprint, undefined);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

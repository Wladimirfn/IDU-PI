import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runOnboardProject } from "../src/cli-onboard-project.js";
import { LabDbRepository } from "../src/lab-db-repository.js";

test("runOnboardProject smoke creates lab.db, bootstrap skill, enabled trigger, and exits 0", () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "idu-onboard-project-"));
	try {
		const projectPath = join(stateRoot, "repo");
		mkdirSync(projectPath, { recursive: true });

		const report = runOnboardProject(stateRoot, "onboard-project", {
			projectPath,
			workspaceRoot: stateRoot,
			allowedRoots: [stateRoot],
			registryPath: join(stateRoot, "registry", "projects.json"),
		});

		assert.equal(report.ok, true, JSON.stringify(report, null, 2));
		assert.equal(report.exitCode, 0);
		assert.equal(
			report.steps.every((step) => step.status === "success"),
			true,
		);

		const dbPath = join(stateRoot, "lab.db");
		assert.equal(existsSync(dbPath), true, "lab.db should exist");
		const repo = new LabDbRepository(dbPath);
		const bootstrap = repo
			.listSkills()
			.find((skill) => skill.name === "bibliotecario-bootstrap");
		assert.ok(bootstrap, "bootstrap skill should exist");

		const triggerPath = join(stateRoot, "supervisor-trigger.json");
		assert.equal(existsSync(triggerPath), true, "trigger file should exist");
		assert.equal(JSON.parse(readFileSync(triggerPath, "utf8")).enabled, true);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

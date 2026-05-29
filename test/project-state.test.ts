import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	ensureProjectStateDirs,
	formatProjectStatePaths,
	formatProjectStateResetResult,
	resetProjectState,
	resolveProjectStatePaths,
	safeProjectStateId,
} from "../src/project-state.js";

function tempDir(prefix = "idu-project-state-"): string {
	return mkdtempSync(join(tmpdir(), prefix));
}

test("safeProjectStateId normalizes names", () => {
	assert.equal(
		safeProjectStateId("Sistema de Mantención"),
		"sistema-de-mantencion",
	);
	assert.equal(safeProjectStateId("../A B__C!!"), "a-b__c");
	assert.equal(safeProjectStateId(""), "project");
});

test("resolveProjectStatePaths creates isolated paths for distinct projects", () => {
	const workspaceRoot = tempDir();
	const first = resolveProjectStatePaths({
		workspaceRoot,
		projectId: "pi-telegram-bridge",
		projectPath: join(workspaceRoot, "project-a"),
	});
	const second = resolveProjectStatePaths({
		workspaceRoot,
		projectId: "Sistema de Mantención",
		projectPath: join(workspaceRoot, "project-b"),
	});
	assert.notEqual(first.stateRoot, second.stateRoot);
	assert.equal(first.labDbPath, join(first.stateRoot, "lab.db"));
	assert.equal(first.reportsDir, join(first.stateRoot, "reports"));
	assert.equal(first.taskQueuePath, join(first.stateRoot, "tasks.jsonl"));
	assert.equal(
		first.sessionStatePath,
		join(first.stateRoot, "idu-session-state.json"),
	);
	assert.equal(second.projectId, "sistema-de-mantencion");
	rmSync(workspaceRoot, { recursive: true, force: true });
});

test("ensureProjectStateDirs creates state directories without touching project code", () => {
	const root = tempDir();
	const workspaceRoot = join(root, "workspace");
	const projectPath = join(root, "project");
	const paths = resolveProjectStatePaths({
		workspaceRoot,
		projectId: "app",
		projectPath,
	});
	ensureProjectStateDirs(paths);
	assert.equal(existsSync(paths.stateRoot), true);
	assert.equal(existsSync(paths.reportsDir), true);
	assert.equal(existsSync(paths.agentLabReportsDir), true);
	assert.equal(existsSync(paths.semanticAuditDir), true);
	assert.equal(existsSync(projectPath), false);
	rmSync(root, { recursive: true, force: true });
});

test("resetProjectState clears isolated stateRoot without deleting repo", () => {
	const root = tempDir();
	const workspaceRoot = join(root, "workspace");
	const projectPath = join(root, "project");
	mkdirSync(projectPath, { recursive: true });
	writeFileSync(join(projectPath, "app.ts"), "repo", "utf8");
	const paths = resolveProjectStatePaths({
		workspaceRoot,
		projectId: "app",
		projectPath,
	});
	ensureProjectStateDirs(paths);
	writeFileSync(join(paths.stateRoot, "master-plan.json"), "{}", "utf8");
	writeFileSync(join(paths.reportsDir, "old.json"), "{}", "utf8");

	const result = resetProjectState(paths);

	assert.equal(existsSync(paths.stateRoot), true);
	assert.deepEqual(readdirSync(paths.stateRoot), []);
	assert.equal(existsSync(join(projectPath, "app.ts")), true);
	assert.deepEqual(
		result.deletedEntries.sort(),
		[
			"master-plan.json",
			"reports",
			"semantic-audit",
			"workspaces",
			"agentlabs",
		].sort(),
	);
	assert.match(formatProjectStateResetResult(result), /StateRoot limpiado/u);
	rmSync(root, { recursive: true, force: true });
});

test("resetProjectState refuses stateRoot inside real repo", () => {
	const root = tempDir();
	const projectPath = join(root, "project");
	const paths = resolveProjectStatePaths({
		workspaceRoot: projectPath,
		projectId: "app",
		projectPath,
	});
	assert.throws(() => resetProjectState(paths), /repo real/u);
	rmSync(root, { recursive: true, force: true });
});

test("formatProjectStatePaths shows core paths", () => {
	const paths = resolveProjectStatePaths({
		workspaceRoot: "C:/workspace",
		projectId: "demo",
		projectPath: "C:/demo",
	});
	const text = formatProjectStatePaths(paths);
	assert.match(text, /Project state/u);
	assert.match(text, /labDbPath/u);
	assert.match(text, /reportsDir/u);
});

test("project state paths stay under workspace root", () => {
	const workspaceRoot = tempDir();
	const paths = resolveProjectStatePaths({
		workspaceRoot,
		projectId: "../../escape",
		projectPath: workspaceRoot,
	});
	writeFileSync(join(workspaceRoot, "marker.txt"), "ok", "utf8");
	assert.ok(paths.stateRoot.startsWith(join(workspaceRoot, "projects")));
	rmSync(workspaceRoot, { recursive: true, force: true });
});

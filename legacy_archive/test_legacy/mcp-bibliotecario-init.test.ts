import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	callIduMcpTool,
	type IduMcpProjectResolution,
} from "../src/mcp-server.js";
import type { CliRuntime } from "../src/cli.js";

function resolution(
	stateRoot: string,
	projectId = "mcp-bibliotecario-project",
): IduMcpProjectResolution {
	return {
		status: "registered_project",
		projectId,
		projectPath: join(stateRoot, "repo"),
		stateRoot,
		recommendedNext: "ready",
		safeNotes: [],
		errors: [],
	};
}

function runtime(
	stateRoot: string,
	projectId = "mcp-bibliotecario-project",
): CliRuntime {
	return {
		projectId,
		projectPath: join(stateRoot, "repo"),
		workspaceRoot: stateRoot,
		labDbPath: join(stateRoot, "lab.db"),
	} as unknown as CliRuntime;
}

test("idu_bibliotecario_init initializes lab.db and returns the active project id", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "mcp-bibliotecario-init-"));
	try {
		const result = await callIduMcpTool(
			"idu_bibliotecario_init",
			{},
			{
				projectResolver: () => resolution(stateRoot),
				runtimeFactory: () => runtime(stateRoot),
			},
		);

		assert.equal(result.ok, true, result.errors.join("\n"));
		assert.equal(result.projectId, "mcp-bibliotecario-project");
		assert.equal(result.data.activeProjectId, "mcp-bibliotecario-project");
		assert.equal((result.data.init as { ok?: boolean }).ok, true);
		assert.equal(existsSync(join(stateRoot, "lab.db")), true);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("idu_bibliotecario_init rejects an empty active project id", async () => {
	const stateRoot = mkdtempSync(
		join(tmpdir(), "mcp-bibliotecario-empty-project-"),
	);
	try {
		const result = await callIduMcpTool(
			"idu_bibliotecario_init",
			{},
			{
				projectResolver: () => resolution(stateRoot, ""),
				runtimeFactory: () => runtime(stateRoot, ""),
			},
		);

		assert.equal(result.ok, false);
		assert.match(result.errors.join("\n"), /project id/i);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

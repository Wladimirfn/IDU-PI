import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	callIduMcpTool,
	type IduMcpProjectResolution,
} from "../src/mcp-server.js";
import type { CliRuntime } from "../src/cli.js";
import { formatModelInvocationStatus } from "../src/cli-model-invocation-status.js";

function resolution(
	stateRoot: string,
	projectId = "mcp-model-status-project",
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
	projectId = "mcp-model-status-project",
): CliRuntime {
	return {
		projectId,
		projectPath: join(stateRoot, "repo"),
		workspaceRoot: stateRoot,
		labDbPath: join(stateRoot, "lab.db"),
		formatModelInvocationStatus,
	} as unknown as CliRuntime;
}

test("idu_model_invocation_status returns formatted output and the resolved labDbPath", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "mcp-model-status-"));
	try {
		const labDbPath = join(stateRoot, "lab.db");
		const result = await callIduMcpTool(
			"idu_model_invocation_status",
			{},
			{
				projectResolver: () => resolution(stateRoot),
				runtimeFactory: () => runtime(stateRoot),
			},
		);

		assert.equal(result.ok, true, result.errors.join("\n"));
		assert.equal(result.data.labDbPath, labDbPath);
		assert.match(String(result.data.output), /Model Invocation Status/u);
		assert.match(String(result.data.output), /no invocations yet/u);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("idu_model_invocation_status rejects an empty active project id", async () => {
	const stateRoot = mkdtempSync(
		join(tmpdir(), "mcp-model-status-empty-project-"),
	);
	try {
		const result = await callIduMcpTool(
			"idu_model_invocation_status",
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

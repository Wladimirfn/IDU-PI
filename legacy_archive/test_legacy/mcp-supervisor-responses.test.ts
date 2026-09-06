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
import {
	flushSupervisorResponseHistory,
	recordSupervisorResponseDeferred,
} from "../src/supervisor-response-history.js";

function resolution(stateRoot: string): IduMcpProjectResolution {
	return {
		status: "registered_project",
		projectId: "mcp-supervisor-responses-project",
		projectPath: join(stateRoot, "repo"),
		stateRoot,
		recommendedNext: "ready",
		safeNotes: [],
		errors: [],
	};
}

function runtime(stateRoot: string): CliRuntime {
	return {
		projectId: "mcp-supervisor-responses-project",
		projectPath: join(stateRoot, "repo"),
		workspaceRoot: stateRoot,
		labDbPath: join(stateRoot, "lab.db"),
	} as unknown as CliRuntime;
}

const optionsFor = (stateRoot: string) => ({
	projectResolver: () => resolution(stateRoot),
	runtimeFactory: () => runtime(stateRoot),
});

async function seedEntry(stateRoot: string, i: number): Promise<void> {
	recordSupervisorResponseDeferred(stateRoot, {
		stateRoot,
		role: "supervisor-main",
		question: `mcp-question-${i}`,
		result: {
			ok: true,
			role: "supervisor-main",
			response: `mcp-response-${i}`,
			model: "openai/gpt-5",
			provider: "openai",
			promptChars: 100,
			elapsedMs: 25,
		},
	});
}

test("mcp idu_supervisor_responses returns an empty entries array on a fresh stateRoot", async () => {
	const stateRoot = mkdtempSync(
		join(tmpdir(), "mcp-supervisor-responses-empty-"),
	);
	try {
		const result = await callIduMcpTool(
			"idu_supervisor_responses",
			{},
			optionsFor(stateRoot),
		);
		assert.equal(result.ok, true, result.errors.join("\n"));
		assert.equal(result.tool, "idu_supervisor_responses");
		assert.equal(result.data.returnedCount, 0);
		assert.deepEqual(result.data.entries, []);
		assert.equal(result.data.limit, 10);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("mcp idu_supervisor_responses returns persisted entries after record+flush", async () => {
	const stateRoot = mkdtempSync(
		join(tmpdir(), "mcp-supervisor-responses-seeded-"),
	);
	try {
		await seedEntry(stateRoot, 1);
		await seedEntry(stateRoot, 2);
		await flushSupervisorResponseHistory(stateRoot);

		const result = await callIduMcpTool(
			"idu_supervisor_responses",
			{ limit: 5 },
			optionsFor(stateRoot),
		);
		assert.equal(result.ok, true, result.errors.join("\n"));
		assert.equal(result.data.returnedCount, 2);
		assert.equal(result.data.limit, 5);
		const entries = result.data.entries as Array<{
			role: string;
			status: string;
			questionSummary: string;
		}>;
		assert.equal(entries.length, 2);
		assert.equal(entries[0]?.role, "supervisor-main");
		assert.equal(entries[0]?.status, "success");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("mcp idu_supervisor_responses rejects a non-positive limit", async () => {
	const stateRoot = mkdtempSync(
		join(tmpdir(), "mcp-supervisor-responses-bad-limit-"),
	);
	try {
		const result = await callIduMcpTool(
			"idu_supervisor_responses",
			{ limit: 0 },
			optionsFor(stateRoot),
		);
		assert.equal(result.ok, false);
		assert.match(result.errors.join("\n"), /positive integer/u);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("mcp idu_supervisor_responses honours --limit trimming to the requested page size", async () => {
	const stateRoot = mkdtempSync(
		join(tmpdir(), "mcp-supervisor-responses-limit-"),
	);
	try {
		for (let i = 0; i < 5; i++) await seedEntry(stateRoot, i);
		await flushSupervisorResponseHistory(stateRoot);

		const result = await callIduMcpTool(
			"idu_supervisor_responses",
			{ limit: 2 },
			optionsFor(stateRoot),
		);
		assert.equal(result.ok, true, result.errors.join("\n"));
		assert.equal(result.data.returnedCount, 2);
		assert.equal(result.data.limit, 2);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});
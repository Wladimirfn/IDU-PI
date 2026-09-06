import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	callIduMcpTool,
	type IduMcpProjectResolution,
} from "../src/mcp-server.js";
import type { CliRuntime } from "../src/cli.js";
import { applyMigrations } from "../src/lab-db/migrations/runner.js";
import { LabDbRepository } from "../src/lab-db-repository.js";

function resolution(stateRoot: string): IduMcpProjectResolution {
	return {
		status: "registered_project",
		projectId: "mcp-skill-rating-project",
		projectPath: join(stateRoot, "repo"),
		stateRoot,
		recommendedNext: "ready",
		safeNotes: [],
		errors: [],
	};
}

function runtime(stateRoot: string): CliRuntime {
	return {
		projectId: "mcp-skill-rating-project",
		projectPath: join(stateRoot, "repo"),
		workspaceRoot: stateRoot,
		labDbPath: join(stateRoot, "lab.db"),
	} as unknown as CliRuntime;
}

function seedProposal(stateRoot: string): void {
	const dbPath = join(stateRoot, "lab.db");
	applyMigrations(dbPath);
	const repo = new LabDbRepository(dbPath);
	repo.appendProposal({
		id: "prop-1",
		kind: "skill-improvement",
		payload: '{"skillId":"skill-1"}',
		status: "proposed",
	});
}

function readScore(stateRoot: string): number | null {
	const raw = execFileSync(
		"sqlite3",
		[
			"-json",
			join(stateRoot, "lab.db"),
			"SELECT score FROM bibliotecario_proposals WHERE id = 'prop-1';",
		],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	).trim();
	const rows = JSON.parse(raw) as Array<{ score: number | null }>;
	return rows[0]?.score ?? null;
}

test("idu_skill_rating passes args.score to the CLI wrapper and returns formatted output", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "mcp-skill-rating-"));
	try {
		seedProposal(stateRoot);
		const result = await callIduMcpTool(
			"idu_skill_rating",
			{ proposalId: "prop-1", score: 7 },
			{
				projectResolver: () => resolution(stateRoot),
				runtimeFactory: () => runtime(stateRoot),
			},
		);

		assert.equal(result.ok, true, result.errors.join("\n"));
		assert.equal(result.data.proposalId, "prop-1");
		assert.equal(result.data.score, 7);
		assert.match(String(result.data.output), /recommendation: promote/u);
		assert.equal(readScore(stateRoot), 7);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("idu_skill_rating rejects score 11 before recording", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "mcp-skill-rating-invalid-"));
	try {
		seedProposal(stateRoot);
		const result = await callIduMcpTool(
			"idu_skill_rating",
			{ proposalId: "prop-1", score: 11 },
			{
				projectResolver: () => resolution(stateRoot),
				runtimeFactory: () => runtime(stateRoot),
			},
		);

		assert.equal(result.ok, false);
		assert.match(result.errors.join("\n"), /0\.\.10/u);
		assert.equal(readScore(stateRoot), null);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

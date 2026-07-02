// PR3 (Fix 2) — MCP handler envelope + CLI formatter contract tests.
// Pin the contract that handleAgentLabReviewRun surfaces a dispatched
// sentinel as {runId, status: "dispatched"} and handleAgentLabReviewStatus
// forwards the resolver's by-runId / mtime-max resolution into the
// envelope data.

import assert from "node:assert/strict";
import { mkdirSync, renameSync, rmSync, utimesSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import {
	handleAgentLabReviewRun as mcpRun,
	handleAgentLabReviewStatus as mcpStatus,
} from "../../../src/mcp/agentlab/handlers.js";
import { handleAgentLabReviewRun as cliRun } from "../../../src/cli/agentlab/handlers.js";
import type { IduMcpProjectResolution } from "../../../src/mcp-server.js";
import type { CliRuntime } from "../../../src/cli.js";
import type { AgentLabReviewRunResult, AgentLabReviewStatus } from "../../../src/agentlab-review-runner.js";
import type { JsonObject } from "../../../src/mcp/_shared/index.js";
import type { IduMcpToolName, IduMcpToolResult } from "../../../src/mcp/_shared/index.js";

function tmpReportsDir(): string {
	const base = mkdtempSync(join(tmpdir(), "pr3-mcp-"));
	const reportsPath = join(base, "reports");
	mkdirSync(reportsPath, { recursive: true });
	return reportsPath;
}

function runDir(reportsPath: string): string {
	return resolve(join(reportsPath, "..", "agentlabs", "runs"));
}

function dispatchedSummary(runId: string, dispatchPath: string): AgentLabReviewRunResult {
	return {
		generatedAt: new Date().toISOString(),
		sourceRequestFile: "dispatch",
		warning: "Revisión AgentLab. No aplica cambios." as const,
		projectId: "pi-telegram-bridge",
		runs: [],
		consolidatedSummary: `AgentLab review run dispatched: ${runId}`,
		consolidatedFindings: [],
		recommendedNext: `Poll agentlab_review_status ${runId}`,
		requiresHumanApproval: false,
		safeNotes: [`runId: ${runId}`, `dispatchPath: ${dispatchPath}`, `Poll status with: agentlab_review_status ${runId}`],
		path: dispatchPath,
	};
}

function completedSummary(): AgentLabReviewRunResult {
	return {
		generatedAt: "2026-05-25T10:01:00.000Z",
		sourceRequestFile: "x",
		warning: "Revisión AgentLab. No aplica cambios." as const,
		projectId: "pi-telegram-bridge",
		runs: [{
			requestId: "r1", specialty: "security" as const, status: "completed" as const,
			commandsExecuted: [], rawSummary: "ok",
			contractValidation: { valid: true, errors: [] },
			findings: [], recommendations: [], testsSuggested: [],
			requiresHumanApproval: false,
		}],
		consolidatedSummary: "completed",
		consolidatedFindings: [],
		recommendedNext: "none",
		requiresHumanApproval: false,
		safeNotes: [],
	};
}

const RESOLUTION: IduMcpProjectResolution = {
	status: "registered_project", projectId: "pi-telegram-bridge", projectPath: "/fake",
	stateRoot: "/fake/state", safeNotes: [], errors: [],
};

function makeRuntime(
	reportsPath: string,
	overrides: Partial<{
		agentLabReviewRun: (s: string) => Promise<AgentLabReviewRunResult>;
		agentLabReviewStatus: (s: string) => AgentLabReviewStatus;
	}> = {},
): CliRuntime {
	return {
		workspaceRoot: reportsPath,
		projectId: "pi-telegram-bridge",
		projectPath: "/fake",
		agentLabReviewRun: overrides.agentLabReviewRun ?? (async () => completedSummary()),
		agentLabReviewStatus: overrides.agentLabReviewStatus ?? (() => ({
			valid: true, name: "completed", path: "/fake/status.json", result: completedSummary(), errors: [],
		})),
	} as unknown as CliRuntime;
}

function writeDispatch(reportsPath: string, runId: string): string {
	const p = join(runDir(reportsPath), `${runId}.dispatch.json`);
	mkdirSync(runDir(reportsPath), { recursive: true });
	writeFileSync(p, `${JSON.stringify({ runId, status: "dispatched", startedAt: new Date().toISOString() })}\n`, "utf8");
	return p;
}

function writeRunArtifact(reportsPath: string, runId: string, summary: AgentLabReviewRunResult): string {
	const final = join(runDir(reportsPath), `${runId}.json`);
	mkdirSync(runDir(reportsPath), { recursive: true });
	const tmp = `${final}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(summary)}\n`, "utf8");
	renameSync(tmp, final);
	return final;
}

test("PR3 MCP envelope returns dispatched shape immediately", async () => {
	const reportsPath = tmpReportsDir();
	const runId = `run-${Math.floor(Date.now() / 1000)}-abc`;
	const dispatchPath = writeDispatch(reportsPath, runId);
	const runtime = makeRuntime(reportsPath, {
		agentLabReviewRun: async () => dispatchedSummary(runId, dispatchPath),
	});
	const result: IduMcpToolResult = await mcpRun(
		"idu_agentlab_review_run" as IduMcpToolName, { selector: "latest" } as JsonObject, runtime, RESOLUTION,
	);
	const data = result.data as { runId?: string; status?: string; dispatchPath?: string };
	assert.ok(data);
	assert.equal(data.runId, runId);
	assert.equal(data.status, "dispatched");
	assert.equal(data.dispatchPath, dispatchPath);
	assert.ok(result.ok);
	assert.match(result.summary, /dispatched/u);
	assert.ok(result.safeNotes.some((n) => n.includes("agentlab_review_status")));
});

test("PR3 MCP agentlab_review_status resolves by runId accurately", async () => {
	const reportsPath = tmpReportsDir();
	const runId = `run-${Math.floor(Date.now() / 1000)}-pin`;
	const dispatchPath = writeDispatch(reportsPath, runId);
	const summary = completedSummary();
	const runPath = writeRunArtifact(reportsPath, runId, summary);
	rmSync(dispatchPath, { force: true });
	const runtime = makeRuntime(reportsPath, {
		agentLabReviewRun: async () => dispatchedSummary(runId, dispatchPath),
		agentLabReviewStatus: (selector: string) => {
			if (selector === runId) return { valid: true, name: basename(runPath), path: runPath, result: summary, errors: [] };
			return { valid: false, name: "missing", path: "/missing", errors: ["unknown selector"] };
		},
	});
	const result = await mcpStatus(
		"idu_agentlab_review_status" as IduMcpToolName, { selector: runId } as JsonObject, runtime, RESOLUTION,
	);
	const data = result.data as { status?: AgentLabReviewStatus };
	assert.ok(data.status);
	assert.ok(result.ok);
	assert.equal(data.status.path, runPath);
	assert.equal(data.status.name, `${runId}.json`);
	assert.equal(data.status.result?.runs?.[0]?.status, "completed");
});

test("PR3 MCP agentlab_review_status latest resolves by mtime-max", async () => {
	const reportsPath = tmpReportsDir();
	const runIdOld = `run-${Math.floor(Date.now() / 1000) - 100}-old`;
	const oldSummary = completedSummary();
	oldSummary.generatedAt = "2026-05-25T09:00:00.000Z";
	const oldPath = writeRunArtifact(reportsPath, runIdOld, oldSummary);
	utimesSync(oldPath, new Date("2026-05-25T09:00:00.000Z"), new Date("2026-05-25T09:00:00.000Z"));
	const runIdNew = `run-${Math.floor(Date.now() / 1000)}-new`;
	const newDispatchPath = writeDispatch(reportsPath, runIdNew);
	utimesSync(newDispatchPath, new Date("2026-05-25T10:00:00.000Z"), new Date("2026-05-25T10:00:00.000Z"));
	const runtime = makeRuntime(reportsPath, {
		agentLabReviewRun: async () => dispatchedSummary(runIdNew, newDispatchPath),
		agentLabReviewStatus: (selector: string) => {
			if (selector === "latest") return { valid: true, name: basename(newDispatchPath), path: newDispatchPath, errors: [] };
			if (selector === runIdOld) return { valid: true, name: basename(oldPath), path: oldPath, result: oldSummary, errors: [] };
			if (selector === runIdNew) return { valid: true, name: basename(newDispatchPath), path: newDispatchPath, errors: [] };
			return { valid: false, name: "missing", path: "/missing", errors: ["unknown selector"] };
		},
	});
	const latestResult = await mcpStatus(
		"idu_agentlab_review_status" as IduMcpToolName, { selector: "latest" } as JsonObject, runtime, RESOLUTION,
	);
	const latestData = latestResult.data as { status?: AgentLabReviewStatus };
	assert.ok(latestData.status);
	assert.equal(latestData.status.path, newDispatchPath, "latest must resolve to the in-flight newer dispatch path (mtime-max)");
	assert.notEqual(latestData.status.path, oldPath, "latest must NOT mix generations with the older completed run file");
	const pinnedOldResult = await mcpStatus(
		"idu_agentlab_review_status" as IduMcpToolName, { selector: runIdOld } as JsonObject, runtime, RESOLUTION,
	);
	const pinnedOldData = pinnedOldResult.data as { status?: AgentLabReviewStatus };
	assert.ok(pinnedOldData.status);
	assert.equal(pinnedOldData.status.path, oldPath);
	assert.equal(pinnedOldData.status.name, `${runIdOld}.json`);
});

test("PR3 CLI formatter renders dispatched sentinel as one-liner ack", async () => {
	const reportsPath = tmpReportsDir();
	const runId = `run-${Math.floor(Date.now() / 1000)}-fmt`;
	const dispatchPath = writeDispatch(reportsPath, runId);
	const runtime = makeRuntime(reportsPath, {
		agentLabReviewRun: async () => dispatchedSummary(runId, dispatchPath),
	});
	const result = await cliRun(runtime, ["latest"]);
	assert.equal(result.exitCode, 0);
	assert.match(result.stdout, new RegExp(`AgentLab review run dispatched: ${runId}\\b`, "u"));
	assert.match(result.stdout, /agentlab_review_status \S+/u);
});
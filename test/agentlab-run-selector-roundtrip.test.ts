import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
	dispatchAgentLabReviewRun,
	getAgentLabReviewStatus,
	writeAgentLabReviewRunAtomic,
	type AgentLabReviewRunResult,
} from "../src/agentlab-review-runner.js";
import type { AgentLabSpecialty } from "../src/agentlab-supervisor-contract.js";

// REQ-FRS-3: roundtrip E2E acceptance. dispatch → getStatus(runId) → valid:true.
// Bug #1 (run selector drift): before this change, getStatus(runId) rejected
// run-<unix>-<hex> filenames because the parser only knew current.json and
// the legacy agentlab-review-run-*.json shape. The dispatcher has always
// minted run-<unix>-<hex> filenames, so the post-dispatch status lookup was
// broken. This test pins the fix.

function root(): string {
	return mkdtempSync(join(tmpdir(), "agentlab-run-selector-roundtrip-"));
}

function reportsPath(): string {
	const dir = root();
	const reports = join(dir, "reports");
	mkdirSync(reports, { recursive: true });
	// dispatchAgentLabReviewRun computes runDir as resolve(reportsPath)/../agentlabs/runs.
	// Pre-create it so the atomic write does not race with the test's own mkdir.
	mkdirSync(resolve(reports, "..", "agentlabs", "runs"), { recursive: true });
	return reports;
}

function dispatchInput(reports: string) {
	return {
		reportsPath: reports,
		projectId: "pi-telegram-bridge",
		projectPath: root(),
		maxMinutes: 1,
		requestId: "agentlab-pi-telegram-bridge-roundtrip-01",
	};
}

function completedRunSummary(): AgentLabReviewRunResult {
	return {
		generatedAt: "2026-07-03T10:00:00.000Z",
		sourceRequestFile: "agentlab-review-request-20260703-100000.json",
		warning: "Revisión AgentLab. No aplica cambios." as const,
		projectId: "pi-telegram-bridge",
		runs: [
			{
				requestId: "agentlab-pi-telegram-bridge-roundtrip-01",
				specialty: "security" as AgentLabSpecialty,
				status: "completed" as const,
				commandsExecuted: [],
				rawSummary: "ok",
				contractValidation: { valid: true, errors: [] },
				findings: [],
				recommendations: [],
				testsSuggested: [],
				requiresHumanApproval: false,
			},
		],
		consolidatedSummary: "completed",
		consolidatedFindings: [],
		recommendedNext: "none",
		requiresHumanApproval: false,
		safeNotes: [],
	};
}

test("roundtrip: dispatchAgentLabReviewRun runId resolves through getAgentLabReviewStatus with valid:true", () => {
	const reports = reportsPath();
	const input = dispatchInput(reports);

	// 1. Dispatch — mints run-<unix>-<hex6>, writes <runId>.dispatch.json.
	const dispatch = dispatchAgentLabReviewRun(input, "security");
	assert.match(
		dispatch.runId,
		/^run-\d{10}-[a-z0-9]+$/u,
		`dispatch must mint a runId of the form run-<unix>-<hex>; got ${dispatch.runId}`,
	);
	assert.ok(
		existsSync(dispatch.dispatchPath),
		`dispatch placeholder must exist on disk: ${dispatch.dispatchPath}`,
	);

	// 2. Land the completed run file under <runId>.json (no runLab pipeline
	// in this test — we write the artifact directly to keep the roundtrip
	// hermetic and avoid AgentLab execution).
	const runFile = writeAgentLabReviewRunAtomic(
		dispatch.runId,
		input.reportsPath,
		completedRunSummary(),
	);
	assert.ok(
		existsSync(runFile),
		`run artifact must exist on disk: ${runFile}`,
	);

	// 3. Pin the contract: getAgentLabReviewStatus(runId) MUST return valid:true.
	// Before this change, the parser rejected run-<unix>-<hex6>.json so this
	// assertion failed with valid:false and an error about filename shape.
	const status = getAgentLabReviewStatus(dispatch.runId, input.reportsPath);

	assert.equal(
		status.valid,
		true,
		`getAgentLabReviewStatus(${dispatch.runId}) must be valid:true after dispatch + run-file write; got valid:${status.valid} errors=${JSON.stringify(status.errors)}`,
	);
	assert.equal(status.errors.length, 0);
	assert.equal(status.name, `${dispatch.runId}.json`);
});

test("roundtrip: dispatch runId resolves whether passed bare or with .json suffix", () => {
	const reports = reportsPath();
	const input = dispatchInput(reports);

	const dispatch = dispatchAgentLabReviewRun(input, "security");
	writeAgentLabReviewRunAtomic(
		dispatch.runId,
		input.reportsPath,
		completedRunSummary(),
	);

	// Bare runId (the shape returned by dispatchAgentLabReviewRun.runId).
	const bare = getAgentLabReviewStatus(dispatch.runId, input.reportsPath);
	assert.equal(
		bare.valid,
		true,
		`bare runId must resolve valid:true; got valid:${bare.valid} errors=${JSON.stringify(bare.errors)}`,
	);

	// Same runId with the .json suffix — the parser must strip and accept.
	const withSuffix = getAgentLabReviewStatus(
		`${dispatch.runId}.json`,
		input.reportsPath,
	);
	assert.equal(
		withSuffix.valid,
		true,
		`<runId>.json must resolve valid:true; got valid:${withSuffix.valid} errors=${JSON.stringify(withSuffix.errors)}`,
	);
});
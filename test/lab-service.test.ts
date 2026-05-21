import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentProfile } from "../src/config.js";
import {
	formatLabRunResultLines,
	labProfilesForIndexes,
} from "../src/lab-service.js";
import type { LabRunRecord } from "../src/lab-reports.js";

const profiles: AgentProfile[] = [
	{ id: "default", label: "Pi default", provider: "pi", piArgs: [] },
	{ id: "codex", label: "GPT Codex", provider: "pi", piArgs: [] },
	{ id: "spark", label: "Spark", provider: "pi", piArgs: [] },
];

function labRecord(patch: Partial<LabRunRecord> = {}): LabRunRecord {
	return {
		id: "run-1",
		projectId: "project",
		projectPath: "C:/project",
		agentId: "codex",
		agentLabel: "GPT Codex",
		workspace: "C:/workspace",
		durationLabel: "quick",
		durationMs: 300_000,
		status: "completed",
		summary: "ok",
		startedAt: "2026-05-20T00:00:00.000Z",
		finishedAt: "2026-05-20T00:00:01.000Z",
		...patch,
	};
}

test("labProfilesForIndexes excludes the default profile", () => {
	assert.deepEqual(
		labProfilesForIndexes(profiles, [1, 2, 3]).map((profile) => profile.id),
		["codex", "spark"],
	);
});

test("formatLabRunResultLines preserves visible lab result format", () => {
	const lines = formatLabRunResultLines(
		[profiles[1]],
		[
			{
				status: "fulfilled",
				value: labRecord({
					id: "abc-codex",
					rawOutput: "[tool:bash] iniciando...\n\nTests OK",
				}),
			},
		],
	);

	assert.deepEqual(lines, ["GPT Codex: completed · abc-codex\n\nTests OK"]);
});

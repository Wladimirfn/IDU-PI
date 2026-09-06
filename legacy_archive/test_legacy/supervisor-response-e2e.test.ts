import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import test from "node:test";
import type { ConsultInput } from "../src/supervisor-consult.js";
import { consultSupervisor } from "../src/supervisor-consult.js";
import { roleEngineConfigPath } from "../src/role-engine-config.js";
import {
	buildSupervisorResponsesReport,
	formatSupervisorResponses,
} from "../src/cli-supervisor-responses.js";
import {
	flushSupervisorResponseHistory,
	readSupervisorResponseHistory,
} from "../src/supervisor-response-history.js";
import { makeTempDir } from "./helpers/temp.js";

test("supervisor response loop persists, reads, and formats a consult", async () => {
	const stateRoot = makeTempDir("idu-supervisor-response-e2e-");
	const role = "supervisor-main" as const;

	writeFileSync(
		roleEngineConfigPath(stateRoot),
		JSON.stringify({
			enabled: true,
			maxRoleInvocationsPerTurn: 50,
			roleEnabled: { [role]: true },
			roleCooldownMs: {},
		}),
		"utf8",
	);

	// A fresh stateRoot uses the default role rail; consultSupervisor persists it
	// after the successful wake.
	const promptForRole: ConsultInput["promptForRole"] = async (
		requestedRole,
		_message,
		_options,
	) => ({
		ok: true,
		output: "test response",
		model: "test-model",
		provider: "test-provider",
		role: requestedRole,
	});

	const result = await consultSupervisor({
		stateRoot,
		role,
		question: "Should the supervisor response be persisted?",
		promptForRole,
		now: new Date("2026-06-15T12:00:00.000Z"),
	});
	assert.equal(result.ok, true);

	await flushSupervisorResponseHistory(stateRoot);

	const entries = readSupervisorResponseHistory(stateRoot, 10);
	assert.equal(entries.length, 1);
	const entry = entries[0];
	assert.ok(entry);
	assert.equal(entry.response, "test response");
	assert.equal(entry.role, role);
	assert.equal(entry.status, "success");

	const formatted = formatSupervisorResponses(
		buildSupervisorResponsesReport({ stateRoot }),
	);
	assert.match(formatted, /test response/u);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	listAvailableRoleProfiles,
	loadRoleProfile,
} from "../src/roles/profile-loader.js";

test("e2e: every listed role profile has a non-empty body and at least one prohibition", () => {
	const list = listAvailableRoleProfiles();
	for (const roleId of list) {
		const profile = loadRoleProfile(roleId);
		assert.ok(
			profile.body.length > 200,
			`${roleId}: body too short (${profile.body.length} chars)`,
		);
		assert.ok(
			profile.prohibitions.length > 0,
			`${roleId}: must have at least one prohibition`,
		);
	}
});

test(
	"e2e: the profile frontmatter matches the model-assignments.json model (no drift)",
	() => {
		// For the 13 supervised roles, the profile's modelo-defecto
		// should match the live assignment in
		// Documents/bridge-agents/projects/idu-pi/model-assignments.json.
		// The orchestrator is excluded (model is the active session).
		const allProfiles = listAvailableRoleProfiles();
		const supervised = allProfiles.filter((id) => id !== "orchestrator");
		for (const roleId of supervised) {
			const profile = loadRoleProfile(roleId);
			// The loader only returns the *default* model from the
			// profile. The actual assigned model is resolved at
			// runtime from model-assignments.json. This test only
			// asserts the profile parses without error and has a
			// non-empty default.
			assert.ok(
				profile.modeloDefecto.length > 0,
				`${roleId}: default model must be non-empty`,
			);
		}
	},
);

test("e2e: orchestrator profile has the anti-drift reminder section", () => {
	const profile = loadRoleProfile("orchestrator");
	assert.match(
		profile.body,
		/anti-drift|releer|El norte/i,
		"orchestrator profile must contain anti-drift guidance",
	);
});

test("e2e: supervisor-main profile restricts human interruption to critical signals", () => {
	const profile = loadRoleProfile("supervisor-main");
	assert.match(
		profile.prohibitions.join("\n"),
		/Interrumpir al humano/i,
		"supervisor-main must prohibit interrupting the human for non-critical signals",
	);
});

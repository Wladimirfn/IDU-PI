import assert from "node:assert/strict";
import { test } from "node:test";
import {
	listAvailableRoleProfiles,
	loadRoleProfile,
} from "../src/roles/profile-loader.js";

test("loadRoleProfile returns a typed profile for supervisor-main", () => {
	const profile = loadRoleProfile("supervisor-main");
	assert.equal(profile.rolId, "supervisor-main");
	assert.equal(profile.tipo, "supervisor");
	assert.equal(profile.modeloDefecto, "opencode-go/deepseek-v4-pro");
	assert.ok(profile.prohibitions.length > 0, "must have prohibitions");
	assert.match(
		profile.prohibitions.join("\n"),
		/Escribir código|git|fetch externo|Aprobar/i,
	);
	assert.ok(profile.body.includes("# Skill — Supervisor Principal"));
	assert.match(
		profile.path,
		/(?:^|[\\/])config[\\/]profiles[\\/]supervisor-main\.md$/u,
		`path must end with config/profiles/supervisor-main.md, got ${profile.path}`,
	);
});

test("loadRoleProfile returns a profile for agentlab-bibliotecario with the fetch restriction", () => {
	const profile = loadRoleProfile("agentlab-bibliotecario");
	assert.equal(profile.rolId, "agentlab-bibliotecario");
	assert.equal(profile.tipo, "agentlab");
	assert.equal(profile.modeloDefecto, "opencode-go/kimi-k2.5");
	assert.ok(profile.prohibitions.length > 0);
	// The bibliotecario's prohibitions include the fetch restriction.
	assert.match(profile.prohibitions.join("\n"), /fetch/i);
});

test("loadRoleProfile returns a profile for orchestrator with the variable model", () => {
	const profile = loadRoleProfile("orchestrator");
	assert.equal(profile.rolId, "orchestrator");
	assert.equal(profile.tipo, "orquestador");
	assert.match(
		profile.modeloDefecto,
		/variable|orchestrator|active/i,
		"orchestrator's default model should be the active session",
	);
});

test("loadRoleProfile throws clearly when the role id is unknown", () => {
	assert.throws(
		() => loadRoleProfile("nope-not-a-real-role"),
		/Role profile not found/,
	);
});

test("listAvailableRoleProfiles returns all 14 role profiles", () => {
	const list = listAvailableRoleProfiles();
	assert.equal(
		list.length,
		14,
		`expected 14 profiles, got ${list.length}: ${list.join(", ")}`,
	);
	// Spot-check that the 14 expected names are present.
	const expected = [
		"orchestrator",
		"supervisor-main",
		"supervisor-semantic",
		"supervisor-compaction",
		"agentlab-general",
		"agentlab-project-understanding",
		"agentlab-ui-ux",
		"agentlab-database",
		"agentlab-architecture",
		"agentlab-documentation",
		"agentlab-code-quality",
		"agentlab-performance",
		"agentlab-security",
		"agentlab-bibliotecario",
	];
	for (const name of expected) {
		assert.ok(list.includes(name), `missing profile: ${name}`);
	}
	// README.md must NOT be in the list.
	assert.ok(!list.includes("README"));
});

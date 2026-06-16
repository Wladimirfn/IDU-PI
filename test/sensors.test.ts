import assert from "node:assert/strict";
import { test } from "node:test";
import { matchSensors, SENSORS, type SensorMatch } from "../src/sensors.js";

test("SENSORS is non-empty and each entry has a role, pattern, description", () => {
	assert.ok(SENSORS.length > 0);
	for (const sensor of SENSORS) {
		assert.ok(typeof sensor.role === "string" && sensor.role.length > 0);
		assert.ok(sensor.pattern instanceof RegExp);
		assert.ok(
			typeof sensor.description === "string" && sensor.description.length > 0,
		);
	}
});

test("matchSensors returns empty list for empty input", () => {
	assert.deepEqual(matchSensors([]), []);
});

test("matchSensors matches UI/UX file extensions", () => {
	const matches = matchSensors(["src/components/Button.tsx", "styles.css"]);
	assert.equal(matches.length, 2);
	assert.equal(matches[0]?.role, "agentlab-ui-ux");
	assert.equal(matches[1]?.role, "agentlab-ui-ux");
	assert.equal(matches[0]?.file, "src/components/Button.tsx");
});

test("matchSensors matches auth/security file patterns", () => {
	const matches = matchSensors([
		"src/auth/login.ts",
		"src/services/token-service.ts",
		"src/api/session-handler.ts",
	]);
	assert.equal(matches.length, 3);
	for (const m of matches) {
		assert.equal(m.role, "agentlab-security");
	}
});

test("matchSensors matches DB/schema file patterns", () => {
	const matches = matchSensors([
		"src/lab-db/migrations/0001_init.sql",
		"db/schema.sql",
	]);
	assert.equal(matches.length, 2);
	for (const m of matches) {
		assert.equal(m.role, "agentlab-database");
	}
});

test("matchSensors matches architecture file extensions", () => {
	const matches = matchSensors([
		"src/cli.ts",
		"src/agent-router.ts",
		"src/index.js",
	]);
	assert.equal(matches.length, 3);
	for (const m of matches) {
		assert.equal(m.role, "agentlab-architecture");
	}
});

test("matchSensors matches test file patterns", () => {
	const matches = matchSensors([
		"test/foo.test.ts",
		"test/bar.spec.ts",
		"src/baz.test.tsx",
	]);
	assert.equal(matches.length, 3);
	for (const m of matches) {
		assert.equal(m.role, "agentlab-code-quality");
	}
});

test("matchSensors matches dependency file patterns", () => {
	const matches = matchSensors(["package.json", "pnpm-lock.yaml"]);
	assert.equal(matches.length, 2);
	for (const m of matches) {
		assert.equal(m.role, "agentlab-general");
	}
});

test("matchSensors returns first match per file (no duplicates)", () => {
	const matches = matchSensors([
		"src/auth/login.ts", // security
		"src/components/Button.tsx", // ui-ux
		"src/cli.ts", // architecture
	]);
	assert.equal(matches.length, 3);
	const seen = new Set<string>();
	for (const m of matches) {
		const key = `${m.file}:${m.role}`;
		assert.ok(!seen.has(key), `duplicate match for ${key}`);
		seen.add(key);
	}
});

test("matchSensors returns no match for unknown extensions", () => {
	const matches = matchSensors(["random.xyz", "unknown.foo", "binary.dat"]);
	assert.deepEqual(matches, []);
});

test("matchSensors prioritizes UI/UX over generic TS (first match in SENSORS wins)", () => {
	// .tsx is in both ui-ux (via html|tsx|jsx) and architecture (via ts|js|tsx|jsx)
	// The order in SENSORS should make ui-ux win
	const sensors = SENSORS.findIndex((s) => s.role === "agentlab-ui-ux");
	const archSensors = SENSORS.findIndex(
		(s) => s.role === "agentlab-architecture",
	);
	assert.ok(sensors >= 0 && archSensors >= 0);
	assert.ok(
		sensors < archSensors,
		"ui-ux sensor should come before architecture in SENSORS",
	);
	const matches = matchSensors(["src/Button.tsx"]);
	assert.equal(matches[0]?.role, "agentlab-ui-ux");
});

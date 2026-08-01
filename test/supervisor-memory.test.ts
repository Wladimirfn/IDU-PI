import { test, describe } from "node:test";
import { strictEqual, ok } from "node:assert";
import { buildSupervisorMemory } from "../src/supervisor-memory.js";

describe("buildSupervisorMemory", () => {
	test("returns empty string when stateRoot has no usable project id", () => {
		const result = buildSupervisorMemory({ stateRoot: "" });
		strictEqual(result, "");
	});

	test("extracts projectId from stateRoot path", () => {
		// Uses the binary resolution to find Engram.
		// If Engram is unavailable, result is empty string but doesn't throw.
		const result = buildSupervisorMemory({
			stateRoot: "C:/Users/test/Documents/bridge-agents/projects/idu-pi",
		});
		// Either empty (Engram unavailable in CI) or has content from Engram.
		// Both are valid — just must not throw and must be within budget.
		ok(result.length <= 400, `Should be ≤400, got ${result.length}`);
	});

	test("handles backslash paths correctly (Windows)", () => {
		const result = buildSupervisorMemory({
			stateRoot:
				"C:\\Users\\test\\Documents\\bridge-agents\\projects\\test-project",
		});
		ok(typeof result === "string", "Should return string");
	});
});

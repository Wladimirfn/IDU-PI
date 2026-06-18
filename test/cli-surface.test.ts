/**
 * cli-surface.test.ts — pins the public surface of `src/cli.ts`.
 *
 * Per the cluster-map-cli.md contract (Item 4, PR 1 of 7):
 *   - 20 functions are exported. Pinned via Object.keys(import).
 *   - 9 types are exported. Protected by `npx tsc --noEmit` (the
 *     typecheck is the guard for erased-at-runtime types).
 *
 * This test exists in CI. If a re-export drops or renames a function,
 * the test fails. If a type is renamed, tsc fails (separate gate).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import * as cli from "../src/cli.js";

test("cli.ts public surface: 20 functions", () => {
	const expected = [
		"createCliRuntime",
		"normalizeCliArgs",
		"parseAgentLabRequestCreateArgs",
		"runCliCommand",
		"routeAlertDecisionsForDigest",
		"buildCliSelfMaintenanceReport",
		"createCliTask",
		"approveStructuredTaskById",
		"rejectStructuredTaskById",
		"completeStructuredTaskById",
		"formatCliTaskResult",
		"parseHygieneMigrateArgs",
		"formatHygieneSweepResult",
		"formatHygieneMigrateResult",
		"helpText",
		"runInteractiveHome",
		"dispatchTaskQueuePanelChoice",
		"runTaskQueuePanelTui",
		"__testSelectSearchableMenu",
		"runInteractiveHomeWithQuestion",
	];
	const actual = Object.keys(cli).sort();
	assert.deepEqual(
		actual,
		expected.slice().sort(),
		`cli.ts must export exactly ${expected.length} functions.\n` +
			`Got: ${JSON.stringify(actual)}\n` +
			`Expected: ${JSON.stringify(expected.slice().sort())}`,
	);
});

test("cli.ts: subset of the 20 functions live in dispatch-glue (Q cluster)", () => {
	// PR 1 of Item 4 moves the Q cluster to src/cli/dispatch-glue/.
	// The barrel re-exports preserve the public surface; this test
	// also asserts that the moved functions are STILL resolvable
	// from src/cli.ts (no missing re-exports).
	const dispatchGlueFunctions = [
		"parseHygieneMigrateArgs",
		"formatHygieneSweepResult",
		"formatHygieneMigrateResult",
		"helpText",
	];
	for (const name of dispatchGlueFunctions) {
		assert.ok(
			name in cli,
			`${name} must remain importable from src/cli.ts after the Q extraction`,
		);
		assert.equal(
			typeof (cli as Record<string, unknown>)[name],
			"function",
			`${name} must remain a function after the Q extraction`,
		);
	}
});

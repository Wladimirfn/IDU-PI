/**
 * prompt-helpers tests — T1.6 (RED phase).
 *
 * These tests lock the prompt-helpers contract:
 * - buildStateSummary() returns a deterministic string
 * - The summary includes last 5 advisories, last alerts tick, last lab_write
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStateSummary } from "../../src/roles/prompt-helpers.js";
import type { RoleAdvisory } from "../../src/roles/index.js";
import type { Event } from "../../src/event-bus.js";

// ---------------------------------------------------------------------------
// 10. buildStateSummary returns a deterministic string
// ---------------------------------------------------------------------------

test("prompt-helpers.buildStateSummary() returns a deterministic string of the last 5 advisories + last alerts tick + last lab_write", () => {
	const advisories: RoleAdvisory[] = [
		{
			roleId: "supervisor-main",
			priority: 90,
			ts: "2026-01-01T00:00:00.000Z",
			advisory: "first advisory",
			evidenceRefs: [],
		},
		{
			roleId: "supervisor-main",
			priority: 90,
			ts: "2026-01-01T00:01:00.000Z",
			advisory: "second advisory",
			evidenceRefs: [],
		},
		{
			roleId: "supervisor-main",
			priority: 90,
			ts: "2026-01-01T00:02:00.000Z",
			advisory: "third advisory",
			evidenceRefs: [],
		},
		{
			roleId: "supervisor-main",
			priority: 90,
			ts: "2026-01-01T00:03:00.000Z",
			advisory: "fourth advisory",
			evidenceRefs: [],
		},
		{
			roleId: "supervisor-main",
			priority: 90,
			ts: "2026-01-01T00:04:00.000Z",
			advisory: "fifth advisory",
			evidenceRefs: [],
		},
		{
			roleId: "supervisor-main",
			priority: 90,
			ts: "2026-01-01T00:05:00.000Z",
			advisory: "sixth advisory - excluded by limit",
			evidenceRefs: [],
		},
	];

	const lastAlertsTick: Event = {
		ts: "2026-01-01T00:03:00.000Z",
		kind: "alerts_scheduled_tick",
		projectId: "test",
		payload: { tickId: "tick-123" },
		sourceRef: "alerts-scheduler",
		evidenceRefs: [],
	};

	const lastLabWrite: Event = {
		ts: "2026-01-01T00:02:30.000Z",
		kind: "lab_write",
		projectId: "test",
		payload: { rowId: 42 },
		sourceRef: "lab-db",
		evidenceRefs: [],
	};

	const summary = buildStateSummary(advisories, lastAlertsTick, lastLabWrite);

	assert.ok(typeof summary === "string");
	assert.ok(summary.length > 0, "summary must be non-empty");

	// Check that the last 5 advisories are included (not the first)
	assert.ok(summary.includes("sixth advisory"), "must include sixth advisory");
	assert.ok(summary.includes("fifth advisory"), "must include fifth advisory");
	assert.ok(
		summary.includes("fourth advisory"),
		"must include fourth advisory",
	);
	assert.ok(summary.includes("third advisory"), "must include third advisory");
	assert.ok(
		summary.includes("second advisory"),
		"must include second advisory",
	);
	assert.ok(
		!summary.includes("first advisory"),
		"must NOT include first advisory (excluded by last-5 limit)",
	);

	// Check that the alerts tick is included
	assert.ok(
		summary.includes("2026-01-01T00:03:00.000Z"),
		"must include alerts tick timestamp",
	);

	// Check that the lab_write is included
	assert.ok(
		summary.includes("2026-01-01T00:02:30.000Z"),
		"must include lab_write timestamp",
	);

	// Determinism: calling again with same inputs must produce same output
	const summary2 = buildStateSummary(advisories, lastAlertsTick, lastLabWrite);
	assert.equal(summary, summary2, "buildStateSummary must be deterministic");
});

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// Static imports trigger each module's registerShutdownDrain call.
// The order doesn't matter — registration is idempotent per module.
import "../src/agentlab-effectiveness-events.js";
import "../src/context-quality-events.js";
import "../src/supervisor-activity-events.js";
import "../src/supervisor-response-history.js";
import "../src/usage-events.js";

import {
	drainAllShutdownQueues,
	getRegisteredDrainCount,
	registerShutdownDrain,
} from "../src/graceful-shutdown-registry.js";

/**
 * Baseline captured at module load, after the five static imports above have
 * registered and before any test registers its own drains. The rejection test
 * below registers two extra ones permanently, so comparing against a live
 * count would make this file order-dependent.
 */
const REGISTERED_AT_LOAD = getRegisteredDrainCount();

/**
 * Scan src/ recursively for the fire-and-forget pattern:
 *   const pending<X>Writes = new Set<Promise<...>>();
 *
 * Returns the total count of such Sets across all source files.
 * Each one is a queue that must be registered for shutdown drain.
 *
 * The scan is recursive on purpose: src/ has cli/, lab-db/, mcp/ and roles/
 * subdirectories, and a queue added in any of them must be caught too. A
 * top-level-only scan would leave a blind spot in the exact check whose job is
 * to have none.
 */
function countPendingWritesQueuesInSrc(): number {
	const srcDir = join(process.cwd(), "src");
	const files = readdirSync(srcDir, { recursive: true }).filter(
		(f): f is string => typeof f === "string" && f.endsWith(".ts"),
	);
	let total = 0;
	for (const file of files) {
		const content = readFileSync(join(srcDir, file), "utf8");
		const matches = content.match(/pending\w*Writes\s*=\s*new\s+Set/g);
		if (matches) total += matches.length;
	}
	return total;
}

test("every pending*Writes queue in src/ is registered for shutdown drain", () => {
	const queueCount = countPendingWritesQueuesInSrc();
	assert.ok(
		queueCount >= 5,
		`expected at least 5 pending*Writes queues, found ${queueCount}`,
	);
	assert.equal(
		REGISTERED_AT_LOAD,
		queueCount,
		`Found ${queueCount} pending*Writes queues in src/ but only ` +
			`${REGISTERED_AT_LOAD} registered drains. ` +
			"A new fire-and-forget queue was added without registerShutdownDrain().",
	);
});

test("drainAllShutdownQueues settles even when a registered drain rejects", async () => {
	const beforeReject = getRegisteredDrainCount();
	registerShutdownDrain(async () => {
		throw new Error("simulated drain failure");
	});
	registerShutdownDrain(async () => {
		// This must still run despite the sibling rejection.
	});

	// Must not throw — Promise.allSettled guarantees it.
	await drainAllShutdownQueues();

	assert.equal(
		getRegisteredDrainCount(),
		beforeReject + 2,
		"both drains should be registered",
	);
});

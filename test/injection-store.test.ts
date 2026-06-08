import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
	appendInjection,
	markInjectionAcked,
	readPendingInjections,
	resolveInjectionsPath,
} from "../src/injection-store.js";
import type { Injection } from "../src/injection-store.js";

const roots: string[] = [];

function freshRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "idu-pi-injection-store-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	while (roots.length > 0) {
		const root = roots.pop();
		if (root) rmSync(root, { recursive: true, force: true });
	}
});

function makeInjection(overrides: Partial<Injection> = {}): Injection {
	return {
		ts: "2026-06-08T10:00:00.000Z",
		triggerId: "stuck_tasks_1h",
		decisionEnvelope: {
			severity: "warning",
			summary: "1 tareas abiertas más de 1h",
			options: ["review_each", "close_stale", "ignore"],
			evidenceRefs: ["events.jsonl:test"],
			orchestratorDecisionRequired: true,
		},
		injectionId: "abc123def456",
		acked: false,
		...overrides,
	};
}

test("appendInjection creates injections.jsonl when missing", () => {
	const root = freshRoot();
	assert.equal(existsSync(resolveInjectionsPath(root)), false);
	appendInjection(root, makeInjection());
	assert.equal(existsSync(resolveInjectionsPath(root)), true);
});

test("appendInjection roundtrips injection through JSONL", () => {
	const root = freshRoot();
	const inj = makeInjection();
	appendInjection(root, inj);
	const pending = readPendingInjections(root);
	assert.equal(pending.length, 1);
	assert.deepEqual(pending[0], inj);
});

test("readPendingInjections filters out acked injections", () => {
	const root = freshRoot();
	appendInjection(root, makeInjection({ injectionId: "inj-1" }));
	appendInjection(root, makeInjection({ injectionId: "inj-2", acked: true }));
	appendInjection(root, makeInjection({ injectionId: "inj-3" }));
	const pending = readPendingInjections(root);
	assert.equal(pending.length, 2);
	assert.equal(pending[0].injectionId, "inj-1");
	assert.equal(pending[1].injectionId, "inj-3");
});

test("readPendingInjections returns empty array when file is empty", () => {
	const root = freshRoot();
	writeFileSync(resolveInjectionsPath(root), "", "utf8");
	const pending = readPendingInjections(root);
	assert.equal(pending.length, 0);
});

test("markInjectionAcked flips flag in place on disk", () => {
	const root = freshRoot();
	appendInjection(root, makeInjection({ injectionId: "inj-flip" }));
	markInjectionAcked(root, "inj-flip");
	const pending = readPendingInjections(root);
	assert.equal(pending.length, 0);
	const raw = readFileSync(resolveInjectionsPath(root), "utf8");
	assert.match(raw, /"acked":true/u);
});

test("markInjectionAcked with unknown injectionId is a no-op", () => {
	const root = freshRoot();
	appendInjection(root, makeInjection({ injectionId: "inj-1" }));
	const beforeRaw = readFileSync(resolveInjectionsPath(root), "utf8");
	markInjectionAcked(root, "inj-does-not-exist");
	const afterRaw = readFileSync(resolveInjectionsPath(root), "utf8");
	assert.equal(afterRaw, beforeRaw);
});

test("appendInjection rejects path traversal with invalid artifact name", () => {
	const root = freshRoot();
	assert.throws(
		() =>
			appendInjection(
				root,
				makeInjection({ triggerId: "../../../etc/passwd" }),
			),
		/invalid artifact name/u,
	);
	// Verify nothing was written
	assert.equal(existsSync(resolveInjectionsPath(root)), false);
});

import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	applyPrune,
	planPrune,
	type PruneOptions,
} from "../src/idu-outbox-prune.js";

function makeStateRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-outbox-prune-"));
}

function daysAgoIso(days: number, now = new Date("2026-06-15T00:00:00Z")): string {
	return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function seedProposal(stateRoot: string, id: string, createdAt: string): void {
	const dir = join(stateRoot, "reports");
	mkdirSync(dir, { recursive: true });
	const line = `${JSON.stringify({
		version: 1,
		id,
		status: "proposed",
		createdAt,
		updatedAt: createdAt,
		hitoId: "h-1",
		specId: "s-1",
		flowId: "f-1",
		contractIds: ["c-1"],
		evidenceRefs: [],
		title: "demo",
		rationale: "demo",
		recommendedAction: "ask_human",
		risk: "low",
		policyDecision: "ask_human",
		scope: "code",
		bindings: { hitoId: "h-1", specId: "s-1", flowId: "f-1" },
	})}\n`;
	const path = join(dir, "proposals.jsonl");
	if (existsSync(path)) {
		writeFileSync(path, readFileSync(path, "utf8") + line, "utf8");
	} else {
		writeFileSync(path, line, "utf8");
	}
}

function seedInjection(stateRoot: string, id: string, createdAt: string): void {
	const path = join(stateRoot, "injections.jsonl");
	const line = `${JSON.stringify({
		version: 1,
		id,
		createdAt,
		envelope: {
			severity: "info",
			summary: "demo",
			evidenceRefs: [],
		},
	})}\n`;
	if (existsSync(path)) {
		writeFileSync(path, readFileSync(path, "utf8") + line, "utf8");
	} else {
		writeFileSync(path, line, "utf8");
	}
}

const NOW = new Date("2026-06-15T00:00:00Z");
const OPTS: PruneOptions = { olderThanDays: 30, now: NOW };

test("planPrune returns 0 entries when stateRoot is empty", () => {
	const stateRoot = makeStateRoot();
	try {
		const plan = planPrune(stateRoot, OPTS);
		assert.equal(plan.proposals.length, 0);
		assert.equal(plan.injections.length, 0);
		assert.equal(plan.dryRun, true);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("planPrune filters out recent entries, keeps old ones", () => {
	const stateRoot = makeStateRoot();
	try {
		// 2 old (60d), 2 recent (5d)
		seedProposal(stateRoot, "p-old-1", daysAgoIso(60, NOW));
		seedProposal(stateRoot, "p-old-2", daysAgoIso(45, NOW));
		seedProposal(stateRoot, "p-new-1", daysAgoIso(5, NOW));
		seedProposal(stateRoot, "p-new-2", daysAgoIso(1, NOW));
		// 3 old, 1 new injections
		seedInjection(stateRoot, "i-old-1", daysAgoIso(90, NOW));
		seedInjection(stateRoot, "i-old-2", daysAgoIso(60, NOW));
		seedInjection(stateRoot, "i-old-3", daysAgoIso(31, NOW));
		seedInjection(stateRoot, "i-new-1", daysAgoIso(2, NOW));
		const plan = planPrune(stateRoot, OPTS);
		assert.equal(plan.proposals.length, 2, "should keep 2 old proposals");
		assert.equal(plan.injections.length, 3, "should keep 3 old injections");
		assert.deepEqual(
			plan.proposals.map((p) => p.id).sort(),
			["p-old-1", "p-old-2"],
		);
		assert.deepEqual(
			plan.injections.map((i) => i.id).sort(),
			["i-old-1", "i-old-2", "i-old-3"],
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("applyPrune archives to .archive/YYYY-MM-DD/ and removes from live", () => {
	const stateRoot = makeStateRoot();
	try {
		seedProposal(stateRoot, "p-old-1", daysAgoIso(60, NOW));
		seedProposal(stateRoot, "p-new-1", daysAgoIso(5, NOW));
		seedInjection(stateRoot, "i-old-1", daysAgoIso(60, NOW));
		seedInjection(stateRoot, "i-new-1", daysAgoIso(5, NOW));
		const plan = planPrune(stateRoot, OPTS);
		const result = applyPrune(stateRoot, plan, OPTS);
		assert.equal(result.archived.proposals, 1);
		assert.equal(result.archived.injections, 1);
		// Live proposal file should only have p-new-1
		const live = readFileSync(
			join(stateRoot, "reports", "proposals.jsonl"),
			"utf8",
		);
		assert.match(live, /p-new-1/);
		assert.doesNotMatch(live, /p-old-1/);
		// Live injections file should only have i-new-1
		const liveInj = readFileSync(
			join(stateRoot, "injections.jsonl"),
			"utf8",
		);
		assert.match(liveInj, /i-new-1/);
		assert.doesNotMatch(liveInj, /i-old-1/);
		// Archive file should have the old entries
		const archiveDir = join(stateRoot, ".archive", "2026-06-15");
		assert.ok(existsSync(archiveDir));
		const archiveProposals = readFileSync(
			join(archiveDir, "proposals.jsonl"),
			"utf8",
		);
		assert.match(archiveProposals, /p-old-1/);
		const archiveInjections = readFileSync(
			join(archiveDir, "injections.jsonl"),
			"utf8",
		);
		assert.match(archiveInjections, /i-old-1/);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("planPrune handles malformed proposal file gracefully (parse-or-skip)", () => {
	const stateRoot = makeStateRoot();
	try {
		// Write a malformed proposals file
		const dir = join(stateRoot, "reports");
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, "proposals.jsonl"),
			"this is not json\n{garbage}\n",
			"utf8",
		);
		const plan = planPrune(stateRoot, OPTS);
		// Skips silently: no entries returned, no throw
		assert.equal(plan.proposals.length, 0);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("planPrune with olderThanDays=1 archives entries older than 1 day (positive control)", () => {
	const stateRoot = makeStateRoot();
	try {
		// 2 days ago: older than 1 day → prunable
		// 12 hours ago: not older than 1 day → kept
		seedProposal(stateRoot, "p-2d", daysAgoIso(2, NOW));
		seedProposal(stateRoot, "p-12h", daysAgoIso(0.5, NOW));
		const plan = planPrune(stateRoot, {
			...OPTS,
			olderThanDays: 1,
		});
		assert.equal(plan.proposals.length, 1);
		assert.equal(plan.proposals[0]?.id, "p-2d");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

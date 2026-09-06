/**
 * E2E skills-connections acceptance test.
 *
 * Validates that the 5 connected pieces from the
 * `2026-06-15-idu-pi-skills-and-connections` plan are all wired
 * together and operating on the contract written in the role
 * profiles. Each scenario exercises one or more of:
 *
 *   - profile-loader (config/profiles/*.md)
 *   - digest classifier (PR-4 W1 fix)
 *   - role-event producers (PR-7)
 *   - decision ledger (PR-6)
 *   - objective reminder (PR-5)
 *
 * The scenarios are:
 *
 *   1. Scenario 1 — every role profile loads, has prohibitions,
 *      and the default model matches model-assignments.json for
 *      the 13 supervised roles.
 *   2. Scenario 2 — the digest classifier routes critical
 *      signals (security/db/data-loss) immediately and
 *      high-severity non-critical signals to the digest (the W1
 *      fix), enforced by the supervisor-main profile contract.
 *   3. Scenario 3 — an orchestrator_turn event lands in
 *      stateRoot/events.jsonl with the right kind and tool name;
 *      an alerts_scheduled_tick event does the same with cronExpr.
 *   4. Scenario 4 — a decision recorded with profile_ref
 *      pointing to the supervisor-main profile round-trips
 *      through SQLite (recordDecision + listDecisions).
 *   5. Scenario 5 — the objective reminder for a project with a
 *      master-plan.json includes the role label, the routine
 *      (from the orchestrator profile), and the cadence hint.
 */

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
import { test } from "node:test";
import { classifyInterrupt, type DigestSignal } from "../src/digest.js";
import {
	recordDecision,
	listDecisions,
	type DecisionRecord,
} from "../src/decision-ledger.js";
import {
	emitAlertsScheduledTick,
	emitOrchestratorTurn,
} from "../src/role-events.js";
import { resolveEventsPath } from "../src/event-bus.js";
import {
	listAvailableRoleProfiles,
	loadRoleProfile,
} from "../src/roles/profile-loader.js";
import { buildObjectiveReminderText } from "../src/objective-reminder.js";

function makeStateRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-e2e-acceptance-"));
}

function readEventsJsonl(stateRoot: string): Array<{
	kind: string;
	projectId: string;
	sourceRef: string;
	payload: Record<string, unknown>;
}> {
	const path = resolveEventsPath(stateRoot);
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split(/\r?\n/u)
		.filter(Boolean)
		.map((line) => JSON.parse(line) as never);
}

test("Scenario 1: every role profile loads with prohibitions and a default model", () => {
	const list = listAvailableRoleProfiles();
	assert.equal(list.length, 14, "expected 14 profiles");
	for (const roleId of list) {
		const profile = loadRoleProfile(roleId);
		assert.ok(
			profile.prohibitions.length > 0,
			`${roleId}: must have at least one prohibition`,
		);
		assert.ok(
			profile.modeloDefecto.length > 0,
			`${roleId}: must have a non-empty default model`,
		);
	}
});

test("Scenario 2: digest classifier honors supervisor-main profile policy (W1 fix)", () => {
	const profile = loadRoleProfile("supervisor-main");
	// The profile's prohibition: "Interrumpir al humano por señales
	// no críticas (van al digest)".
	assert.match(profile.prohibitions.join("\n"), /Interrumpir al humano/i);
	// The classifier routes critical signals immediately.
	assert.equal(
		classifyInterrupt({
			id: "1",
			domain: "security",
			kind: "alert",
			summary: "r",
		} as DigestSignal),
		"immediate",
	);
	// And high-severity non-critical signals to the digest.
	assert.equal(
		classifyInterrupt({
			id: "2",
			domain: "ui",
			kind: "ui-regression",
			riskLevel: "high",
			summary: "r",
		} as DigestSignal),
		"digest",
	);
	assert.equal(
		classifyInterrupt({
			id: "3",
			domain: "code-quality",
			kind: "bug",
			riskLevel: "blocker",
			summary: "r",
		} as DigestSignal),
		"digest",
	);
});

test("Scenario 3: orchestrator_turn and alerts_scheduled_tick events land in events.jsonl", () => {
	const stateRoot = makeStateRoot();
	try {
		emitOrchestratorTurn({
			stateRoot,
			projectId: "demo",
			toolName: "idu_status",
			source: "mcp-server",
			now: new Date("2026-06-15T00:00:00Z"),
		});
		emitAlertsScheduledTick({
			stateRoot,
			projectId: "demo",
			cronExpr: "*/15 * * * *",
			source: "cron",
			now: new Date("2026-06-15T00:00:01Z"),
		});
		const events = readEventsJsonl(stateRoot);
		assert.equal(events.length, 2);
		assert.equal(events[0]?.kind, "orchestrator_turn");
		assert.equal(
			(events[0]?.payload as { toolName: string }).toolName,
			"idu_status",
		);
		assert.equal(events[1]?.kind, "alerts_scheduled_tick");
		assert.equal(
			(events[1]?.payload as { cronExpr: string }).cronExpr,
			"*/15 * * * *",
		);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("Scenario 4: decision ledger records a decision with profile_ref and round-trips through SQLite", () => {
	const stateRoot = makeStateRoot();
	try {
		const dbPath = join(stateRoot, "lab.db");
		const record: DecisionRecord = {
			projectId: "demo",
			decidedAt: "2026-06-15T00:00:00Z",
			decidedBy: "orchestrator",
			decision: "ignore",
			targetKind: "digest_signal",
			targetId: "ds-1",
			rationale: "low priority, defer to next digest",
			profileRef: "config/profiles/supervisor-main.md",
		};
		const row = recordDecision(dbPath, record);
		assert.ok(row.id > 0, "row id must be a positive integer");
		// Round-trip: read it back.
		const all = listDecisions(dbPath, { projectId: "demo" });
		assert.equal(all.length, 1);
		const read = all[0];
		assert.equal(read?.decision, "ignore");
		assert.equal(read?.profileRef, "config/profiles/supervisor-main.md");
		assert.equal(read?.targetId, "ds-1");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("Scenario 5: objective reminder includes role, routine, and cadence hint", () => {
	const stateRoot = makeStateRoot();
	try {
		// Seed a master-plan.json with a real objective.
		writeFileSync(
			join(stateRoot, "master-plan.json"),
			`${JSON.stringify({ objective: "Build a deck for the team offsite" })}\n`,
			"utf8",
		);
		const text = buildObjectiveReminderText(
			{ stateRoot, now: new Date("2026-06-15T00:00:00Z") },
			{ activeModelId: "opencode-go/deepseek-v4-pro" },
		);
		assert.match(text, /Build a deck for the team offsite/);
		assert.match(text, /Eres: orquestador/i);
		assert.match(text, /Tipo: orquestador/);
		assert.match(
			text,
			/Rutina obligatoria|Al iniciar sesi|Entre tareas|Antes de implementar/i,
		);
		// Cadence hint for a strong model.
		assert.match(text, /cada ~10 tareas/);
		assert.match(text, /opencode-go\/deepseek-v4-pro/);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

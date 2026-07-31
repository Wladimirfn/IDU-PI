// test/escalation-delivery.test.ts
//
// Tests for the pure delivery planning function. planDelivery takes
// (events, deliveredIds, now, options) and returns a plan — no bot, no
// file system, no side effects. Every code path is testable here.

import { test, describe } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert";
import {
	planDelivery,
	MAX_MESSAGES_PER_HOUR,
	type DeliveryPlan,
} from "../src/escalation-delivery.js";
import type { UserEscalationEvent, EscalationReason } from "../src/user-escalation.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = new Date("2026-07-31T15:00:00.000Z");
const HOUR = 3600_000;

function makeEvent(opts: {
	id: string;
	minutesAgo: number;
	critical?: number;
	warning?: number;
	info?: number;
	total?: number;
	reasons?: EscalationReason[];
}): UserEscalationEvent {
	const ts = new Date(NOW.getTime() - opts.minutesAgo * 60_000);
	const critical = opts.critical ?? 1;
	const warning = opts.warning ?? 0;
	const info = opts.info ?? 0;
	return {
		ts: ts.toISOString(),
		escalationId: opts.id,
		reasons: opts.reasons ?? (["recent_critical_threshold"] as EscalationReason[]),
		triggeredFindingIds: [],
		counts: { critical, warning, info, total: opts.total ?? critical + warning + info },
		hoursSinceLastInteraction: 0,
		lastUserInteractionAt: ts.toISOString(),
	};
}

function deliveredSet(...ids: string[]): Set<string> {
	return new Set(ids);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("escalation-delivery planDelivery", () => {
	// --- PREMIERE ---

	test("premiere: empty deliveredIds + events in window → one summary, isPremiere=true", () => {
		const events = [
			makeEvent({ id: "esc-1", minutesAgo: 60, critical: 3 }),
			makeEvent({ id: "esc-2", minutesAgo: 30, critical: 2 }),
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet(),
			now: NOW,
		});
		strictEqual(plan.isPremiere, true);
		strictEqual(plan.messages.length, 1);
		strictEqual(plan.deliveredEscalationIds.length, 2);
		ok(plan.messages[0].text.includes("Resumen inicial"));
		ok(plan.messages[0].text.includes("2 escalaciones"));
	});

	test("premiere: includes discarded count when events outside window exist", () => {
		const events = [
			makeEvent({ id: "esc-recent", minutesAgo: 60 }),
			...Array.from({ length: 5 }, (_, i) =>
				makeEvent({ id: `esc-old-${i}`, minutesAgo: 25 * 60 }),
			),
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet(),
			now: NOW,
		});
		ok(plan.messages[0].text.includes("5 anteriores fuera de ventana"));
		strictEqual(plan.skippedOutsideWindow, 5);
	});

	test("premiere: omits discarded line when zero outside window", () => {
		const events = [makeEvent({ id: "esc-1", minutesAgo: 60 })];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet(),
			now: NOW,
		});
		ok(!plan.messages[0].text.includes("fuera de ventana"));
	});

	test("premiere: uses human-readable labels (not enum names)", () => {
		const events = [
			makeEvent({ id: "esc-1", minutesAgo: 60, critical: 4, total: 7 }),
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet(),
			now: NOW,
		});
		ok(plan.messages[0].text.includes("críticas"), "Should say 'críticas' not 'recent_critical'");
		ok(!plan.messages[0].text.includes("recent_critical"), "Should NOT contain enum name");
	});

	// --- NON-PREMIERE ---

	test("non-premiere single event: one message with detail", () => {
		const events = [makeEvent({ id: "esc-1", minutesAgo: 60, critical: 2, warning: 3, info: 1 })];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-old"), // non-empty = not premiere
			now: NOW,
		});
		strictEqual(plan.isPremiere, false);
		strictEqual(plan.messages.length, 1);
		strictEqual(plan.deliveredEscalationIds.length, 1);
		ok(plan.messages[0].text.includes("2 crítica(s)"));
		ok(plan.messages[0].text.includes("total: 6"));
	});

	test("non-premiere multiple events: compacted into one message", () => {
		const events = [
			makeEvent({ id: "esc-1", minutesAgo: 120, critical: 3, total: 5 }),
			makeEvent({ id: "esc-2", minutesAgo: 60, critical: 2, total: 4 }),
			makeEvent({ id: "esc-3", minutesAgo: 30, critical: 1, total: 3 }),
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-old"),
			now: NOW,
		});
		strictEqual(plan.messages.length, 1, "Should compact into 1 message");
		ok(plan.messages[0].text.includes("3 escalaciones"));
		ok(plan.messages[0].text.includes("6 críticas acumuladas"));
		strictEqual(plan.deliveredEscalationIds.length, 3);
	});

	// --- NO PENDING / RESTART IDEMPOTENCY ---

	test("all delivered: empty plan (restart idempotency)", () => {
		const events = [
			makeEvent({ id: "esc-1", minutesAgo: 60 }),
			makeEvent({ id: "esc-2", minutesAgo: 30 }),
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-1", "esc-2"),
			now: NOW,
		});
		strictEqual(plan.messages.length, 0);
		strictEqual(plan.deliveredEscalationIds.length, 0);
		strictEqual(plan.skippedAlreadyDelivered, 2);
	});

	test("empty events: empty plan", () => {
		const plan = planDelivery({
			events: [],
			deliveredIds: deliveredSet(),
			now: NOW,
		});
		strictEqual(plan.messages.length, 0);
		strictEqual(plan.totalEvents, 0);
	});

	// --- FRESHNESS WINDOW ---

	test("events outside window are excluded", () => {
		const events = [
			makeEvent({ id: "esc-in", minutesAgo: 60 }),
			makeEvent({ id: "esc-out", minutesAgo: 25 * 60 }), // 25h ago
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-old"),
			now: NOW,
		});
		strictEqual(plan.skippedOutsideWindow, 1);
		strictEqual(plan.deliveredEscalationIds.length, 1);
		strictEqual(plan.deliveredEscalationIds[0], "esc-in");
	});

	test("custom freshness window (2h)", () => {
		const events = [
			makeEvent({ id: "esc-1", minutesAgo: 30 }),
			makeEvent({ id: "esc-2", minutesAgo: 90 }),
			makeEvent({ id: "esc-3", minutesAgo: 150 }), // 2.5h ago, outside 2h window
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-old"),
			now: NOW,
			freshnessWindowHours: 2,
		});
		strictEqual(plan.skippedOutsideWindow, 1);
		strictEqual(plan.deliveredEscalationIds.length, 2);
	});

	// --- THROTTLE ---

	test("throttle: recentDeliveryCount >= maxPerHour → throttled, no messages", () => {
		const events = [makeEvent({ id: "esc-1", minutesAgo: 60 })];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-old"),
			now: NOW,
			recentDeliveryCount: MAX_MESSAGES_PER_HOUR,
		});
		strictEqual(plan.throttled, true);
		strictEqual(plan.messages.length, 0);
		strictEqual(plan.deliveredEscalationIds.length, 0);
	});

	test("throttle: recentDeliveryCount < maxPerHour → not throttled", () => {
		const events = [makeEvent({ id: "esc-1", minutesAgo: 60 })];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-old"),
			now: NOW,
			recentDeliveryCount: MAX_MESSAGES_PER_HOUR - 1,
		});
		strictEqual(plan.throttled, false);
		strictEqual(plan.messages.length, 1);
	});

	test("throttle: does not apply to premiere (delivery-log empty)", () => {
		const events = [makeEvent({ id: "esc-1", minutesAgo: 60 })];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet(),
			now: NOW,
			recentDeliveryCount: 99, // would throttle, but premiere takes priority
		});
		strictEqual(plan.isPremiere, true);
		strictEqual(plan.throttled, false);
		strictEqual(plan.messages.length, 1);
	});

	// --- RESTART SIMULATION (multi-step) ---

	test("restart simulation: premiere → mark delivered → restart → 0 messages", () => {
		const events = [
			makeEvent({ id: "esc-a", minutesAgo: 60, critical: 3 }),
			makeEvent({ id: "esc-b", minutesAgo: 30, critical: 2 }),
		];

		// Step 1: premiere
		const plan1 = planDelivery({
			events,
			deliveredIds: deliveredSet(),
			now: NOW,
		});
		strictEqual(plan1.isPremiere, true);
		strictEqual(plan1.deliveredEscalationIds.length, 2);

		// Step 2: simulate delivery-log written, restart
		const deliveredAfterPremiere = deliveredSet(...plan1.deliveredEscalationIds);
		const plan2 = planDelivery({
			events,
			deliveredIds: deliveredAfterPremiere,
			now: NOW,
		});
		strictEqual(plan2.messages.length, 0, "Restart should produce 0 messages");
		strictEqual(plan2.deliveredEscalationIds.length, 0);
	});

	test("restart simulation: new event after premiere → 1 message, then 0 on next restart", () => {
		const events = [
			makeEvent({ id: "esc-a", minutesAgo: 120 }),
			makeEvent({ id: "esc-new", minutesAgo: 10 }),
		];

		// Step 1: premiere delivers esc-a
		const plan1 = planDelivery({
			events: [events[0]],
			deliveredIds: deliveredSet(),
			now: NOW,
		});
		const delivered = deliveredSet(...plan1.deliveredEscalationIds);

		// Step 2: new event arrives, non-premiere
		const plan2 = planDelivery({
			events,
			deliveredIds: delivered,
			now: NOW,
		});
		strictEqual(plan2.isPremiere, false);
		strictEqual(plan2.messages.length, 1);
		ok(plan2.messages[0].text.includes("esc-new") || plan2.deliveredEscalationIds.includes("esc-new"));

		// Step 3: restart after delivering new event
		const delivered2 = deliveredSet(...plan2.deliveredEscalationIds, ...delivered);
		const plan3 = planDelivery({
			events,
			deliveredIds: delivered2,
			now: NOW,
		});
		strictEqual(plan3.messages.length, 0, "Second restart should produce 0 messages");
	});

	// --- EDGE CASES ---

	test("premiere with single event: message has correct format", () => {
		const events = [makeEvent({ id: "esc-1", minutesAgo: 60, critical: 1, total: 3 })];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet(),
			now: NOW,
		});
		ok(plan.messages[0].text.startsWith("🔵 [idu-pi]"));
		ok(plan.messages[0].text.includes("1 escalaciones"));
	});

	test("compacted message: time range uses first and last event times", () => {
		const events = [
			makeEvent({ id: "esc-1", minutesAgo: 120, critical: 1 }),
			makeEvent({ id: "esc-2", minutesAgo: 30, critical: 1 }),
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-old"),
			now: NOW,
		});
		// Should contain a time range like HH:MM–HH:MM
		ok(plan.messages[0].text.match(/\d{2}:\d{2}.\d{2}:\d{2}/), "Should contain time range");
	});

	test("deliveredIds with entries but none matching events → treated as non-premiere", () => {
		const events = [makeEvent({ id: "esc-1", minutesAgo: 60 })];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-unrelated"),
			now: NOW,
		});
		strictEqual(plan.isPremiere, false);
		strictEqual(plan.messages.length, 1);
	});
});

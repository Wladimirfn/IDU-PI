// test/escalation-delivery.test.ts
//
// Tests for the pure delivery planning function. planDelivery takes
// (events, deliveredIds, now, options) and returns a plan — no bot, no
// file system, no side effects. Every code path is testable here.

import { test, describe } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert";
import { writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "./helpers/temp.js";
import {
	planDelivery,
	MAX_MESSAGES_PER_HOUR,
	readDeliveryFlag,
	writeDeliveryFlag,
	readLastDelivery,
	deliveryLogPath,
	type ResolvedFinding,
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
	findingIds?: string[];
}): UserEscalationEvent {
	const ts = new Date(NOW.getTime() - opts.minutesAgo * 60_000);
	const critical = opts.critical ?? 1;
	const warning = opts.warning ?? 0;
	const info = opts.info ?? 0;
	return {
		ts: ts.toISOString(),
		escalationId: opts.id,
		reasons: opts.reasons ?? (["recent_critical_threshold"] as EscalationReason[]),
		triggeredFindingIds: opts.findingIds ?? [],
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

// ---------------------------------------------------------------------------
// Toggle + last-delivered tests
// ---------------------------------------------------------------------------

describe("escalation-delivery toggle (readDeliveryFlag / writeDeliveryFlag)", () => {
	test("absent flag = OFF (inverted default)", () => {
		const dir = makeTempDir("delivery-flag-absent-");
		strictEqual(readDeliveryFlag(dir), false);
	});

	test("enabled: true → ON", () => {
		const dir = makeTempDir("delivery-flag-on-");
		writeFileSync(join(dir, "escalation-delivery.json"), '{"enabled":true}', "utf8");
		strictEqual(readDeliveryFlag(dir), true);
	});

	test("enabled: false → OFF", () => {
		const dir = makeTempDir("delivery-flag-off-");
		writeFileSync(join(dir, "escalation-delivery.json"), '{"enabled":false}', "utf8");
		strictEqual(readDeliveryFlag(dir), false);
	});

	test("INVARIANT: absent and enabled:false give same result (OFF)", () => {
		const dirAbsent = makeTempDir("delivery-inv-absent-");
		const dirFalse = makeTempDir("delivery-inv-false-");
		writeFileSync(join(dirFalse, "escalation-delivery.json"), '{"enabled":false}', "utf8");
		strictEqual(readDeliveryFlag(dirAbsent), readDeliveryFlag(dirFalse));
		strictEqual(readDeliveryFlag(dirAbsent), false);
	});

	test("corrupt flag file → OFF", () => {
		const dir = makeTempDir("delivery-flag-corrupt-");
		writeFileSync(join(dir, "escalation-delivery.json"), "not json", "utf8");
		strictEqual(readDeliveryFlag(dir), false);
	});

	test("writeDeliveryFlag(true) then read → true", () => {
		const dir = makeTempDir("delivery-write-on-");
		writeDeliveryFlag(dir, true);
		strictEqual(readDeliveryFlag(dir), true);
	});

	test("writeDeliveryFlag(false) then read → false", () => {
		const dir = makeTempDir("delivery-write-off-");
		writeDeliveryFlag(dir, false);
		strictEqual(readDeliveryFlag(dir), false);
	});

	test("toggle: write true → write false → read false", () => {
		const dir = makeTempDir("delivery-toggle-");
		writeDeliveryFlag(dir, true);
		strictEqual(readDeliveryFlag(dir), true);
		writeDeliveryFlag(dir, false);
		strictEqual(readDeliveryFlag(dir), false);
	});
});

describe("escalation-delivery readLastDelivery", () => {
	test("absent file → null", () => {
		const dir = makeTempDir("delivery-last-absent-");
		strictEqual(readLastDelivery(join(dir, "delivery-log.jsonl")), null);
	});

	test("empty file → null", () => {
		const dir = makeTempDir("delivery-last-empty-");
		const path = join(dir, "delivery-log.jsonl");
		writeFileSync(path, "", "utf8");
		strictEqual(readLastDelivery(path), null);
	});

	test("one entry → returns deliveredAt", () => {
		const dir = makeTempDir("delivery-last-one-");
		const path = join(dir, "delivery-log.jsonl");
		writeFileSync(path, JSON.stringify({
			escalationId: "esc-1",
			deliveredAt: "2026-07-31T16:37:38.969Z",
			chatId: 12345,
		}) + "\n", "utf8");
		strictEqual(readLastDelivery(path), "2026-07-31T16:37:38.969Z");
	});

	test("multiple entries → returns last (most recent)", () => {
		const dir = makeTempDir("delivery-last-multi-");
		const path = join(dir, "delivery-log.jsonl");
		writeFileSync(path, [
			JSON.stringify({ escalationId: "esc-1", deliveredAt: "2026-07-31T10:00:00Z" }),
			JSON.stringify({ escalationId: "esc-2", deliveredAt: "2026-07-31T12:00:00Z" }),
			JSON.stringify({ escalationId: "esc-3", deliveredAt: "2026-07-31T16:37:38Z" }),
		].join("\n") + "\n", "utf8");
		strictEqual(readLastDelivery(path), "2026-07-31T16:37:38Z");
	});

	test("corrupt last line → null", () => {
		const dir = makeTempDir("delivery-last-corrupt-");
		const path = join(dir, "delivery-log.jsonl");
		writeFileSync(path, [
			JSON.stringify({ escalationId: "esc-1", deliveredAt: "2026-07-31T10:00:00Z" }),
			"corrupt line",
		].join("\n") + "\n", "utf8");
		strictEqual(readLastDelivery(path), null);
	});
});

// ---------------------------------------------------------------------------
// Phase 2: finding detail rendering
// ---------------------------------------------------------------------------

function finding(opts: {
	id: string;
	severity?: "critical" | "high" | "medium" | "low" | "info";
	title?: string;
	description?: string;
	filePath?: string;
	status?: "new" | "ignored";
}): ResolvedFinding {
	return {
		id: opts.id,
		severity: opts.severity ?? "medium",
		title: opts.title ?? "Test finding",
		description: opts.description ?? "A test description.",
		filePath: opts.filePath ?? "src/test.ts",
		status: opts.status ?? "new",
	};
}

describe("escalation-delivery planDelivery with resolvedFindings", () => {
	test("open critical: 🔴 header with detail line", () => {
		const events = [
			makeEvent({ id: "esc-1", minutesAgo: 60, critical: 1, total: 3, findingIds: ["f-1"] }),
		];
		const findings = [
			finding({ id: "f-1", severity: "critical", title: "Critical bug", filePath: "src/a.ts" }),
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-old"),
			now: NOW,
			resolvedFindings: findings,
		});
		strictEqual(plan.messages.length, 1);
		ok(plan.messages[0].text.startsWith("🔴"), "Should have red emoji");
		ok(plan.messages[0].text.includes("1 crítica"), "Should say 1 crítica");
		ok(plan.messages[0].text.includes("src/a.ts"), "Should show file path");
		ok(plan.messages[0].text.includes("Critical bug"), "Should show title");
	});

	test("ignored critical + open high: 🟡 header (the #397 case)", () => {
		const events = [
			makeEvent({ id: "esc-1", minutesAgo: 60, critical: 1, total: 26, findingIds: ["f-1", "f-2"] }),
		];
		const findings = [
			finding({ id: "f-1", severity: "critical", status: "ignored", title: "False positive", filePath: "src/a.ts" }),
			finding({ id: "f-2", severity: "high", title: "Real issue", filePath: "src/b.ts" }),
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-old"),
			now: NOW,
			resolvedFindings: findings,
		});
		strictEqual(plan.messages.length, 1);
		ok(plan.messages[0].text.startsWith("🟡"), "No red — critical is ignored");
		ok(plan.messages[0].text.includes("1 alta"), "Should say 1 alta");
		ok(plan.messages[0].text.includes("Real issue"), "Should show the high finding");
		ok(!plan.messages[0].text.includes("False positive"), "Should NOT show ignored in detail");
		ok(plan.messages[0].text.includes("1 ya revisada"), "Should count reviewed at foot");
	});

	test("all findings ignored: no message, but marked delivered", () => {
		const events = [
			makeEvent({ id: "esc-1", minutesAgo: 60, critical: 1, findingIds: ["f-1"] }),
		];
		const findings = [
			finding({ id: "f-1", severity: "critical", status: "ignored" }),
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-old"),
			now: NOW,
			resolvedFindings: findings,
		});
		strictEqual(plan.messages.length, 0, "No message — all reviewed");
		strictEqual(plan.deliveredEscalationIds.length, 1, "Still marked delivered");
	});

	test("multiple criticals: all get detail lines", () => {
		const events = [
			makeEvent({ id: "esc-1", minutesAgo: 60, critical: 2, findingIds: ["f-1", "f-2"] }),
		];
		const findings = [
			finding({ id: "f-1", severity: "critical", title: "First", filePath: "src/a.ts" }),
			finding({ id: "f-2", severity: "critical", title: "Second", filePath: "src/b.ts" }),
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-old"),
			now: NOW,
			resolvedFindings: findings,
		});
		ok(plan.messages[0].text.includes("2 críticas"));
		ok(plan.messages[0].text.includes("First"));
		ok(plan.messages[0].text.includes("Second"));
	});

	test("no resolvedFindings: fallback to counts-only (pre-#383)", () => {
		const events = [
			makeEvent({ id: "esc-1", minutesAgo: 60, critical: 2, total: 5 }),
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-old"),
			now: NOW,
		});
		strictEqual(plan.messages.length, 1);
		ok(plan.messages[0].text.includes("2 crítica(s)"), "Counts format, not finding detail");
	});

	test("resolvedFindings present but no IDs match pending events: fallback", () => {
		const events = [
			makeEvent({ id: "esc-1", minutesAgo: 60, critical: 1 }),
		];
		const findings = [
			finding({ id: "f-unrelated", severity: "critical" }),
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-old"),
			now: NOW,
			resolvedFindings: findings,
		});
		strictEqual(plan.messages.length, 1);
		// Falls back to counts format because no finding IDs match the event's triggeredFindingIds
		ok(plan.messages[0].text.includes("crítica(s)"));
	});

	test("header does not say crítica when only critical is ignored", () => {
		const events = [
			makeEvent({ id: "esc-1", minutesAgo: 60, critical: 1, total: 10, findingIds: ["f-1", "f-2", "f-3"] }),
		];
		const findings = [
			finding({ id: "f-1", severity: "critical", status: "ignored" }),
			finding({ id: "f-2", severity: "medium" }),
			finding({ id: "f-3", severity: "low" }),
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-old"),
			now: NOW,
			resolvedFindings: findings,
		});
		ok(!plan.messages[0].text.includes("crítica"), "Should not say crítica");
		ok(plan.messages[0].text.includes("warning"), "Should say warnings");
		ok(plan.messages[0].text.includes("1 ya revisada"), "Should count the ignored one");
	});

	test("description appears verbatim and finding ID at bottom", () => {
		const events = [
			makeEvent({ id: "esc-1", minutesAgo: 60, critical: 1, findingIds: ["f-1"] }),
		];
		const findings = [
			finding({
				id: "f-1",
				severity: "critical",
				title: "Critical bug",
				description: "The full description that should appear verbatim in the message.",
				filePath: "src/a.ts",
			}),
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-old"),
			now: NOW,
			resolvedFindings: findings,
		});
		const text = plan.messages[0].text;
		ok(text.includes("The full description that should appear verbatim"), "Description verbatim");
		ok(text.includes("f-1"), "Finding ID present");
		// ID should be after the foot line
		const idPos = text.lastIndexOf("f-1");
		const footPos = text.lastIndexOf("─");
		ok(idPos > footPos, "ID should be after foot");
	});

	test("message stays under 800 chars budget", () => {
		const events = [
			makeEvent({ id: "esc-1", minutesAgo: 60, critical: 1, findingIds: ["f-1"] }),
		];
		const longDesc = "A".repeat(900); // longer than budget
		const findings = [
			finding({
				id: "f-1",
				severity: "critical",
				description: longDesc,
			}),
		];
		const plan = planDelivery({
			events,
			deliveredIds: deliveredSet("esc-old"),
			now: NOW,
			resolvedFindings: findings,
		});
		ok(plan.messages[0].text.length <= 800, `Should be ≤800, got ${plan.messages[0].text.length}`);
		ok(plan.messages[0].text.includes("…"), "Should include ellipsis when description is cut");
	});
});

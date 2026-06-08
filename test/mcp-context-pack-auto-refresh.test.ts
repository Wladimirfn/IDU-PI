import assert from "node:assert/strict";
import test from "node:test";
import {
	autoRefreshMcpContextPack,
	shouldAutoRefreshMcpContextPack,
} from "../src/mcp-context-pack-auto-refresh.js";

test("shouldAutoRefreshMcpContextPack retorna false si staleness=fresh", () => {
	const r = shouldAutoRefreshMcpContextPack({
		staleness: "fresh",
		iduActive: true,
		planApproved: true,
		now: new Date("2026-06-08T12:00:00Z"),
		lastRefreshMs: Date.parse("2026-06-08T11:55:00Z"),
		minStaleMs: 10 * 60_000,
		cooldownMs: 10 * 60_000,
	});
	assert.equal(r.shouldRefresh, false);
	assert.equal(r.reason, "fresh");
});

test("shouldAutoRefreshMcpContextPack retorna false si iduActive=false", () => {
	const r = shouldAutoRefreshMcpContextPack({
		staleness: "stale",
		iduActive: false,
		planApproved: true,
		now: new Date("2026-06-08T12:00:00Z"),
		lastRefreshMs: Date.parse("2026-06-08T11:30:00Z"),
		minStaleMs: 10 * 60_000,
		cooldownMs: 10 * 60_000,
	});
	assert.equal(r.shouldRefresh, false);
	assert.equal(r.reason, "idu_inactive");
});

test("shouldAutoRefreshMcpContextPack retorna false si planApproved=false", () => {
	const r = shouldAutoRefreshMcpContextPack({
		staleness: "stale",
		iduActive: true,
		planApproved: false,
		now: new Date("2026-06-08T12:00:00Z"),
		lastRefreshMs: Date.parse("2026-06-08T11:30:00Z"),
		minStaleMs: 10 * 60_000,
		cooldownMs: 10 * 60_000,
	});
	assert.equal(r.shouldRefresh, false);
	assert.equal(r.reason, "plan_not_approved");
});

test("shouldAutoRefreshMcpContextPack retorna true cuando stale + iduActive + planApproved", () => {
	const r = shouldAutoRefreshMcpContextPack({
		staleness: "stale",
		iduActive: true,
		planApproved: true,
		now: new Date("2026-06-08T12:00:00Z"),
		lastRefreshMs: Date.parse("2026-06-08T11:30:00Z"),
		minStaleMs: 10 * 60_000,
		cooldownMs: 10 * 60_000,
	});
	assert.equal(r.shouldRefresh, true);
	assert.equal(r.reason, "stale_and_ready");
	assert.equal(r.elapsedMs, 30 * 60_000);
});

test("shouldAutoRefreshMcpContextPack respeta cooldown", () => {
	const r = shouldAutoRefreshMcpContextPack({
		staleness: "stale",
		iduActive: true,
		planApproved: true,
		now: new Date("2026-06-08T12:00:00Z"),
		lastRefreshMs: Date.parse("2026-06-08T11:55:00Z"),
		minStaleMs: 5 * 60_000,
		cooldownMs: 20 * 60_000,
	});
	assert.equal(r.shouldRefresh, false);
	assert.equal(r.reason, "cooldown_active");
	assert.equal(r.cooldownRemainingMs, 15 * 60_000);
});

test("shouldAutoRefreshMcpContextPack maneja staleness=missing", () => {
	const r = shouldAutoRefreshMcpContextPack({
		staleness: "missing",
		iduActive: true,
		planApproved: true,
		now: new Date("2026-06-08T12:00:00Z"),
		lastRefreshMs: undefined,
		minStaleMs: 10 * 60_000,
		cooldownMs: 10 * 60_000,
	});
	assert.equal(r.shouldRefresh, true);
	assert.equal(r.reason, "missing_and_ready");
});

test("autoRefreshMcpContextPack retorna result esperado y emite evento", async () => {
	const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
	const r = await autoRefreshMcpContextPack({
		stateRoot: "C:/Users/elmas/Documents/bridge-agents/projects/idu-pi",
		projectId: "idu-pi",
		now: new Date("2026-06-08T12:00:00Z"),
		emit: (type, payload) => {
			events.push({ type, payload });
		},
		generatePack: () => ({
			summary: "ok",
			generatedAt: "2026-06-08T12:00:00Z",
		}),
	});
	assert.equal(r.refreshed, true);
	assert.equal(r.eventType, "idu_supervisor_context_pack_auto_refreshed");
	assert.equal(events.length, 1);
	assert.equal(events[0].type, "idu_supervisor_context_pack_auto_refreshed");
});

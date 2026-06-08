import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type McpContextPackStaleness = "fresh" | "stale" | "missing";

export interface ShouldAutoRefreshInput {
	staleness: McpContextPackStaleness;
	iduActive: boolean;
	planApproved: boolean;
	now: Date;
	lastRefreshMs: number | undefined;
	minStaleMs: number;
	cooldownMs: number;
}

export interface ShouldAutoRefreshResult {
	shouldRefresh: boolean;
	reason: string;
	elapsedMs?: number;
	cooldownRemainingMs?: number;
}

export function shouldAutoRefreshMcpContextPack(
	input: ShouldAutoRefreshInput,
): ShouldAutoRefreshResult {
	if (input.staleness === "fresh") {
		return { shouldRefresh: false, reason: "fresh" };
	}
	if (!input.iduActive) {
		return { shouldRefresh: false, reason: "idu_inactive" };
	}
	if (!input.planApproved) {
		return { shouldRefresh: false, reason: "plan_not_approved" };
	}
	const nowMs = input.now.getTime();
	const lastMs = input.lastRefreshMs;
	if (lastMs !== undefined) {
		const elapsedMs = Math.max(0, nowMs - lastMs);
		if (elapsedMs < input.minStaleMs) {
			return { shouldRefresh: false, reason: "not_old_enough", elapsedMs };
		}
		if (elapsedMs < input.cooldownMs) {
			return {
				shouldRefresh: false,
				reason: "cooldown_active",
				cooldownRemainingMs: input.cooldownMs - elapsedMs,
			};
		}
		return {
			shouldRefresh: true,
			reason: input.staleness === "missing" ? "missing_and_ready" : "stale_and_ready",
			elapsedMs,
		};
	}
	return { shouldRefresh: true, reason: "missing_and_ready" };
}

export interface AutoRefreshEventEmitter {
	emit(type: string, payload: Record<string, unknown>): void;
}

export interface AutoRefreshInput {
	stateRoot: string;
	projectId: string;
	now: Date;
	emit: AutoRefreshEventEmitter["emit"];
	generatePack: () => Record<string, unknown>;
	eventType?: string;
	eventLogPath?: string;
}

export interface AutoRefreshResult {
	refreshed: boolean;
	eventType: string;
	packPath: string;
}

export function autoRefreshMcpContextPack(
	input: AutoRefreshInput,
): AutoRefreshResult {
	const eventType =
		input.eventType ?? "idu_supervisor_context_pack_auto_refreshed";
	const packPath =
		input.eventLogPath ??
		join(input.stateRoot, "events", "mcp-context-pack-auto-refresh.json");
	const pack = input.generatePack();
	mkdirSync(dirname(packPath), { recursive: true });
	writeFileSync(
		packPath,
		`${JSON.stringify({ ...pack, refreshedAt: input.now.toISOString() }, null, "\t")}\n`,
		"utf8",
	);
	input.emit(eventType, {
		projectId: input.projectId,
		packPath,
		generatedAt: input.now.toISOString(),
	});
	return { refreshed: true, eventType, packPath };
}

export function readAutoRefreshPack(
	stateRoot: string,
	logPath?: string,
): Record<string, unknown> | undefined {
	const path = logPath ?? join(stateRoot, "events", "mcp-context-pack-auto-refresh.json");
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

import { appendEvent } from "./event-bus.js";
import {
	autoRefreshMcpContextPack,
	readAutoRefreshPack,
	shouldAutoRefreshMcpContextPack,
} from "./mcp-context-pack-auto-refresh.js";

const MIN_STALE_MS = 10 * 60_000;
const COOLDOWN_MS = 10 * 60_000;

export type RunMcpContextPackAutoRefreshInput = {
	stateRoot: string;
	projectId: string;
	iduActive: boolean;
	now?: Date;
};

export type RunMcpContextPackAutoRefreshResult = {
	ran: boolean;
	shouldRefresh: boolean;
	reason: string;
	elapsedMs?: number;
	cooldownRemainingMs?: number;
	packPath?: string;
};

export function classifyMcpContextPackStalenessFromEvents(
	stateRoot: string,
	now: Date,
): "fresh" | "stale" | "missing" {
	const pack = readAutoRefreshPack(stateRoot);
	if (!pack) return "missing";
	const refreshedAt =
		typeof pack.refreshedAt === "string" ? pack.refreshedAt : undefined;
	if (!refreshedAt) return "missing";
	const ms = Date.parse(refreshedAt);
	if (!Number.isFinite(ms)) return "missing";
	const ageMs = now.getTime() - ms;
	return ageMs >= MIN_STALE_MS ? "stale" : "fresh";
}

export function runMcpContextPackAutoRefreshTick(
	input: RunMcpContextPackAutoRefreshInput,
): RunMcpContextPackAutoRefreshResult {
	const now = input.now ?? new Date();
	const staleness = classifyMcpContextPackStalenessFromEvents(
		input.stateRoot,
		now,
	);
	const lastRefreshMs = (() => {
		const pack = readAutoRefreshPack(input.stateRoot);
		const refreshedAt =
			typeof pack?.refreshedAt === "string" ? pack.refreshedAt : undefined;
		return refreshedAt ? Date.parse(refreshedAt) : undefined;
	})();
	const decision = shouldAutoRefreshMcpContextPack({
		staleness,
		iduActive: input.iduActive,
		now,
		lastRefreshMs: Number.isFinite(lastRefreshMs) ? lastRefreshMs : undefined,
		minStaleMs: MIN_STALE_MS,
		cooldownMs: COOLDOWN_MS,
	});
	if (!decision.shouldRefresh) {
		return {
			ran: false,
			shouldRefresh: false,
			reason: decision.reason,
			elapsedMs: decision.elapsedMs,
			cooldownRemainingMs: decision.cooldownRemainingMs,
		};
	}
	const result = autoRefreshMcpContextPack({
		stateRoot: input.stateRoot,
		projectId: input.projectId,
		now,
		emit: (type, payload) => {
			appendEvent(input.stateRoot, {
				ts: now.toISOString(),
				kind: type,
				projectId: input.projectId,
				payload,
				sourceRef: "mcp-context-pack-auto-refresh",
				evidenceRefs: [],
			});
		},
		generatePack: () => ({
			staleness,
			elapsedMs: decision.elapsedMs,
			reason: decision.reason,
		}),
	});
	return {
		ran: true,
		shouldRefresh: true,
		reason: decision.reason,
		elapsedMs: decision.elapsedMs,
		packPath: result.packPath,
	};
}

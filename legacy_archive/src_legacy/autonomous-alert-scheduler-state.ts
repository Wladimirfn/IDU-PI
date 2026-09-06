import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type AutonomousAlertSchedulerLock = {
	ownerId: string;
	acquiredAt: string;
	expiresAt: string;
};

export type AutonomousAlertSchedulerState = {
	version: 1;
	lock?: AutonomousAlertSchedulerLock;
	lastRunAt?: string;
	lastStatus?: string;
	createdTaskIds: Record<string, string>;
	updatedAt: string;
};

export type AutonomousAlertSchedulerLockResult = {
	acquired: boolean;
	reason: "acquired" | "locked";
	state: AutonomousAlertSchedulerState;
};

export function resolveAutonomousAlertSchedulerStatePath(
	stateRoot: string,
): string {
	return join(stateRoot, "reports", "autonomous-alert-scheduler-state.json");
}

export function readAutonomousAlertSchedulerState(
	stateRoot: string,
	now = new Date(),
): AutonomousAlertSchedulerState {
	const filePath = resolveAutonomousAlertSchedulerStatePath(stateRoot);
	if (!existsSync(filePath)) return emptyState(now);
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		return isState(parsed) ? parsed : emptyState(now);
	} catch {
		return emptyState(now);
	}
}

export function acquireAutonomousAlertSchedulerLock(
	stateRoot: string,
	input: { ownerId: string; now?: Date; leaseMs?: number },
): AutonomousAlertSchedulerLockResult {
	const now = input.now ?? new Date();
	const leaseMs = input.leaseMs ?? 5 * 60 * 1000;
	const state = readAutonomousAlertSchedulerState(stateRoot, now);
	if (
		state.lock &&
		state.lock.ownerId !== input.ownerId &&
		Date.parse(state.lock.expiresAt) > now.getTime()
	) {
		return { acquired: false, reason: "locked", state };
	}
	state.lock = {
		ownerId: input.ownerId,
		acquiredAt: now.toISOString(),
		expiresAt: new Date(now.getTime() + leaseMs).toISOString(),
	};
	state.updatedAt = now.toISOString();
	writeState(stateRoot, state);
	return { acquired: true, reason: "acquired", state };
}

export function markAutonomousAlertDecisionTaskCreated(
	stateRoot: string,
	decisionId: string,
	taskId: string,
	now = new Date(),
): AutonomousAlertSchedulerState {
	const state = readAutonomousAlertSchedulerState(stateRoot, now);
	state.createdTaskIds[decisionId] = taskId;
	state.lastRunAt = now.toISOString();
	state.lastStatus = "task_created";
	state.updatedAt = now.toISOString();
	writeState(stateRoot, state);
	return state;
}

export function finishAutonomousAlertSchedulerRun(
	stateRoot: string,
	input: { ownerId: string; status: string; now?: Date },
): AutonomousAlertSchedulerState {
	const now = input.now ?? new Date();
	const state = readAutonomousAlertSchedulerState(stateRoot, now);
	if (state.lock?.ownerId === input.ownerId) delete state.lock;
	state.lastRunAt = now.toISOString();
	state.lastStatus = input.status;
	state.updatedAt = now.toISOString();
	writeState(stateRoot, state);
	return state;
}

function writeState(
	stateRoot: string,
	state: AutonomousAlertSchedulerState,
): void {
	const filePath = resolveAutonomousAlertSchedulerStatePath(stateRoot);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(state, null, "\t")}\n`, "utf8");
}

function emptyState(now: Date): AutonomousAlertSchedulerState {
	return {
		version: 1,
		createdTaskIds: {},
		updatedAt: now.toISOString(),
	};
}

function isState(value: unknown): value is AutonomousAlertSchedulerState {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		record.version === 1 &&
		(typeof record.lock === "undefined" || isLock(record.lock)) &&
		(typeof record.lastRunAt === "undefined" ||
			typeof record.lastRunAt === "string") &&
		(typeof record.lastStatus === "undefined" ||
			typeof record.lastStatus === "string") &&
		isStringRecord(record.createdTaskIds) &&
		typeof record.updatedAt === "string"
	);
}

function isLock(value: unknown): value is AutonomousAlertSchedulerLock {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.ownerId === "string" &&
		typeof record.acquiredAt === "string" &&
		typeof record.expiresAt === "string"
	);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		Boolean(value && typeof value === "object" && !Array.isArray(value)) &&
		Object.values(value as Record<string, unknown>).every(
			(item) => typeof item === "string",
		)
	);
}

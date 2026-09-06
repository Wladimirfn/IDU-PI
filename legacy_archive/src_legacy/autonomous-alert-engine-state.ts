import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type {
	AutonomousAlertControlState,
	AutonomousAlertDecision,
} from "./autonomous-alert-engine.js";

export type AutonomousAlertEngineState = {
	version: 1;
	control: AutonomousAlertControlState;
	cooldowns: Record<string, string>;
	createdTaskIds: Record<string, string>;
	updatedAt: string;
};

export function resolveAutonomousAlertEngineStatePath(
	stateRoot: string,
): string {
	return join(stateRoot, "reports", "autonomous-alert-engine-state.json");
}

export function resolveAutonomousAlertDecisionLogPath(
	stateRoot: string,
): string {
	return join(stateRoot, "reports", "autonomous-alert-decisions.jsonl");
}

export function defaultAutonomousAlertControlState(
	now: Date,
): AutonomousAlertControlState {
	return {
		version: 1,
		active: true,
		disabledDomains: [],
		updatedAt: now.toISOString(),
	};
}

export function readAutonomousAlertEngineState(
	stateRoot: string,
	now = new Date(),
): AutonomousAlertEngineState {
	const filePath = resolveAutonomousAlertEngineStatePath(stateRoot);
	if (!existsSync(filePath)) return emptyState(now);
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
		if (!isState(parsed)) return emptyState(now);
		return parsed;
	} catch {
		return emptyState(now);
	}
}

export function updateAutonomousAlertControlState(
	stateRoot: string,
	patch: Partial<
		Pick<
			AutonomousAlertControlState,
			"active" | "pausedUntil" | "disabledDomains" | "reason"
		>
	>,
	now = new Date(),
): AutonomousAlertEngineState {
	const state = readAutonomousAlertEngineState(stateRoot, now);
	state.control = {
		...state.control,
		...(typeof patch.active === "boolean" ? { active: patch.active } : {}),
		...(patch.pausedUntil ? { pausedUntil: patch.pausedUntil } : {}),
		...(patch.disabledDomains
			? { disabledDomains: [...new Set(patch.disabledDomains)] }
			: {}),
		...(patch.reason ? { reason: patch.reason } : {}),
		updatedAt: now.toISOString(),
	};
	state.updatedAt = now.toISOString();
	writeState(stateRoot, state);
	return state;
}

export function appendAutonomousAlertDecision(
	stateRoot: string,
	decision: AutonomousAlertDecision,
	now = new Date(),
): AutonomousAlertEngineState {
	const state = readAutonomousAlertEngineState(stateRoot, now);
	state.cooldowns[decision.cooldownKey] = new Date(
		now.getTime() + 24 * 60 * 60 * 1000,
	).toISOString();
	state.updatedAt = now.toISOString();
	writeState(stateRoot, state);
	const logPath = resolveAutonomousAlertDecisionLogPath(stateRoot);
	mkdirSync(dirname(logPath), { recursive: true });
	appendFileSync(logPath, `${JSON.stringify(decision)}\n`, "utf8");
	return state;
}

function writeState(
	stateRoot: string,
	state: AutonomousAlertEngineState,
): void {
	const filePath = resolveAutonomousAlertEngineStatePath(stateRoot);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(state, null, "\t")}\n`, "utf8");
}

function emptyState(now: Date): AutonomousAlertEngineState {
	return {
		version: 1,
		control: defaultAutonomousAlertControlState(now),
		cooldowns: {},
		createdTaskIds: {},
		updatedAt: now.toISOString(),
	};
}

function isState(value: unknown): value is AutonomousAlertEngineState {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		record.version === 1 &&
		isControl(record.control) &&
		isStringRecord(record.cooldowns) &&
		isStringRecord(record.createdTaskIds) &&
		typeof record.updatedAt === "string"
	);
}

function isControl(value: unknown): value is AutonomousAlertControlState {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		record.version === 1 &&
		typeof record.active === "boolean" &&
		Array.isArray(record.disabledDomains) &&
		record.disabledDomains.every((item) => typeof item === "string") &&
		typeof record.updatedAt === "string" &&
		(typeof record.pausedUntil === "undefined" ||
			typeof record.pausedUntil === "string") &&
		(typeof record.reason === "undefined" || typeof record.reason === "string")
	);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return false;
	}
	return Object.values(value as Record<string, unknown>).every(
		(item) => typeof item === "string",
	);
}

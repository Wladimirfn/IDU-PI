import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type SchedulerLockInfo = {
	ownerId: string;
	acquiredAt: string;
	expiresAt: string;
};

export type SchedulerStateLike = {
	lock?: SchedulerLockInfo;
};

export type FormatScheduledTickSkippedDetailInput = {
	stateRoot: string;
	now: Date;
	schedulerStatePath?: string;
};

function readSchedulerState(stateRoot: string, path?: string): SchedulerStateLike | undefined {
	const resolved = path ?? join(stateRoot, "reports", "autonomous-alert-scheduler-state.json");
	if (!existsSync(resolved)) return undefined;
	try {
		return JSON.parse(readFileSync(resolved, "utf8")) as SchedulerStateLike;
	} catch {
		return undefined;
	}
}

function lockIsActive(lock: SchedulerLockInfo | undefined, now: Date): lock is SchedulerLockInfo {
	if (!lock) return false;
	const expiresMs = Date.parse(lock.expiresAt);
	if (!Number.isFinite(expiresMs)) return false;
	return expiresMs > now.getTime();
}

export function formatScheduledTickSkippedDetail(
	input: FormatScheduledTickSkippedDetailInput,
): string {
	const state = readSchedulerState(input.stateRoot, input.schedulerStatePath);
	if (!state?.lock) return "";
	if (!lockIsActive(state.lock, input.now)) return "";
	const expiresInMs = Date.parse(state.lock.expiresAt) - input.now.getTime();
	const minutes = Math.max(0, Math.round(expiresInMs / 60_000));
	return `skipped_detail: lock activo owner=${state.lock.ownerId} acquiredAt=${state.lock.acquiredAt} expiresAt=${state.lock.expiresAt} (quedan ${minutes} min); sugiera: alerts-scheduled-tick --force=true o aguarde ${minutes} min`;
}

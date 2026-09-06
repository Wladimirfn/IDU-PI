import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Supervisor trigger (scheduled-tick user opt-in).
 *
 * The `scripts/idu-supervisor-tick.ps1` script reads
 * `<stateRoot>/supervisor-trigger.json` and skips the tick cycle
 * when the user has explicitly disabled the scheduled trigger from
 * the TUI "Configurar IDU-Pi" sub-menu.
 *
 * The default state, when no file exists, is "enabled" — the tick
 * script proceeds normally. This matches the historical behaviour
 * before this opt-in was added.
 *
 * This module is intentionally tiny and side-effect-free: it
 * reads/writes a single JSON file under the project's stateRoot.
 * It is not lab.db-bound and does NOT emit a `lab_write` event.
 */

export const SUPERVISOR_TRIGGER_FILENAME = "supervisor-trigger.json";

export type SupervisorTriggerState = {
	enabled: boolean;
	updatedAt: string;
	source?: "cli" | "tui";
	note?: string;
};

export type SupervisorTriggerFile = SupervisorTriggerState & {
	version: 1;
};

export type SupervisorTriggerStatus = {
	path: string;
	exists: boolean;
	enabled: boolean;
	updatedAt?: string;
	source?: "cli" | "tui";
	note?: string;
};

export type SupervisorTriggerResult = {
	path: string;
	state: SupervisorTriggerFile;
	previous: SupervisorTriggerFile | null;
	changed: boolean;
};

export function supervisorTriggerPath(stateRoot: string): string {
	return join(resolve(stateRoot), SUPERVISOR_TRIGGER_FILENAME);
}

export function readSupervisorTriggerFile(
	stateRoot: string,
): SupervisorTriggerFile | null {
	const path = supervisorTriggerPath(stateRoot);
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			typeof parsed.enabled === "boolean"
		) {
			return {
				version: 1,
				enabled: parsed.enabled,
				updatedAt:
					typeof parsed.updatedAt === "string"
						? parsed.updatedAt
						: new Date(0).toISOString(),
				source:
					parsed.source === "cli" || parsed.source === "tui"
						? parsed.source
						: undefined,
				note:
					typeof parsed.note === "string" ? parsed.note : undefined,
			};
		}
		return null;
	} catch {
		return null;
	}
}

export function getSupervisorTriggerStatus(
	stateRoot: string,
): SupervisorTriggerStatus {
	const path = supervisorTriggerPath(stateRoot);
	const file = readSupervisorTriggerFile(stateRoot);
	if (!file) {
		return {
			path,
			exists: false,
			enabled: true,
		};
	}
	return {
		path,
		exists: true,
		enabled: file.enabled,
		updatedAt: file.updatedAt,
		source: file.source,
		note: file.note,
	};
}

function setSupervisorTrigger(
	stateRoot: string,
	enabled: boolean,
	options: { now?: Date; source?: "cli" | "tui"; note?: string } = {},
): SupervisorTriggerResult {
	const path = supervisorTriggerPath(stateRoot);
	const previous = readSupervisorTriggerFile(stateRoot);
	const next: SupervisorTriggerFile = {
		version: 1,
		enabled,
		updatedAt: (options.now ?? new Date()).toISOString(),
		source: options.source,
		note: options.note,
	};
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return {
		path,
		state: next,
		previous,
		changed:
			previous === null ||
			previous.enabled !== next.enabled ||
			previous.updatedAt !== next.updatedAt,
	};
}

export function enableSupervisorTrigger(
	stateRoot: string,
	options: { now?: Date; source?: "cli" | "tui"; note?: string } = {},
): SupervisorTriggerResult {
	return setSupervisorTrigger(stateRoot, true, options);
}

export function disableSupervisorTrigger(
	stateRoot: string,
	options: { now?: Date; source?: "cli" | "tui"; note?: string } = {},
): SupervisorTriggerResult {
	return setSupervisorTrigger(stateRoot, false, options);
}

export function formatSupervisorTriggerStatus(
	status: SupervisorTriggerStatus,
): string {
	if (!status.exists) {
		return [
			"Supervisor trigger",
			"",
			`path: ${status.path}`,
			"state: enabled (default — no file present)",
		].join("\n");
	}
	return [
		"Supervisor trigger",
		"",
		`path: ${status.path}`,
		`state: ${status.enabled ? "enabled" : "disabled"}`,
		`updatedAt: ${status.updatedAt ?? "—"}`,
		...(status.source ? [`source: ${status.source}`] : []),
		...(status.note ? [`note: ${status.note}`] : []),
	].join("\n");
}

export function formatSupervisorTriggerResult(
	result: SupervisorTriggerResult,
): string {
	return [
		"Supervisor trigger",
		"",
		`path: ${result.path}`,
		`state: ${result.state.enabled ? "enabled" : "disabled"}`,
		`updatedAt: ${result.state.updatedAt}`,
		`changed: ${result.changed ? "yes" : "no"}`,
		...(result.previous
			? [
					`previous: enabled=${result.previous.enabled}, updatedAt=${result.previous.updatedAt}`,
				]
			: []),
	].join("\n");
}

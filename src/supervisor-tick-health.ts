import { execFile as nodeExecFile } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const SUPERVISOR_TICK_TASK_NAME = "Idu-pi Supervisor Tick";
export const SUPERVISOR_TICK_POWERSHELL_COMMAND = "powershell.exe";

const POWERSHELL_QUERY = [
	"$ErrorActionPreference = 'Stop'",
	`$task = Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -eq '${SUPERVISOR_TICK_TASK_NAME}' } | Select-Object -First 1`,
	"if ($null -eq $task) { [pscustomobject]@{ exists = $false } | ConvertTo-Json -Compress; exit 0 }",
	"$info = Get-ScheduledTaskInfo -InputObject $task -ErrorAction Stop",
	"function Format-Date($value) { if ($null -eq $value -or $value -eq [datetime]::MinValue) { return $null }; return $value.ToString('o') }",
	"[pscustomobject]@{ exists = $true; state = $task.State.ToString(); lastRunTime = Format-Date $info.LastRunTime; nextRunTime = Format-Date $info.NextRunTime; lastTaskResult = $info.LastTaskResult; numberOfMissedRuns = $info.NumberOfMissedRuns } | ConvertTo-Json -Compress",
].join("; ");

export const SUPERVISOR_TICK_POWERSHELL_ARGS: readonly string[] = [
	"-NoProfile",
	"-NonInteractive",
	"-Command",
	POWERSHELL_QUERY,
];

export type SupervisorTickSnapshot = {
	exists: boolean;
	state?: string;
	lastRunTime?: string;
	nextRunTime?: string;
	lastTaskResult?: number;
	numberOfMissedRuns?: number;
};

export type SupervisorTickHealthObservation = {
	health: "HEALTHY" | "DOWN" | "UNKNOWN";
	reason: string;
	snapshot?: SupervisorTickSnapshot;
};

type PersistedSupervisorTickHealth = {
	observedHealth: "HEALTHY" | "DOWN";
	observedAt: string;
	evidence: SupervisorTickSnapshot;
	reason: string;
	lastNotifiedHealth?: "HEALTHY" | "DOWN";
	lastNotifiedAt?: string;
	lastNotifiedEvidence?: SupervisorTickSnapshot;
	lastNotifiedReason?: string;
	/** Consecutive DOWN observations seen. Used for the 2-observation debounce. */
	consecutiveDown?: number;
};

type ExecFile = (
	command: string,
	args: readonly string[],
	options: { timeout: number; windowsHide: boolean; maxBuffer: number },
) => Promise<{ stdout: string }>;

export type SupervisorTickHealthCheckResult = {
	health: SupervisorTickHealthObservation["health"];
	action: "unknown" | "baseline" | "none" | "pending" | "sent" | "disabled";
};

const HEALTH_STATE_FILE = "supervisor-tick-health.json";
const NEXT_RUN_HORIZON_MS = 75 * 60_000;
const QUERY_TIMEOUT_MS = 10_000;

/**
 * A single DOWN observation must not alert. Queued (the normal state between
 * a trigger firing and execution starting), a wake-from-suspend, or a slow
 * WMI query could each be captured at the wrong instant; two consecutive DOWN
 * observations are required before alerting. Cost: one 15-minute interval on
 * a task that runs hourly — free. Recovery stays immediate (a false
 * "recovered" costs nothing), so it is not debounced.
 */
const DOWN_DEBOUNCE_OBSERVATIONS = 2;

function optionalDate(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (!trimmed || /^0001-01-01T00:00:00/iu.test(trimmed)) return undefined;
	return trimmed;
}

export function parseSupervisorTickSnapshot(
	stdout: string,
): SupervisorTickSnapshot | undefined {
	try {
		const value = JSON.parse(stdout) as Record<string, unknown>;
		if (!value || Array.isArray(value) || typeof value.exists !== "boolean") {
			return undefined;
		}
		if (value.exists && typeof value.state !== "string") return undefined;
		if (
			value.lastTaskResult !== undefined &&
			(typeof value.lastTaskResult !== "number" || !Number.isFinite(value.lastTaskResult))
		) {
			return undefined;
		}
		if (
			value.numberOfMissedRuns !== undefined &&
			(typeof value.numberOfMissedRuns !== "number" ||
				!Number.isFinite(value.numberOfMissedRuns))
		) {
			return undefined;
		}
		return {
			exists: value.exists,
			...(typeof value.state === "string" ? { state: value.state } : {}),
			...(optionalDate(value.lastRunTime)
				? { lastRunTime: optionalDate(value.lastRunTime) }
				: {}),
			...(optionalDate(value.nextRunTime)
				? { nextRunTime: optionalDate(value.nextRunTime) }
				: {}),
			...(typeof value.lastTaskResult === "number"
				? { lastTaskResult: value.lastTaskResult }
				: {}),
			...(typeof value.numberOfMissedRuns === "number"
				? { numberOfMissedRuns: value.numberOfMissedRuns }
				: {}),
		};
	} catch {
		return undefined;
	}
}

export function classifySupervisorTickSnapshot(
	snapshot: SupervisorTickSnapshot,
	now: Date,
): SupervisorTickHealthObservation {
	if (!snapshot.exists) {
		return { health: "DOWN", reason: "La tarea no existe.", snapshot };
	}
	if (
		snapshot.state !== "Ready" &&
		snapshot.state !== "Running" &&
		snapshot.state !== "Queued"
	) {
		return {
			health: "DOWN",
			reason: `State inesperado: ${snapshot.state ?? "N/A"}.`,
			snapshot,
		};
	}

	// NextRunTime is required because this is specifically the hourly Supervisor
	// Tick. Logon tasks such as Telegram Bridge legitimately have no next run.
	// Queued is a healthy state: it is the normal bridge between a trigger
	// firing and execution starting, so it joins Ready/Running here.
	if (!snapshot.nextRunTime) {
		return { health: "DOWN", reason: "NextRunTime no está disponible.", snapshot };
	}
	if (snapshot.nextRunTime) {
		const nextRunMs = new Date(snapshot.nextRunTime).getTime();
		if (
			!Number.isFinite(nextRunMs) ||
			nextRunMs <= now.getTime() ||
			nextRunMs > now.getTime() + NEXT_RUN_HORIZON_MS
		) {
			return {
				health: "DOWN",
				reason: "NextRunTime está fuera del horizonte horario de 75 minutos.",
				snapshot,
			};
		}
	}
	return { health: "HEALTHY", reason: "La próxima ejecución está programada.", snapshot };
}

const defaultExecFile: ExecFile = (command, args, options) =>
	new Promise((resolve, reject) => {
		nodeExecFile(command, [...args], options, (error, stdout) => {
			if (error) reject(error);
			else resolve({ stdout });
		});
	});

export async function querySupervisorTickHealth(
	now: Date,
	deps: { platform?: NodeJS.Platform; execFile?: ExecFile } = {},
): Promise<SupervisorTickHealthObservation> {
	if ((deps.platform ?? process.platform) !== "win32") {
		return { health: "UNKNOWN", reason: "Plataforma no compatible." };
	}
	try {
		const result = await (deps.execFile ?? defaultExecFile)(
			SUPERVISOR_TICK_POWERSHELL_COMMAND,
			SUPERVISOR_TICK_POWERSHELL_ARGS,
			{ timeout: QUERY_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 },
		);
		const snapshot = parseSupervisorTickSnapshot(result.stdout);
		if (!snapshot) return { health: "UNKNOWN", reason: "JSON inválido." };
		return classifySupervisorTickSnapshot(snapshot, now);
	} catch (error) {
		return {
			health: "UNKNOWN",
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}

function readState(path: string): PersistedSupervisorTickHealth | undefined {
	if (!existsSync(path)) return undefined;
	return JSON.parse(readFileSync(path, "utf8")) as PersistedSupervisorTickHealth;
}

function atomicWriteJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
		renameSync(temporaryPath, path);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}

function formatMessage(
	health: "HEALTHY" | "DOWN",
	reason: string,
	snapshot: SupervisorTickSnapshot,
): string {
	const heading =
		health === "DOWN"
			? "Alerta: la tarea del Supervisor Tick está caída."
			: "La tarea del Supervisor Tick fue recuperada.";
	return [
		heading,
		`Tarea: ${SUPERVISOR_TICK_TASK_NAME}`,
		`Motivo: ${reason}`,
		`State: ${snapshot.state ?? (snapshot.exists ? "N/A" : "Missing")}`,
		`NextRunTime: ${snapshot.nextRunTime ?? "N/A"}`,
		`LastTaskResult: ${snapshot.lastTaskResult ?? "N/A"}`,
		`MissedRuns: ${snapshot.numberOfMissedRuns ?? "N/A"}`,
	].join("\n");
}

export class SupervisorTickHealthMonitor {
	private disabled = false;

	constructor(
		private readonly deps: {
			query?: (now: Date) => Promise<SupervisorTickHealthObservation>;
			canSend: () => boolean;
			sendMessage: (text: string) => Promise<void>;
			onMessageSent: () => void;
			writeState?: (path: string, value: unknown) => void;
		},
	) {}

	async check(args: {
		stateRoot: string;
		now?: Date;
	}): Promise<SupervisorTickHealthCheckResult> {
		if (this.disabled) return { health: "UNKNOWN", action: "disabled" };
		const now = args.now ?? new Date();
		const observation = await (this.deps.query ?? querySupervisorTickHealth)(now);
		if (observation.health === "UNKNOWN" || !observation.snapshot) {
			return { health: "UNKNOWN", action: "unknown" };
		}

		const path = join(args.stateRoot, HEALTH_STATE_FILE);
		const previous = readState(path);
		const observedAt = now.toISOString();
		const consecutiveDown =
			observation.health === "DOWN"
				? (previous?.consecutiveDown ?? 0) + 1
				: 0;
		const nextState: PersistedSupervisorTickHealth = {
			...previous,
			observedHealth: observation.health,
			observedAt,
			evidence: observation.snapshot,
			reason: observation.reason,
			consecutiveDown,
		};
		const writeState = this.deps.writeState ?? atomicWriteJson;

		// First-ever HEALTHY: baseline only, no message.
		if (!previous && observation.health === "HEALTHY") {
			nextState.lastNotifiedHealth = "HEALTHY";
			nextState.lastNotifiedAt = observedAt;
			nextState.lastNotifiedEvidence = observation.snapshot;
			nextState.lastNotifiedReason = observation.reason;
			writeState(path, nextState);
			return { health: observation.health, action: "baseline" };
		}

		// No change from what was last notified (repeated HEALTHY, or repeated
		// DOWN after DOWN was delivered): nothing to report.
		if (previous?.lastNotifiedHealth === observation.health) {
			return { health: observation.health, action: "none" };
		}

		// Recovery: DOWN was delivered, now HEALTHY. Immediate — the cost of a
		// false "recovered" is zero, so recovery is not debounced.
		if (
			observation.health === "HEALTHY" &&
			previous?.lastNotifiedHealth === "DOWN"
		) {
			if (!this.deps.canSend()) {
				return { health: observation.health, action: "pending" };
			}
			try {
				await this.deps.sendMessage(
					formatMessage(observation.health, observation.reason, observation.snapshot),
				);
			} catch {
				return { health: observation.health, action: "pending" };
			}
			this.deps.onMessageSent();
			nextState.lastNotifiedHealth = "HEALTHY";
			nextState.lastNotifiedAt = observedAt;
			nextState.lastNotifiedEvidence = observation.snapshot;
			nextState.lastNotifiedReason = observation.reason;
			try {
				writeState(path, nextState);
			} catch {
				this.disabled = true;
				return { health: observation.health, action: "disabled" };
			}
			return { health: observation.health, action: "sent" };
		}

		// HEALTHY while DOWN was never delivered (lastNotified is undefined):
		// record healthy, no message (no spurious recovery).
		if (observation.health === "HEALTHY") {
			nextState.lastNotifiedHealth = "HEALTHY";
			nextState.lastNotifiedAt = observedAt;
			nextState.lastNotifiedEvidence = observation.snapshot;
			nextState.lastNotifiedReason = observation.reason;
			writeState(path, nextState);
			return { health: observation.health, action: "baseline" };
		}

		// DOWN path. Persist the observation (advancing the debounce counter)
		// before deciding whether to alert.
		writeState(path, nextState);

		if (consecutiveDown < DOWN_DEBOUNCE_OBSERVATIONS) {
			return { health: observation.health, action: "pending" };
		}
		if (previous?.lastNotifiedHealth === "DOWN") {
			return { health: observation.health, action: "none" };
		}
		if (!this.deps.canSend()) {
			return { health: observation.health, action: "pending" };
		}
		try {
			await this.deps.sendMessage(
				formatMessage(observation.health, observation.reason, observation.snapshot),
			);
		} catch {
			return { health: observation.health, action: "pending" };
		}
		this.deps.onMessageSent();
		nextState.lastNotifiedHealth = "DOWN";
		nextState.lastNotifiedAt = observedAt;
		nextState.lastNotifiedEvidence = observation.snapshot;
		nextState.lastNotifiedReason = observation.reason;
		try {
			writeState(path, nextState);
		} catch {
			this.disabled = true;
			return { health: observation.health, action: "disabled" };
		}
		return { health: observation.health, action: "sent" };
	}
}

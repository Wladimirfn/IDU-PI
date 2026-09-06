/**
 * src/bridge-pidfile.ts — PID file management for bridge process liveness.
 *
 * The bridge writes its PID to `bridge.pid` in the repo root on startup.
 * Every N minutes it touches the file (utimesSync) as a heartbeat. On
 * clean shutdown it deletes the file.
 *
 * The TUI reads the file and checks:
 *   1. Does the PID exist? (process.kill(pid, 0) — pure Node, microseconds)
 *   2. Is the pidfile mtime fresh? (within 2× heartbeat interval)
 *
 * The mtime check defeats PID reuse: if the bridge crashes and Windows
 * recycles the PID, the heartbeat stops and the mtime goes stale. After
 * 2×N minutes the TUI reports "Caído" even though kill(0) succeeds —
 * closing the false-positive window that would otherwise persist
 * indefinitely.
 *
 * Verified on this machine:
 *   process.kill(deadPid, 0) → ESRCH (correct)
 *   process.kill(selfPid, 0) → OK (correct)
 *   10000 calls in 36ms = 3.6μs each (vs ~1000ms for CIM)
 */

import {
	existsSync,
	readFileSync,
	writeFileSync,
	unlinkSync,
	utimesSync,
	statSync,
} from "node:fs";
import { join } from "node:path";

const PIDFILE_NAME = "bridge.pid";

/**
 * Heartbeat interval in minutes. The bridge touches the pidfile every
 * this often. The stale threshold for the mtime check is 2× this value.
 */
export const HEARTBEAT_INTERVAL_MIN = 15;

export function pidfilePath(repoRoot: string): string {
	return join(repoRoot, PIDFILE_NAME);
}

/**
 * Write the current process PID to the pidfile. Called once on bridge
 * startup, before bot.start().
 */
export function writePidfile(repoRoot: string): void {
	writeFileSync(pidfilePath(repoRoot), String(process.pid), "utf8");
}

/**
 * Touch the pidfile mtime without changing its content. Called by the
 * heartbeat setInterval every HEARTBEAT_INTERVAL_MIN minutes.
 */
export function touchPidfile(repoRoot: string): void {
	const path = pidfilePath(repoRoot);
	if (existsSync(path)) {
		const now = new Date();
		utimesSync(path, now, now);
	}
}

/**
 * Delete the pidfile. Called on graceful shutdown and process exit.
 * Best-effort: if the file is locked or missing, the error is swallowed.
 */
export function deletePidfile(repoRoot: string): void {
	try {
		unlinkSync(pidfilePath(repoRoot));
	} catch {
		// already absent or locked — harmless either way
	}
}

export type BridgeProcessStatus = {
	/** Is the bridge process alive and the pidfile fresh? */
	running: boolean;
	/** PID from the pidfile, if it existed. */
	pid?: number;
	/** Does the pidfile exist on disk? */
	pidfileExists: boolean;
	/**
	 * Pidfile exists but is stale (mtime beyond 2× heartbeat interval).
	 * Indicates either PID reuse after crash, or a very old stale file.
	 */
	stale: boolean;
};

/**
 * Check whether the bridge process is running by reading the pidfile and
 * verifying (a) the PID exists via kill(0) and (b) the pidfile mtime is
 * within 2× the heartbeat interval.
 *
 * Pure Node — no subprocess, no CIM. ~3.6μs per call.
 */
export function checkBridgeProcess(
	repoRoot: string,
	heartbeatIntervalMin: number = HEARTBEAT_INTERVAL_MIN,
	now: Date = new Date(),
): BridgeProcessStatus {
	const path = pidfilePath(repoRoot);

	if (!existsSync(path)) {
		return { running: false, pidfileExists: false, stale: false };
	}

	let pidStr: string;
	try {
		pidStr = readFileSync(path, "utf8").trim();
	} catch {
		return { running: false, pidfileExists: true, stale: true };
	}

	const pid = parseInt(pidStr, 10);
	if (!Number.isFinite(pid) || pid <= 0) {
		return { running: false, pidfileExists: true, stale: true };
	}

	// Check if any process with this PID exists.
	let processExists = false;
	try {
		process.kill(pid, 0);
		processExists = true;
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "EPERM") {
			// Process exists but we lack permission to signal it.
			// This shouldn't happen for our own bridge process, but
			// if it does, treat as existing.
			processExists = true;
		}
		// ESRCH = no such process. processExists stays false.
	}

	if (!processExists) {
		// Bridge crashed, PID not reused. ESRCH confirms death.
		return { running: false, pid, pidfileExists: true, stale: true };
	}

	// Process exists — check heartbeat freshness to detect PID reuse.
	const staleThresholdMin = heartbeatIntervalMin * 2;
	let mtimeMs: number;
	try {
		mtimeMs = statSync(path).mtimeMs;
	} catch {
		// Can't stat — be conservative, report not running.
		return { running: false, pid, pidfileExists: true, stale: true };
	}

	const ageMin = (now.getTime() - mtimeMs) / 60_000;

	if (ageMin > staleThresholdMin) {
		// PID exists but pidfile mtime is stale. The bridge either
		// crashed and the PID was reused by another process, or the
		// heartbeat stopped for another reason. Either way: NOT running.
		return { running: false, pid, pidfileExists: true, stale: true };
	}

	return { running: true, pid, pidfileExists: true, stale: false };
}

// ---------------------------------------------------------------------------
// Combined bridge status (process + autostart)
// ---------------------------------------------------------------------------

/**
 * Read the autostart flag. Absence = enabled (default). Only exists when
 * the operator explicitly toggled autostart off from the TUI.
 */
export function readBridgeAutostartFlag(packageRoot: string): boolean {
	const flagPath = join(packageRoot, "bridge-autostart.json");
	if (!existsSync(flagPath)) return true;
	try {
		const raw = JSON.parse(readFileSync(flagPath, "utf8")) as {
			enabled?: boolean;
		};
		return raw.enabled !== false;
	} catch {
		return true;
	}
}

export type CombinedBridgeStatus = {
	processRunning: boolean;
	pid?: number;
	autostartEnabled: boolean;
	stale: boolean;
	pidfileExists: boolean;
};

export function getCombinedBridgeStatus(
	packageRoot: string,
	now: Date = new Date(),
): CombinedBridgeStatus {
	const proc = checkBridgeProcess(packageRoot, HEARTBEAT_INTERVAL_MIN, now);
	const autostartEnabled = readBridgeAutostartFlag(packageRoot);
	return {
		processRunning: proc.running,
		pid: proc.pid,
		autostartEnabled,
		stale: proc.stale,
		pidfileExists: proc.pidfileExists,
	};
}

/**
 * One-liner for the home panel. Names the state, only alarms on row 2
 * (process off + autostart on = crashed).
 *
 * Four combinations:
 *   ON  + autostart ON  → Activo
 *   OFF + autostart ON  → CAÍDO (alarm)
 *   OFF + autostart OFF → Detenido (off on purpose)
 *   ON  + autostart OFF → Activo (no sobrevive reinicio)
 */
export function formatBridgeStatusLine(status: CombinedBridgeStatus): string {
	if (status.processRunning && status.autostartEnabled) {
		return `Bridge: Activo${status.pid ? ` (PID ${status.pid})` : ""}`;
	}
	if (!status.processRunning && status.autostartEnabled) {
		return "⚠ Bridge: CAÍDO — autostart activado, debería estar corriendo";
	}
	if (!status.processRunning && !status.autostartEnabled) {
		return "Bridge: Detenido (autostart desactivado)";
	}
	// processRunning && !autostartEnabled
	return "Bridge: Activo (autostart desactivado — no sobrevive reinicio)";
}


/**
 * Named timeouts.
 *
 * These values were literals scattered across the runner, the manager, the CLI
 * and the MCP server. Several of them happen to be equal while meaning
 * different things, which is exactly the case where a bare number invites a
 * wrong edit, so each meaning gets its own name.
 */

/** Floor the runner applies when a profile declares no hard cap: four hours. */
export const HARD_CAP_FLOOR_MS = 14_400_000;

/** Default budget for a delegated run when neither the request nor the profile sets one. */
export const DEFAULT_DELEGATE_TIMEOUT_MS = 900_000;

/** How long a worker gets to produce its first output before it is considered stuck. */
export const STARTUP_GRACE_MS = 120_000;

/** How often the runner rewrites its run record while the worker is alive. */
export const DISK_SYNC_INTERVAL_MS = 10_000;

/** Grace period before a SIGTERM escalation becomes SIGKILL. */
export const KILL_ESCALATION_MS = 5_000;

/** How long the SDD guard waits for `gentle-ai sdd-attempt status`. */
export const SDD_PROBE_TIMEOUT_MS = 2_000;

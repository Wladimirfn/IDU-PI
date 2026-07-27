// src/graceful-shutdown-registry.ts
//
// Shared registry for fire-and-forget write queues that must be drained
// before process.exit(0). Each event-recording module registers its flush
// function at module load; the bridge's gracefulShutdown calls
// drainAllShutdownQueues once with a single timeout budget.
//
// Why a registry instead of an explicit list: the fire-and-forget pattern
// (Set<Promise> + void write.finally + flush export) was duplicated five
// times across the codebase. The first shutdown drain (#348) covered only
// one of the five — the other four were invisible because the defect was
// in the files the diff didn't touch. A registry makes the next queue
// impossible to forget: the module self-registers, the shutdown discovers
// all registered drains automatically.

type DrainFn = () => Promise<unknown>;

const drainFns: DrainFn[] = [];

/**
 * Register a flush function to be called during graceful shutdown.
 * Each fire-and-forget event module should call this at module load:
 *
 *   registerShutdownDrain(flushXEvents);
 */
export function registerShutdownDrain(fn: DrainFn): void {
	drainFns.push(fn);
}

/**
 * Count of registered drain functions. Used by the shutdown-registry test
 * to catch unregistered fire-and-forget queues (the "sixth queue" guard).
 */
export function getRegisteredDrainCount(): number {
	return drainFns.length;
}

/**
 * Drain all registered queues in parallel. Called by gracefulShutdown
 * with a single timeout budget (5s default) so the total drain time is
 * bounded regardless of how many queues exist.
 */
export async function drainAllShutdownQueues(): Promise<void> {
	if (drainFns.length === 0) return;
	await Promise.allSettled(drainFns.map((fn) => fn()));
}

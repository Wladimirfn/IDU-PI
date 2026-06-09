/**
 * `supervisor-main` role — T1.6 placeholder.
 *
 * The full implementation lands in Task 1.6 (TRIANGULATE/REFACTOR of
 * PR 1). This stub exists so the registry has all 13 keys at the
 * end of T1.2 (TypeScript forces this) and so the engine can
 * iterate the registry without runtime null checks.
 *
 * The stub subscribes to its real kinds and refuses to fire
 * (shouldFire returns false). It throws on `invoke` so an
 * accidental call surfaces as a clear error.
 */

import type { EventKind } from "../event-bus.js";
import type { Role, RoleId } from "./index.js";

const SUPERVISOR_MAIN_PRIORITY = 90;
const SUPERVISOR_MAIN_COOLDOWN_MS = 30_000;
const SUPERVISOR_MAIN_SUBSCRIBES: readonly EventKind[] = [
	"orchestrator_turn",
	"alerts_scheduled_tick",
	"lab_write",
];

export function createSupervisorMainRole(): Role {
	return {
		name: "Supervisor principal (pending T1.6)",
		priority: SUPERVISOR_MAIN_PRIORITY,
		cooldownMs: SUPERVISOR_MAIN_COOLDOWN_MS,
		subscribesTo: () => SUPERVISOR_MAIN_SUBSCRIBES,
		shouldFire: () => false,
		invoke: async () => {
			throw new Error(
				"supervisor-main role not yet implemented (T1.6 pending)",
			);
		},
	};
}

export const SUPERVISOR_MAIN_ROLE_ID: RoleId = "supervisor-main";

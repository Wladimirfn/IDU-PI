/**
 * Role interface + role registry for living-roles-v2.
 *
 * This module is the canonical TypeScript contract every role MUST
 * satisfy (design §3 + REQ-LRV2-1). The 13 role modules are
 * registered in `ROLE_REGISTRY` so the engine can look them up by
 * `RoleId` and so adding a new role to the `IduModelRoleId` union
 * without registering it here is a **compile error** (TypeScript
 * forces all keys in a `Record<RoleId, ...>`).
 *
 * PR 1 (slice 1) lands `supervisor-main` (Task 1.6). The remaining
 * 12 roles are placeholders swapped in by PR 2 (Tasks 2.1–2.3) and
 * PR 3 (Tasks 3.1–3.9).
 */

import { createHash } from "node:crypto";
import type { AgentRouter } from "../agent-router.js";
import type { Event, EventKind } from "../event-bus.js";
import type { LabDbRepository } from "../lab-db-repository.js";
import type { IduModelRoleId } from "../model-assignments.js";
import { createSupervisorMainRole } from "./supervisor-main.js";
import { createSupervisorSemanticRole } from "./supervisor-semantic.js";
import { createSupervisorCompactionRole } from "./supervisor-compaction.js";
import { createAgentLabSecurityRole } from "./agentlab-security.js";
import { createAgentLabArchitectureRole } from "./agentlab-architecture.js";
import { createAgentLabDatabaseRole } from "./agentlab-database.js";
import { createAgentLabUiUxRole } from "./agentlab-ui-ux.js";
import { createAgentLabPerformanceRole } from "./agentlab-performance.js";
import { createAgentLabCodeQualityRole } from "./agentlab-code-quality.js";
import { createAgentLabDocsRole } from "./agentlab-docs.js";

export type RoleId = IduModelRoleId;

export type RoleContext = {
	stateRoot: string;
	projectId: string;
	now: Date;
	router: AgentRouter;
	repository: LabDbRepository;
};

export type RoleInput = {
	event: Event;
	inputSignature: string;
	context: RoleContext;
};

export type RoleAdvisory = {
	roleId: RoleId;
	priority: number;
	ts: string;
	advisory: string;
	evidenceRefs: string[];
	meta?: Record<string, unknown>;
};

export type Role = {
	name: string;
	priority: number;
	cooldownMs: number;
	subscribesTo(): readonly EventKind[];
	shouldFire(
		input: RoleInput,
		lastFireAt: Date | undefined,
		now: Date,
	): boolean;
	invoke(input: RoleInput, ctx: RoleContext): Promise<RoleAdvisory>;
};

/**
 * Stable signature of an event payload. Used by the engine for
 * idle detection (REQ-LRV2-5): a role that fired for signature X
 * is skipped on the next event with the same X. This is separate
 * from the `eventHash` (which includes `ts`, `kind`, and
 * `sourceRef`); the signature is **only** the payload, so two
 * events with identical payloads but different metadata reuse the
 * advisory.
 */
export function computeInputSignature(event: Event): string {
	return createHash("sha1")
		.update(stableStringify(event.payload))
		.digest("hex")
		.slice(0, 16);
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableStringify(item)).join(",")}]`;
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	const parts = keys.map(
		(key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`,
	);
	return `{${parts.join(",")}}`;
}

/**
 * Placeholder factory used for roles whose PR has not landed yet.
 * Each placeholder subscribes to its **real** spec kinds and
 * refuses to fire (shouldFire returns false). It exists so the
 * registry has all 13 keys at compile time (TypeScript forces
 * this) and so the engine can iterate the registry without runtime
 * null checks. The stubs accurately reflect which kinds each
 * future role will subscribe to so the integration test
 * (`roles-integration.test.ts`) can exercise the registry
 * end-to-end with the real role shapes.
 *
 * PR 2 / PR 3 replace these placeholders with the real role
 * modules via the `createXxxRole()` factories those tasks export.
 */
function createStubRole(
	id: RoleId,
	opts: {
		priority: number;
		cooldownMs: number;
		subscribesTo: readonly EventKind[];
	},
): Role {
	return {
		name: `${id} (pending)`,
		priority: opts.priority,
		cooldownMs: opts.cooldownMs,
		subscribesTo: () => opts.subscribesTo,
		shouldFire: () => false,
		invoke: async () => {
			throw new Error(`role ${id} not yet implemented (pending PR 2 / PR 3)`);
		},
	};
}

export const ROLE_REGISTRY: Record<RoleId, Role> = {
	"supervisor-main": createSupervisorMainRole(),
	"supervisor-semantic": createSupervisorSemanticRole(),
	"supervisor-compaction": createSupervisorCompactionRole(),
	"agentlab-general": createStubRole("agentlab-general", {
		priority: 20,
		cooldownMs: 600_000,
		// Fallback role: subscribes to every spec kind. Real
		// implementation in PR 3 computes the union at construction
		// time; the stub is a static list to keep the contract
		// honest.
		subscribesTo: [
			"orchestrator_turn",
			"alerts_scheduled_tick",
			"context_budget_grew",
			"file_changed",
			"dependency_bumped",
			"module_added",
			"breaking_change",
			"migration_added",
			"raw_sql_seen",
			"design_token_drift",
			"bundle_size_grew",
			"complexity_threshold",
			"lint_regression",
			"dead_code",
			"public_api_added",
			"broken_link",
			"project_map_changed",
			"blueprint_edited",
			"source_added",
			"source_digest_drift",
			"lab_write",
		],
	}),
	"agentlab-project-understanding": createStubRole(
		"agentlab-project-understanding",
		{
			priority: 35,
			cooldownMs: 600_000,
			subscribesTo: ["project_map_changed", "blueprint_edited"],
		},
	),
	"agentlab-security": createAgentLabSecurityRole(),
	"agentlab-architecture": createAgentLabArchitectureRole(),
	"agentlab-database": createAgentLabDatabaseRole(),
	"agentlab-ui-ux": createAgentLabUiUxRole(),
	"agentlab-performance": createAgentLabPerformanceRole(),
	"agentlab-code-quality": createAgentLabCodeQualityRole(),
	"agentlab-docs": createAgentLabDocsRole(),
	"agentlab-librarian": createStubRole("agentlab-librarian", {
		priority: 25,
		cooldownMs: 600_000,
		subscribesTo: ["source_added", "source_digest_drift"],
	}),
};

/**
 * Return every role that subscribes to `kind`, sorted by
 * `(priority DESC, name ASC)`. Roles that do not subscribe to `kind`
 * are omitted. An empty array is returned when no role subscribes
 * (the engine treats that as a no-op turn).
 */
export function listRolesByKind(kind: EventKind): Role[] {
	const out: Role[] = [];
	for (const role of Object.values(ROLE_REGISTRY)) {
		if (role.subscribesTo().includes(kind)) out.push(role);
	}
	out.sort((left, right) => {
		if (right.priority !== left.priority) return right.priority - left.priority;
		return left.name.localeCompare(right.name);
	});
	return out;
}

/**
 * Return every role in the registry, in `IduModelRoleId` declaration
 * order (the order matters for stable CLI output).
 */
export function listAllRoles(): Role[] {
	// `Object.values` on a `Record<RoleId, Role>` preserves the
	// declaration order of the `ROLE_REGISTRY` literal, which is the
	// canonical `IDU_MODEL_ROLES` order.
	return Object.values(ROLE_REGISTRY);
}

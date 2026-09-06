/**
 * RoleEngine — orchestrates the 13 living roles (T1.4).
 *
 * The engine subscribes to the event bus, finds roles that care about
 * each event, enforces cooldowns and per-turn caps, invokes the roles,
 * persists advisories, and emits orchestrator_advisory events.
 *
 * State is persisted to `stateRoot/reports/role-engine-state.json` so
 * cooldowns survive restarts.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { AgentRouter } from "./agent-router.js";
import { computeEventHash, type Event, type EventKind } from "./event-bus.js";
import type { LabDbRepository } from "./lab-db-repository.js";
import type { IduModelRoleId } from "./model-assignments.js";
import type { RoleEngineConfig } from "./role-engine-config.js";
import {
	computeInputSignature,
	ROLE_REGISTRY,
	type Role,
	type RoleAdvisory,
	type RoleContext,
	type RoleInput,
} from "./roles/index.js";

export type RoleEngineState = {
	/** Per-role cooldown tracking: roleId → eventHash → ISO timestamp of last fire */
	lastFireByHash: Record<string, Record<string, string>>;
};

export type RoleEngineDeps = {
	stateRoot: string;
	projectId: string;
	router: AgentRouter;
	repository: LabDbRepository;
	config: RoleEngineConfig;
	registry?: Record<string, Role>;
	now?: () => Date;
	appendAdvisory: (advisory: RoleAdvisory) => void;
	emitEvent?: (event: Event) => void;
};

export type RoleEngineTickResult = {
	fired: RoleAdvisory[];
	skippedByCooldown: number;
	skippedByIdempotency: number;
	skippedByDisabled: number;
	skippedByCap: number;
	capWarning: boolean;
};

export class RoleEngine {
	private state: RoleEngineState;
	private perTurnCount = 0;
	private currentTurnId: string | undefined;
	private capWarningEmitted = false;
	private advisoriesThisTurn: RoleAdvisory[] = [];
	private readonly deps: RoleEngineDeps;
	private readonly registry: Record<string, Role>;

	constructor(deps: RoleEngineDeps) {
		this.deps = deps;
		// Use injected registry or fall back to the module-level ROLE_REGISTRY
		// (imported dynamically to avoid circular dependency issues in tests)
		this.registry = deps.registry ?? ROLE_REGISTRY;
		this.state = this.loadState();
	}

	private statePath(): string {
		return join(this.deps.stateRoot, "reports", "role-engine-state.json");
	}

	loadState(): RoleEngineState {
		const path = this.statePath();
		if (!existsSync(path)) return { lastFireByHash: {} };
		try {
			const raw = readFileSync(path, "utf8");
			const parsed = JSON.parse(raw);
			if (parsed && typeof parsed === "object" && parsed.lastFireByHash) {
				return parsed as RoleEngineState;
			}
			return { lastFireByHash: {} };
		} catch {
			return { lastFireByHash: {} };
		}
	}

	saveState(): void {
		const path = this.statePath();
		mkdirSync(dirname(path), { recursive: true });
		const tmp = `${path}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
		writeFileSync(path, readFileSync(tmp, "utf8"), "utf8");
		try {
			unlinkSync(tmp);
		} catch {
			// best-effort cleanup
		}
	}

	async onEvent(event: Event): Promise<RoleEngineTickResult> {
		const now = this.deps.now ? this.deps.now() : new Date();
		const result: RoleEngineTickResult = {
			fired: [],
			skippedByCooldown: 0,
			skippedByIdempotency: 0,
			skippedByDisabled: 0,
			skippedByCap: 0,
			capWarning: false,
		};

		// Find roles that subscribe to this event kind
		const candidates = this.findSubscribers(event.kind as EventKind);

		if (!this.deps.config.enabled) {
			result.skippedByDisabled = candidates.length;
			return result;
		}

		const eventHash = computeEventHash(event);
		const inputSignature = computeInputSignature(event);

		for (const [roleId, role] of candidates) {
			// 1. Check if role is enabled in config
			const enabled = this.deps.config.roleEnabled[roleId as IduModelRoleId];
			if (!enabled) {
				result.skippedByDisabled++;
				continue;
			}

			// 2. Check cooldown (per role + eventHash)
			const lastFireTs = this.state.lastFireByHash[roleId]?.[eventHash];
			if (lastFireTs) {
				const lastFireMs = Date.parse(lastFireTs);
				const cooldownMs =
					this.deps.config.roleCooldownMs[roleId as IduModelRoleId] ??
					role.cooldownMs;
				if (
					Number.isFinite(lastFireMs) &&
					now.getTime() - lastFireMs < cooldownMs
				) {
					result.skippedByCooldown++;
					continue;
				}
			}

			// 3. Check per-turn cap
			if (this.perTurnCount >= this.deps.config.maxRoleInvocationsPerTurn) {
				result.skippedByCap++;
				if (!this.capWarningEmitted) {
					this.capWarningEmitted = true;
					result.capWarning = true;
					this.emitCapWarning();
				}
				continue;
			}

			// 4. Build input and context
			const ctx: RoleContext = {
				stateRoot: this.deps.stateRoot,
				projectId: this.deps.projectId,
				now,
				router: this.deps.router,
				repository: this.deps.repository,
			};
			const input: RoleInput = { event, inputSignature, context: ctx };

			// 5. Check shouldFire
			const lastFireAt = lastFireTs ? new Date(lastFireTs) : undefined;
			if (!role.shouldFire(input, lastFireAt, now)) {
				result.skippedByIdempotency++;
				continue;
			}

			// 6. Invoke the role
			try {
				const advisory = await role.invoke(input, ctx);
				result.fired.push(advisory);
				this.perTurnCount++;
				this.advisoriesThisTurn.push(advisory);

				// Persist advisory via callback
				this.deps.appendAdvisory(advisory);

				// Emit orchestrator_advisory event
				if (this.deps.emitEvent) {
					this.deps.emitEvent({
						ts: now.toISOString(),
						kind: "orchestrator_advisory",
						projectId: this.deps.projectId,
						payload: {
							roleId: advisory.roleId,
							priority: advisory.priority,
							ts: advisory.ts,
							advisory: advisory.advisory,
							evidenceRefs: advisory.evidenceRefs,
						},
						sourceRef: "role-engine",
						evidenceRefs: [],
					});
				}

				// Update state: record this fire for cooldown tracking
				if (!this.state.lastFireByHash[roleId]) {
					this.state.lastFireByHash[roleId] = {};
				}
				this.state.lastFireByHash[roleId][eventHash] = now.toISOString();
			} catch {
				// On failure, skip silently (no advisory, no state update)
			}
		}

		this.saveState();
		return result;
	}

	onTurnStart(turnId: string): RoleAdvisory | undefined {
		this.perTurnCount = 0;
		this.currentTurnId = turnId;
		this.capWarningEmitted = false;

		// Sort advisories by priority DESC, ts ASC
		const sorted = [...this.advisoriesThisTurn].sort((a, b) => {
			if (b.priority !== a.priority) return b.priority - a.priority;
			return a.ts.localeCompare(b.ts);
		});

		// Return the highest-priority advisory
		const next = sorted[0];

		// Clear the accumulator for the new turn
		this.advisoriesThisTurn = [];

		return next;
	}

	private findSubscribers(kind: EventKind): [string, Role][] {
		const out: [string, Role][] = [];
		for (const [id, role] of Object.entries(this.registry)) {
			if (role.subscribesTo().includes(kind)) {
				out.push([id, role]);
			}
		}
		// Sort by priority DESC, name ASC (matches the registry helper)
		out.sort((a, b) => {
			if (b[1].priority !== a[1].priority) return b[1].priority - a[1].priority;
			return a[1].name.localeCompare(b[1].name);
		});
		return out;
	}

	private emitCapWarning(): void {
		if (!this.deps.emitEvent) return;
		const now = this.deps.now ? this.deps.now() : new Date();
		this.deps.emitEvent({
			ts: now.toISOString(),
			kind: "role_engine_cap_warning",
			projectId: this.deps.projectId,
			payload: {
				turnId: this.currentTurnId,
				cap: this.deps.config.maxRoleInvocationsPerTurn,
				firedCount: this.perTurnCount,
				skippedCount: 0, // will be updated by caller if needed
			},
			sourceRef: "role-engine",
			evidenceRefs: [],
		});
	}
}

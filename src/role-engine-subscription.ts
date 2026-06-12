import type { AgentRouter } from "./agent-router.js";
import {
	appendEvent,
	subscribeToEventKind,
	type EventKind,
} from "./event-bus.js";
import type { LabDbRepository } from "./lab-db-repository.js";
import { RoleEngine } from "./role-engine.js";
import {
	resolveRoleEngineConfig,
	type RoleEngineConfig,
} from "./role-engine-config.js";
import { getOrchestratorAdvisoryStream } from "./orchestrator-advisory-stream.js";
import { ROLE_REGISTRY, type Role } from "./roles/index.js";

export type RoleEngineSubscriptionInput = {
	projectId: string;
	stateRoot: string;
	router: AgentRouter;
	repository: LabDbRepository;
	config?: RoleEngineConfig;
	registry?: Record<string, Role>;
	now?: () => Date;
};

export type RoleEngineSubscriptionStatus = {
	projectId: string;
	stateRoot: string;
	enabled: boolean;
	subscriptionCount: number;
	rebound: boolean;
};

type ActiveBinding = {
	stateRoot: string;
	unsubscribes: Array<() => void>;
};

const bindingsByProjectId = new Map<string, ActiveBinding>();

export function rebindRoleEngineSubscription(
	input: RoleEngineSubscriptionInput,
): RoleEngineSubscriptionStatus {
	const hadBinding = bindingsByProjectId.has(input.projectId);
	unbindRoleEngineSubscription(input.projectId);

	const config = input.config ?? resolveRoleEngineConfig(input.stateRoot);
	if (!config.enabled) {
		return {
			projectId: input.projectId,
			stateRoot: input.stateRoot,
			enabled: false,
			subscriptionCount: 0,
			rebound: hadBinding,
		};
	}

	const registry = input.registry ?? ROLE_REGISTRY;
	const advisoryStream = getOrchestratorAdvisoryStream(input.stateRoot);
	const engine = new RoleEngine({
		stateRoot: input.stateRoot,
		projectId: input.projectId,
		router: input.router,
		repository: input.repository,
		config,
		registry,
		now: input.now,
		appendAdvisory: advisoryStream.append,
		emitEvent: (event) => appendEvent(input.stateRoot, event),
	});

	const kinds = subscribedKinds(registry);
	const unsubscribes = kinds.map((kind) =>
		subscribeToEventKind(kind, async (event) => {
			await engine.onEvent(event);
		}),
	);
	bindingsByProjectId.set(input.projectId, {
		stateRoot: input.stateRoot,
		unsubscribes,
	});

	return {
		projectId: input.projectId,
		stateRoot: input.stateRoot,
		enabled: true,
		subscriptionCount: unsubscribes.length,
		rebound: hadBinding,
	};
}

export function unbindRoleEngineSubscription(
	projectId: string,
): RoleEngineSubscriptionStatus {
	const binding = bindingsByProjectId.get(projectId);
	if (!binding) {
		return {
			projectId,
			stateRoot: "",
			enabled: false,
			subscriptionCount: 0,
			rebound: false,
		};
	}
	for (const unsubscribe of binding.unsubscribes) {
		unsubscribe();
	}
	bindingsByProjectId.delete(projectId);
	return {
		projectId,
		stateRoot: binding.stateRoot,
		enabled: false,
		subscriptionCount: 0,
		rebound: true,
	};
}

export function getRoleEngineSubscriptionStatus(
	projectId: string,
): RoleEngineSubscriptionStatus {
	const binding = bindingsByProjectId.get(projectId);
	if (!binding) {
		return {
			projectId,
			stateRoot: "",
			enabled: false,
			subscriptionCount: 0,
			rebound: false,
		};
	}
	return {
		projectId,
		stateRoot: binding.stateRoot,
		enabled: true,
		subscriptionCount: binding.unsubscribes.length,
		rebound: false,
	};
}

function subscribedKinds(registry: Record<string, Role>): EventKind[] {
	const kinds = new Set<EventKind>();
	for (const role of Object.values(registry)) {
		for (const kind of role.subscribesTo()) {
			kinds.add(kind);
		}
	}
	return [...kinds].sort();
}

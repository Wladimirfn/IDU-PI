import { readTriggerEngineConfig } from "./trigger-engine-config.js";
import { runTriggerEngineTick } from "./trigger-engine.js";

export function isTriggerEngineOptIn(): boolean {
	return process.env.IDU_PI_TRIGGER_ENGINE === "1";
}

export type RunTriggerEngineOptInInput = {
	stateRoot: string;
	projectId: string;
	now?: Date;
	isProjectActive?: () => boolean;
};

export function runTriggerEngineTickOptIn(input: RunTriggerEngineOptInInput): {
	ran: boolean;
	injectedCount: number;
	skippedByIdempotency: number;
} {
	if (
		!isTriggerEngineOptIn() &&
		!readTriggerEngineConfig(input.stateRoot).enabled
	) {
		return { ran: false, injectedCount: 0, skippedByIdempotency: 0 };
	}
	const result = runTriggerEngineTick({
		stateRoot: input.stateRoot,
		projectId: input.projectId,
		now: input.now ?? new Date(),
		isProjectActive: input.isProjectActive,
	});
	return {
		ran: true,
		injectedCount: result.injectedCount,
		skippedByIdempotency: result.skippedByIdempotency,
	};
}

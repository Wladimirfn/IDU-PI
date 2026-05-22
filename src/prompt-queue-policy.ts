export type PromptQueueDecision = "run" | "enqueue" | "defer" | "cancel";

export type PromptQueueState = {
	activePromptInFlight: boolean;
	runtimeBusy: boolean;
	fromQueue: boolean;
	cancelRequest: boolean;
};

export function decidePromptQueueAction(
	state: PromptQueueState,
): PromptQueueDecision {
	if (state.cancelRequest) return "cancel";
	if (state.runtimeBusy) return state.fromQueue ? "defer" : "enqueue";
	if (state.fromQueue) return "run";
	return state.activePromptInFlight ? "enqueue" : "run";
}

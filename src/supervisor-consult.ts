/**
 * supervisor-consult.ts — manual impulse trigger for the supervisor
 * (and any other role). The orchestrator can ask a specific role a
 * specific question and get a real model response, with token-budget
 * rails and cooldowns enforced.
 *
 * The flow:
 *
 *   1. Read role-engine.json: role must be enabled (master switch)
 *   2. Read role-rails.json: check cooldown
 *   3. Build prompt: role profile + token-budget instruction + question + context
 *   4. Call promptForRole (real model invocation via agent-router)
 *   5. AutoTune rail: success → successStreak++; failure → failureStreak++
 *      3-streak triggers expand/reduce of token budget
 *   6. Persist rail state, return model response
 *
 * The consult is bounded by:
 *   - Role-engine feature flag (you must enable the role to consult it)
 *   - Rail cooldown (no wake spam)
 *   - Token budget (soft cap via prompt instruction, hard cap via rail.maxTokenBudget)
 *   - Emergency time cap (10 min default; not enforced here, enforced in agent-router)
 *
 * Used by:
 *   - idu_supervisor_consult (MCP tool, this is the primary caller)
 *   - automaticov1 cycle (when invoking self-repair tasks with rails)
 *   - PR-102 sensor→AgentLab wiring (when a sensor impulse fires a role)
 *   - PR-103 supervisor wake-up (when AgentLab findings need categorizing)
 */

import { resolveRoleEngineConfig } from "./role-engine-config.js";
import {
	autoTuneRoleRail,
	getRoleRail,
	isCooldownActive,
	recordRoleWake,
	type RoleRail,
} from "./role-rails.js";
import { loadRoleProfile } from "./roles/profile-loader.js";
import type { IduModelRoleId } from "./model-assignments.js";
import type { PromptForRoleResult } from "./agent-router.js";

export type ConsultInput = {
	stateRoot: string;
	role: IduModelRoleId;
	question: string;
	context?: string;
	promptForRole: (
		role: IduModelRoleId,
		message: string,
		options: PromptForRoleOptions,
	) => Promise<PromptForRoleResult>;
	now?: Date;
};

export type ConsultReason =
	| "role_not_enabled"
	| "cooldown_active"
	| "consult_failed";

export type PromptForRoleOptions = {
	projectId: string;
	stateRoot: string;
	invocationSink?: (record: unknown) => void;
	onProgress?: (event: unknown) => void;
};

export type ConsultResult = {
	ok: boolean;
	role: IduModelRoleId;
	response: string;
	model: string;
	provider: string;
	rail: RoleRail;
	reason?: ConsultReason;
	cooldownRemainingMs?: number;
	promptChars: number;
	elapsedMs: number;
};

export async function consultSupervisor(
	input: ConsultInput,
): Promise<ConsultResult> {
	const now = input.now ?? new Date();
	const start = Date.now();
	const config = resolveRoleEngineConfig(input.stateRoot);
	if (!config.roleEnabled[input.role]) {
		const rail = getRoleRail(input.stateRoot, input.role, now);
		return {
			ok: false,
			role: input.role,
			response: "",
			model: "",
			provider: "",
			rail,
			reason: "role_not_enabled",
			promptChars: 0,
			elapsedMs: Date.now() - start,
		};
	}

	const rail = getRoleRail(input.stateRoot, input.role, now);
	if (isCooldownActive(rail)) {
		return {
			ok: false,
			role: input.role,
			response: "",
			model: "",
			provider: "",
			rail,
			reason: "cooldown_active",
			cooldownRemainingMs: rail.cooldownRemainingMs,
			promptChars: 0,
			elapsedMs: Date.now() - start,
		};
	}

	const prompt = buildConsultPrompt(input, rail);
	const promptChars = prompt.length;
	const result = await input.promptForRole(input.role, prompt, {
		projectId: input.stateRoot,
		stateRoot: input.stateRoot,
	});

	// Record the wake (increments wakeCount, updates lastWakeAt)
	recordRoleWake(input.stateRoot, input.role, now);

	// AutoTune the rail based on success/failure
	autoTuneRoleRail(input.stateRoot, input.role, result.ok, now);

	// Re-read the rail to get the post-wake + post-tune state
	const updatedRail = getRoleRail(input.stateRoot, input.role, now);

	return {
		ok: result.ok,
		role: input.role,
		response: result.output,
		model: result.model,
		provider: result.provider,
		rail: updatedRail,
		reason: result.ok ? undefined : "consult_failed",
		promptChars,
		elapsedMs: Date.now() - start,
	};
}

function buildConsultPrompt(input: ConsultInput, rail: RoleRail): string {
	const profile = safeLoadProfile(input.role);
	const sections: string[] = [
		`# Role: ${input.role}`,
		``,
		`## Token budget`,
		`You have a soft token budget of approximately ${rail.tokenBudget} tokens for this response. Be concise. If you need more space, structure your answer with clear sections.`,
		``,
	];

	if (profile) {
		sections.push(
			`## Profile summary`,
			`nombre: ${profile.nombre}`,
			`tipo: ${profile.tipo}`,
			`rol-id: ${profile.rolId}`,
			``,
		);
	}

	sections.push(`## Question`, input.question, ``);
	if (input.context) {
		sections.push(`## Context`, input.context, ``);
	}

	return sections.join("\n");
}

function safeLoadProfile(role: IduModelRoleId) {
	try {
		return loadRoleProfile(role);
	} catch {
		return undefined;
	}
}

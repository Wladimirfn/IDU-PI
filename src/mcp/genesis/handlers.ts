// src/mcp/genesis/handlers.ts
//
// PR 15 (Item 4, mcp-server god-file breakup): cluster L (genesis-skill)
// wrappers for the dispatchTool switch.
//
// 4 wrappers, one per case group (single label, no fall-through):
//   - handleGenesisMissionDraft       (idu_genesis_mission_draft)
//   - handleGenesisMissionConfirm     (idu_genesis_mission_confirm)
//   - handleSkillForTask              (idu_skill_for_task)
//   - handleSkillDraftFromLessons     (idu_skill_draft_from_lessons)
//
// Each wrapper preserves its case body verbatim from src/mcp-server.ts
// (modulo the function signature: name, args, runtime, resolution params).
//
// Free vars used (locked template):
//   - name: IduMcpToolName (param)
//   - args: JsonObject (param)
//   - runtime: CliRuntime (param)
//   - resolution: IduMcpProjectResolution (param)
//   - All other identifiers are imports or already-imported helpers.

import type { CliRuntime } from "../../cli.js";
import { buildDecisionEnvelope } from "../../decision-envelope.js";
import {
	runGenesisMissionConfirm,
	runGenesisMissionDraft,
} from "../../genesis-mission-tools.js";
import type { IduMcpProjectResolution } from "../../mcp-server.js";
import { loadSkillsForTask } from "../../skills-index-runtime.js";
import type { SkillDraftFromLessonsMode } from "../../skill-draft-from-lessons.js";
import { envelope, requiredText, stringArg } from "../_shared/index.js";
import type {
	IduMcpToolResult,
	IduMcpToolName,
	JsonObject,
} from "../_shared/index.js";

/**
 * idu_genesis_mission_draft — generate an unconfirmed mission draft.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleGenesisMissionDraft(
	name: IduMcpToolName,
	_args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (resolution.status !== "registered_project" || !resolution.stateRoot) {
		return envelope({
			stateRoot: "",

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary:
				"Genesis mission draft requires an enrolled project stateRoot.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["enrolled project stateRoot is missing"],
		});
	}
	const result = runGenesisMissionDraft({
		stateRoot: resolution.stateRoot,
		projectPath: runtime.projectPath,
	});
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `mission-draft persisted for ${result.missionDraft.projectId}`,
		data: { missionDraft: result.missionDraft },
		safeNotes: [
			...resolution.safeNotes,
			"Mission draft is unconfirmed until idu_genesis_mission_confirm runs.",
			"Only stateRoot/birth/mission-draft.json is written.",
		],
	});
}

/**
 * idu_genesis_mission_confirm — confirm a previously-generated mission draft.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleGenesisMissionConfirm(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (resolution.status !== "registered_project" || !resolution.stateRoot) {
		return envelope({
			stateRoot: "",

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary:
				"Genesis mission confirm requires an enrolled project stateRoot.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["enrolled project stateRoot is missing"],
		});
	}
	const owner = stringArg(args, "owner");
	if (!owner) {
		return envelope({
			stateRoot: "",

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary:
				"Genesis mission confirm requires an explicit owner argument.",
			data: {},
			safeNotes: [
				...resolution.safeNotes,
				"No stateRoot file was written.",
			],
			errors: ["owner is required"],
		});
	}
	const result = runGenesisMissionConfirm({
		stateRoot: resolution.stateRoot,
		projectPath: runtime.projectPath,
		owner,
	});
	if (!result.ok) {
		return envelope({
			stateRoot: "",

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: result.error ?? "Mission confirm failed.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: [result.error ?? "mission confirm failed"],
		});
	}
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `blueprint confirmed by ${result.blueprint.confirmedBy}`,
		data: { blueprint: result.blueprint },
		safeNotes: [
			...resolution.safeNotes,
			"Owner-invoked only; no auto-trigger from idu_genesis_mission_draft.",
			"Only stateRoot/birth/blueprint.json is written.",
		],
	});
}

/**
 * idu_skill_for_task — recommend skills from the index for a given task.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSkillForTask(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	if (resolution.status !== "registered_project" || !resolution.stateRoot) {
		return envelope({
			stateRoot: "",

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "idu_skill_for_task requires an enrolled project stateRoot.",
			data: {},
			safeNotes: resolution.safeNotes,
			errors: ["enrolled project stateRoot is missing"],
		});
	}
	const request = requiredText(args, "request");
	const skills = loadSkillsForTask(resolution.stateRoot, request);
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary: `skills ranked: ${skills.length} matches`,
		data: { request, skills },
		safeNotes: [
			...resolution.safeNotes,
			"Skills index is read from lab.db; no stateRoot or lab.db writes.",
			"No auto-promotion of skills or contracts.",
		],
	});
}

/**
 * idu_skill_draft_from_lessons — generate skill proposals/drafts from lessons.
 * Body verbatim from src/mcp-server.ts.
 */
export async function handleSkillDraftFromLessons(
	name: IduMcpToolName,
	args: JsonObject,
	runtime: CliRuntime,
	resolution: IduMcpProjectResolution,
): Promise<IduMcpToolResult> {
	const rawMode = stringArg(args, "mode") ?? "proposal-only";
	const mode = rawMode as SkillDraftFromLessonsMode;
	if (mode !== "proposal-only" && mode !== "approved-only") {
		return envelope({
			stateRoot: "",

			ok: false,
			tool: name,
			projectId: runtime.projectId,
			projectPath: runtime.projectPath,
			summary: "Modo inválido para skill draft from lessons.",
			data: { mode: rawMode },
			safeNotes: [
				...resolution.safeNotes,
				"No generé propuestas ni drafts de skill.",
			],
			errors: ["mode must be proposal-only or approved-only"],
		});
	}
	const result = runtime.skillDraftFromLessons({
		mode,
		selector: stringArg(args, "selector"),
	});
	const createdCount =
		result.mode === "proposal-only"
			? result.createdProposals.length
			: result.createdDrafts.length;
	const decisionEnvelope = buildDecisionEnvelope({
		tool: name,
		recommendation: createdCount ? "needs_approval" : "needs_evidence",
		severity: createdCount ? "warning" : "info",
		confidence: 0.78,
		summary:
			result.mode === "proposal-only"
				? `Skill proposals from lessons: ${createdCount}`
				: `Skill drafts from approved proposals: ${createdCount}`,
		requiresHuman: true,
		orchestratorDecisionRequired: true,
		allowedToProceed: false,
		evidenceRefs: [
			...(result.semanticDraftPath
				? [`semantic-draft:${result.semanticDraftPath}`]
				: []),
			...(result.proposalsPath
				? [`skill-proposals:${result.proposalsPath}`]
				: []),
			...(result.skillDraftPath
				? [`skill-draft:${result.skillDraftPath}`]
				: []),
		],
		requiredActions: result.requiredActions.map((action, index) => ({
			id: `skill-draft-from-lessons-${index + 1}`,
			// Tema B: skill-draft-from-lessons pipeline emits human-approval
			// actions ("Approve an explicit proposal...", "Apply or install
			// skills only after human approval."). Previously set owner to
			// "orchestrator" and relied on decision-envelope's regex fallback
			// to catch "approval"/"human" in the action text. The fallback is
			// gone; signal structurally.
			owner: "human",
			action,
			reason:
				"Skill learning artifacts require explicit human/orchestrator approval.",
			blocking: false,
		})),
		nextActions: result.nextActions,
	});
	return envelope({
		stateRoot: "",

		ok: true,
		tool: name,
		projectId: runtime.projectId,
		projectPath: runtime.projectPath,
		summary:
			result.mode === "proposal-only"
				? `Skill proposals from lessons: ${createdCount}`
				: `Skill drafts from approved proposals: ${createdCount}`,
		data: { result, decisionEnvelope },
		safeNotes: [...resolution.safeNotes, ...result.safeNotes],
	});
}

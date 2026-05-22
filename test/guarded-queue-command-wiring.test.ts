import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync("src/index.ts", "utf8");

test("queued drain applies preflight guard before execution", () => {
	const drain = source.slice(source.indexOf("async function drainTaskQueue"));
	const drainBlock = drain.slice(
		0,
		drain.indexOf("async function generateAiProjectDraft"),
	);

	assert.match(drainBlock, /taskQueue\.peek\(\)/u);
	assert.match(drainBlock, /guardQueuedPrompt\(ctx, queuedPrompt\)/u);
	assert.match(drainBlock, /runPrompt\(ctx, queuedPrompt, \{/u);
	assert.match(drainBlock, /fromQueue: true/u);
	assert.match(drainBlock, /preserveActivePromptInFlight: true/u);
	assert.ok(
		drainBlock.indexOf("guardQueuedPrompt") < drainBlock.indexOf("runPrompt"),
	);
});

test("direct /task applies guard before execution", () => {
	const handler = source.slice(source.indexOf('bot.command("task"'));
	const handlerBlock = handler.slice(
		0,
		handler.indexOf('bot.command("server"'),
	);

	assert.match(
		handlerBlock,
		/buildTaskPrompt\(parsed\.kind, parsed\.details\)/u,
	);
	assert.match(handlerBlock, /guardTaskPrompt\(ctx, prompt/u);
	assert.match(handlerBlock, /structuredTaskCategory: parsed\.kind/u);
	assert.match(handlerBlock, /source: "task-direct-guard"/u);
	assert.match(handlerBlock, /enqueueLegacyOnBlock: true/u);
	assert.ok(
		handlerBlock.indexOf("guardTaskPrompt") < handlerBlock.indexOf("runPrompt"),
	);
});

test("guarded queue only blocks high or blocker risk when /idu is active", () => {
	const guard = source.slice(source.indexOf("async function guardTaskPrompt"));
	const guardBlock = guard.slice(
		0,
		guard.indexOf("async function generateAiProjectDraft"),
	);

	assert.match(
		guardBlock,
		/shouldUseAutomaticGuardrails\(currentProjectId\(\)\)/u,
	);
	assert.ok(
		guardBlock.indexOf("shouldUseAutomaticGuardrails") <
			guardBlock.indexOf("buildPreflightReport"),
	);
	assert.match(guardBlock, /buildPreflightReport\(prompt\)/u);
	assert.match(
		guardBlock,
		/report\.risk === "high" \|\| report\.risk === "blocker"/u,
	);
	assert.match(guardBlock, /guardStatus === "needs_confirmation"/u);
	assert.match(guardBlock, /markNeedsConfirmation/u);
	assert.match(guardBlock, /!existingTask/u);
	assert.match(
		guardBlock,
		/formatProjectAdvisory\(buildProjectAdvisory\(report\)\)/u,
	);
	assert.match(guardBlock, /queue_approve/u);
	assert.match(guardBlock, /return false/u);
});

test("guarded /task pauses visibly if preflight throws", () => {
	const guard = source.slice(source.indexOf("async function guardTaskPrompt"));
	const guardBlock = guard.slice(
		0,
		guard.indexOf("async function generateAiProjectDraft"),
	);

	assert.match(guardBlock, /try\s*\{/u);
	assert.match(guardBlock, /catch \(error\)/u);
	assert.match(
		guardBlock,
		/No pude completar preflight; tarea pausada por seguridad/u,
	);
	assert.match(guardBlock, /guardRisk: "blocker"/u);
	assert.match(guardBlock, /markNeedsConfirmation/u);
	assert.match(guardBlock, /queue_approve/u);
	assert.match(guardBlock, /queue_reject/u);
	assert.match(guardBlock, /return false/u);
});

test("manual preflight advisory and postflight stay independent of /idu", () => {
	const manual = source.slice(source.indexOf('bot.command("preflight"'));
	const manualBlock = manual.slice(
		0,
		manual.indexOf('bot.command("lab_review_plan"'),
	);

	assert.match(manualBlock, /bot\.command\("preflight"/u);
	assert.match(manualBlock, /bot\.command\("advisory"/u);
	assert.match(manualBlock, /bot\.command\("postflight"/u);
	assert.doesNotMatch(manualBlock, /shouldUseAutomaticGuardrails/u);
});

test("queue approval and rejection commands are wired", () => {
	assert.match(source, /bot\.command\("queue_approve"/u);
	assert.match(source, /bot\.command\("queue_reject"/u);
	assert.match(source, /markGuardApproved/u);
	assert.match(source, /markGuardRejected/u);
	assert.match(source, /runPrompt\(ctx, task\.text/u);
	const approval = source.slice(source.indexOf('bot.command("queue_approve"'));
	const approvalBlock = approval.slice(
		0,
		approval.indexOf('bot.command("queue_reject"'),
	);
	assert.doesNotMatch(approvalBlock, /preserveActivePromptInFlight/u);
	assert.match(source, /taskQueue\.removeAllMatching\(task\.text\)/u);
	assert.match(approvalBlock, /taskQueue\.removeAllMatching\(task\.text\)/u);
	assert.doesNotMatch(approvalBlock, /task\.guardStatus !== "approved"/u);
});

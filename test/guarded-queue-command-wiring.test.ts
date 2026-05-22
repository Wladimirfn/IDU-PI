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

test("guarded queue blocks high or blocker risk with advisory", () => {
	const guard = source.slice(
		source.indexOf("async function guardQueuedPrompt"),
	);
	const guardBlock = guard.slice(
		0,
		guard.indexOf("async function generateAiProjectDraft"),
	);

	assert.match(guardBlock, /buildPreflightReport\(prompt\)/u);
	assert.match(
		guardBlock,
		/report\.risk === "high" \|\| report\.risk === "blocker"/u,
	);
	assert.match(guardBlock, /markNeedsConfirmation/u);
	assert.match(
		guardBlock,
		/formatProjectAdvisory\(buildProjectAdvisory\(report\)\)/u,
	);
	assert.match(guardBlock, /queue_approve/u);
	assert.match(guardBlock, /return false/u);
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
	assert.match(source, /taskQueue\.removeFirstMatching\(task\.text\)/u);
});

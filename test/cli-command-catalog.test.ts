/**
 * cli-command-catalog.test.ts — pins the public catalog of src/cli.ts.
 *
 * Per PR 7 step 0 (the inflection-point plan):
 *   1. Catalog-freeze test — every `case "X":` label in the dispatch
 *      switch must match the frozen set (214 labels). Drop / duplicate /
 *      rename of any case fails the test with a clear diff.
 *
 * The catalog is the set of strings that the CLI accepts as the first
 * token of `idu-pi <command>`. Source: derived from main @ post-PR-6
 * (commit c24c8a4) by scripts/analyze-cases (PR 7 step 0).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Frozen catalog of 214 case labels. DO NOT EDIT — this list is the
 * ground truth. If a new case is added, run the analysis again and
 * regenerate the list, then commit the change in a separate PR that
 * also updates the dispatcher (do not silently expand the catalog).
 */
const EXPECTED_CATALOG: readonly string[] = [
	"ack-advisory",
	"advisory",
	"agentlab-report-consolidate",
	"agentlab-report-consolidation-status",
	"agentlab-request-create",
	"agentlab-request-review",
	"agentlab-review-run",
	"agentlab-review-status",
	"alerts",
	"alerts-scheduled-tick",
	"alerts-status",
	"alerts-tick",
	"automaticov1",
	"bibliotecario-init",
	"birth-bibliotecario-discovery",
	"birth-existing-scan",
	"birth-general-spec",
	"birth-general-spec-derive",
	"birth-prototype-master",
	"birth-repo-plan",
	"birth-status",
	"birth-validate",
	"decision-ledger",
	"events",
	"execution-director-tick",
	"hygiene-migrate",
	"hygiene-sweep",
	"idu",
	"idu-ack-advisory",
	"idu-advisory",
	"idu-agentlab-report-consolidate",
	"idu-agentlab-report-consolidation-status",
	"idu-agentlab-request-create",
	"idu-agentlab-request-review",
	"idu-agentlab-review-run",
	"idu-agentlab-review-status",
	"idu-alerts",
	"idu-alerts-scheduled-tick",
	"idu-alerts-status",
	"idu-alerts-tick",
	"idu-automaticov1",
	"idu-bibliotecario-init",
	"idu-birth-bibliotecario-discovery",
	"idu-birth-existing-scan",
	"idu-birth-general-spec",
	"idu-birth-general-spec-derive",
	"idu-birth-prototype-master",
	"idu-birth-repo-plan",
	"idu-birth-status",
	"idu-birth-validate",
	"idu-check-user-escalation",
	"idu-decision-ledger",
	"idu-events",
	"idu-execution-director-tick",
	"idu-hygiene-migrate",
	"idu-hygiene-sweep",
	"idu-lab-review-plan",
	"idu-master-plan-approve",
	"idu-master-plan-redraft",
	"idu-master-plan-reject",
	"idu-master-plan-review",
	"idu-master-plan-status",
	"idu-model-invocation-status",
	"idu-objective-status",
	"idu-off",
	"idu-onboard-project",
	"idu-orchestrator-advisory",
	"idu-outbox-prune",
	"idu-pending-injections",
	"idu-postflight",
	"idu-preflight",
	"idu-prepare",
	"idu-project-reset-state",
	"idu-proposal-detail",
	"idu-proposal-outbox",
	"idu-queue",
	"idu-queue-approve",
	"idu-queue-clear-structured",
	"idu-queue-complete",
	"idu-queue-detail",
	"idu-queue-reject",
	"idu-review",
	"idu-role-engine",
	"idu-role-engine-status",
	"idu-run-cron-preflight",
	"idu-semantic-agent-tasks-create",
	"idu-semantic-agent-tasks-review",
	"idu-semantic-audit-run",
	"idu-semantic-audit-status",
	"idu-semantic-compact-draft",
	"idu-semantic-compact-review",
	"idu-skill-drafts-create",
	"idu-skill-drafts-review",
	"idu-skill-improvements-approve",
	"idu-skill-improvements-create",
	"idu-skill-improvements-defer",
	"idu-skill-improvements-reject",
	"idu-skill-improvements-review",
	"idu-skill-improvements-status",
	"idu-skill-rating",
	"idu-source-add",
	"idu-source-chunk-read",
	"idu-source-digest",
	"idu-source-digest-status",
	"idu-source-extract",
	"idu-source-read",
	"idu-source-recommend",
	"idu-source-refresh",
	"idu-source-remove",
	"idu-source-report",
	"idu-source-required-actions",
	"idu-source-research",
	"idu-source-skill-candidates-create",
	"idu-source-skill-candidates-review",
	"idu-source-status",
	"idu-status",
	"idu-subscribe-triggers",
	"idu-supervisor-improvements-apply",
	"idu-supervisor-improvements-approve",
	"idu-supervisor-improvements-create",
	"idu-supervisor-improvements-defer",
	"idu-supervisor-improvements-reject",
	"idu-supervisor-improvements-review",
	"idu-supervisor-improvements-status",
	"idu-supervisor-learning-rules-disable",
	"idu-supervisor-learning-rules-enable",
	"idu-supervisor-learning-rules-rollback",
	"idu-supervisor-learning-rules-status",
	"idu-supervisor-learning-rules-test",
	"idu-supervisor-tick",
	"idu-supervisor-trigger",
	"idu-task",
	"idu-trigger-engine",
	"idu-trigger-show",
	"idu-usage-status",
	"lab-review-plan",
	"master-plan-approve",
	"master-plan-redraft",
	"master-plan-reject",
	"master-plan-review",
	"master-plan-status",
	"model-invocation-status",
	"onboard-project",
	"orchestrator-advisory",
	"outbox-prune",
	"pending-injections",
	"postflight",
	"preflight",
	"prepare",
	"project-reset-state",
	"proposal-detail",
	"proposal-outbox",
	"queue",
	"queue-approve",
	"queue-clear-structured",
	"queue-complete",
	"queue-detail",
	"queue-reject",
	"queue_approve",
	"queue_complete",
	"queue_reject",
	"review",
	"revisar",
	"role-engine",
	"role-engine-status",
	"semantic-agent-tasks-create",
	"semantic-agent-tasks-review",
	"semantic-audit-run",
	"semantic-audit-status",
	"semantic-compact-draft",
	"semantic-compact-review",
	"skill-drafts-create",
	"skill-drafts-review",
	"skill-improvements-approve",
	"skill-improvements-create",
	"skill-improvements-defer",
	"skill-improvements-reject",
	"skill-improvements-review",
	"skill-improvements-status",
	"skill-rating",
	"source-add",
	"source-chunk-read",
	"source-digest",
	"source-digest-status",
	"source-extract",
	"source-read",
	"source-recommend",
	"source-refresh",
	"source-remove",
	"source-report",
	"source-required-actions",
	"source-research",
	"source-skill-candidates-create",
	"source-skill-candidates-review",
	"source-status",
	"status",
	"subscribe-triggers",
	"supervisor-improvements-apply",
	"supervisor-improvements-approve",
	"supervisor-improvements-create",
	"supervisor-improvements-defer",
	"supervisor-improvements-reject",
	"supervisor-improvements-review",
	"supervisor-improvements-status",
	"supervisor-learning-rules-disable",
	"supervisor-learning-rules-enable",
	"supervisor-learning-rules-rollback",
	"supervisor-learning-rules-status",
	"supervisor-learning-rules-test",
	"supervisor-tick",
	"supervisor-trigger",
	"task",
	"trigger-engine",
	"usage-status",
];

/**
 * Parse every `case "X":` label from the dispatch switch.
 * Walks the file line-by-line, tracks depth of `{`/`}` so we only
 * capture labels inside the `switch (command) { ... }` block.
 */
function parseCaseLabels(src: string): string[] {
	const lines = src.split("\n");
	let inSwitch = false;
	let switchDepth = 0;
	const labels: string[] = [];
	for (const line of lines) {
		if (!inSwitch && /\bswitch\s*\(\s*command\s*\)/.test(line)) {
			inSwitch = true;
			switchDepth = 0;
		}
		if (inSwitch) {
			for (const ch of line) {
				if (ch === "{") switchDepth++;
				else if (ch === "}") switchDepth--;
			}
			const m = line.match(/^\s*case\s+"([^"]+)"\s*:/);
			if (m) labels.push(m[1]);
			if (switchDepth === 0 && /[{}]/.test(line)) {
				inSwitch = false;
			}
		}
	}
	return labels;
}

test("cli.ts command catalog: 214 case labels, set frozen", () => {
	const cli = readFileSync(
		join(process.cwd(), "src", "cli.ts"),
		"utf8",
	);
	const actualLabels = parseCaseLabels(cli);
	const actual = [...new Set(actualLabels)].sort();
	const expected = [...EXPECTED_CATALOG].sort();
	assert.strictEqual(
		actual.length,
		expected.length,
		`Catalog size mismatch: got ${actual.length} unique labels, expected ${expected.length}.\n` +
			`Extra: ${actual.filter((l) => !expected.includes(l)).join(", ")}\n` +
			`Missing: ${expected.filter((l) => !actual.includes(l)).join(", ")}`,
	);
	assert.deepStrictEqual(
		actual,
		expected,
		`Command catalog drifted. If you added/renamed/removed a case label, ` +
			`this is intentional and you must regenerate EXPECTED_CATALOG via ` +
			`the step-0 analyzer (PR 7 step 0 process).`,
	);
});

test("cli.ts command catalog: no duplicate case labels", () => {
	const cli = readFileSync(
		join(process.cwd(), "src", "cli.ts"),
		"utf8",
	);
	const labels = parseCaseLabels(cli);
	const counts = new Map<string, number>();
	for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
	const duplicates = [...counts.entries()].filter(([, n]) => n > 1);
	assert.deepStrictEqual(
		duplicates,
		[],
		`Duplicate case labels found: ${duplicates.map(([l, n]) => `${l}(x${n})`).join(", ")}`,
	);
});
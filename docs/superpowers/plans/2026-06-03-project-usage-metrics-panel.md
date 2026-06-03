# Project Usage Metrics Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show compact local Idu-pi usage metrics in the current project panel, backed by the existing stateRoot-only JSONL events.

**Architecture:** Keep `src/usage-events.ts` as the telemetry/reporting core and expose a structured report plus compact panel formatter. `src/cli-home.ts` consumes the report from `project.stateRoot` and renders a `Uso local` block without writing events or starting background refresh.

**Tech Stack:** TypeScript, Node test runner, existing CLI home formatting, local JSONL usage events.

---

## File Structure

- Modify: `src/usage-events.ts`
  - Add `IduUsageReport`, `buildIduUsageReport()`, and `formatIduUsagePanel()`.
  - Keep event storage and parsing unchanged.
- Modify: `src/cli-home.ts`
  - Import usage report helpers.
  - Render `Uso local` in `formatCliProjectStatus()` only when `project.stateRoot` exists.
- Modify: `test/usage-events.test.ts`
  - Add focused report and formatter tests.
- Modify: `test/cli-home.test.ts`
  - Add current project panel tests that prove metrics read from stateRoot and workspaceRoot noise is ignored.

## Task 1: Usage Report Core

**Files:**
- Modify: `src/usage-events.ts`
- Test: `test/usage-events.test.ts`

- [ ] **Step 1: Write failing report metric test**

Append this test to `test/usage-events.test.ts`:

```ts
test("usage report calculates compact project panel metrics", async () => {
	const root = tempStateRoot();
	try {
		await recordIduUsageEvent(root, {
			projectId: "idu-pi",
			surface: "cli",
			action: "idu-status",
			active: true,
			recommendation: "ok",
			allowedToProceed: true,
			requiresHuman: false,
			ok: true,
		});
		await recordIduUsageEvent(root, {
			projectId: "idu-pi",
			surface: "mcp",
			action: "idu_postflight",
			active: false,
			recommendation: "ask_human",
			allowedToProceed: false,
			requiresHuman: true,
			ok: false,
		});
		const report = buildIduUsageReport(readIduUsageEvents(root));
		assert.equal(report.totalEvents, 2);
		assert.equal(report.surface.cli, 1);
		assert.equal(report.surface.mcp, 1);
		assert.equal(report.active.true, 1);
		assert.equal(report.active.false, 1);
		assert.equal(report.requiresHuman, 1);
		assert.equal(report.notAllowed, 1);
		assert.equal(report.failed, 1);
		assert.equal(report.topActions[0]?.action, "idu-status");
		assert.match(formatIduUsagePanel(report), /Uso local/u);
		assert.match(formatIduUsagePanel(report), /requiere humano: 1/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
```

Also update the import block:

```ts
import {
	buildIduUsageReport,
	formatIduUsagePanel,
	formatIduUsageSummary,
	readIduUsageEvents,
	recordIduUsageEvent,
	summarizeIduUsageEvents,
	usageEventsPath,
} from "../src/usage-events.js";
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
corepack pnpm build && node --test dist/test/usage-events.test.js
```

Expected: build fails because `buildIduUsageReport` and `formatIduUsagePanel` are not exported.

- [ ] **Step 3: Add report types and builders**

In `src/usage-events.ts`, add exports after `IduUsageSummary`:

```ts
export type IduUsageReport = {
	version: 1;
	totalEvents: number;
	lastActivity?: string;
	surface: { cli: number; mcp: number; other: number };
	active: { true: number; false: number; unknown: number };
	requiresHuman: number;
	notAllowed: number;
	failed: number;
	topActions: { action: string; count: number }[];
	topRecommendations: { recommendation: string; count: number }[];
	recent: IduUsageEvent[];
};
```

Add this implementation before `formatIduUsageSummary()`:

```ts
export function buildIduUsageReport(
	events: IduUsageEvent[],
	options: { topLimit?: number; recentLimit?: number } = {},
): IduUsageReport {
	const topLimit = Math.max(1, options.topLimit ?? 5);
	const recentLimit = Math.max(0, options.recentLimit ?? 5);
	const byAction: Record<string, number> = {};
	const byRecommendation: Record<string, number> = {};
	const surface = { cli: 0, mcp: 0, other: 0 };
	const active = { true: 0, false: 0, unknown: 0 };
	let requiresHuman = 0;
	let notAllowed = 0;
	let failed = 0;
	for (const event of events) {
		if (event.surface === "cli") surface.cli += 1;
		else if (event.surface === "mcp") surface.mcp += 1;
		else surface.other += 1;
		incrementTriState(active, event.active);
		if (event.requiresHuman === true) requiresHuman += 1;
		if (event.allowedToProceed === false) notAllowed += 1;
		if (event.ok === false) failed += 1;
		increment(byAction, event.action);
		increment(byRecommendation, event.recommendation ?? "unknown");
	}
	return {
		version: 1,
		totalEvents: events.length,
		...(events.length ? { lastActivity: events[events.length - 1]?.timestamp } : {}),
		surface,
		active,
		requiresHuman,
		notAllowed,
		failed,
		topActions: topEntries(byAction, topLimit).map(([action, count]) => ({
			action,
			count,
		})),
		topRecommendations: topEntries(byRecommendation, topLimit).map(
			([recommendation, count]) => ({ recommendation, count }),
		),
		recent: events.slice(-recentLimit),
	};
}
```

Add formatter before `formatIduUsageSummary()`:

```ts
export function formatIduUsagePanel(report: IduUsageReport): string {
	if (report.totalEvents === 0) {
		return ["Uso local", "eventos: 0", "última actividad: sin eventos"].join("\n");
	}
	return [
		"Uso local",
		`eventos: ${report.totalEvents}`,
		`última actividad: ${formatRelativeUsageTime(report.lastActivity)}`,
		`superficie: cli ${report.surface.cli} · mcp ${report.surface.mcp}`,
		`activo/inactivo: ${report.active.true} / ${report.active.false}`,
		`requiere humano: ${report.requiresHuman}`,
		`bloqueados/no permitido: ${report.notAllowed}`,
		`errores: ${report.failed}`,
		"acciones top:",
		...(report.topActions.length
			? report.topActions.map((entry) => `- ${entry.action} ${entry.count}`)
			: ["- sin acciones"]),
	].join("\n");
}
```

Add helpers near `sortRecord()`:

```ts
function topEntries(
	record: Record<string, number>,
	limit: number,
): [string, number][] {
	return Object.entries(record)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, limit);
}

function formatRelativeUsageTime(timestamp?: string): string {
	if (!timestamp) return "sin eventos";
	const time = Date.parse(timestamp);
	if (!Number.isFinite(time)) return timestamp;
	const diffMs = Math.max(0, Date.now() - time);
	const diffMinutes = Math.floor(diffMs / 60_000);
	if (diffMinutes < 1) return "recién";
	if (diffMinutes < 60) return `hace ${diffMinutes}m`;
	const diffHours = Math.floor(diffMinutes / 60);
	if (diffHours < 24) return `hace ${diffHours}h`;
	const diffDays = Math.floor(diffHours / 24);
	return `hace ${diffDays}d`;
}
```

- [ ] **Step 4: Run focused usage test and verify GREEN**

Run:

```bash
corepack pnpm build && node --test dist/test/usage-events.test.js
```

Expected: all `usage-events` tests pass.

## Task 2: Current Project Panel Integration

**Files:**
- Modify: `src/cli-home.ts`
- Test: `test/cli-home.test.ts`

- [ ] **Step 1: Write failing panel tests**

Append this test to `test/cli-home.test.ts`:

```ts
test("current project panel shows local usage metrics from stateRoot", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-cli-home-usage-"));
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state");
		mkdirSync(projectPath, { recursive: true });
		await recordIduUsageEvent(stateRoot, {
			projectId: "project",
			surface: "cli",
			action: "idu-status",
			active: true,
			allowedToProceed: true,
			ok: true,
		});
		const status = buildCliHomeStatus({
			cwd: projectPath,
			registryPath: join(root, "projects.json"),
			exists: existsSync,
			runner: fakeToolRunner(),
		});
		const output = formatCliProjectStatus({
			...status,
			project: {
				...status.project,
				registered: true,
				projectId: "project",
				stateRoot,
			},
		});
		assert.match(output, /Uso local/u);
		assert.match(output, /eventos: 1/u);
		assert.match(output, /superficie: cli 1 · mcp 0/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
```

Append this test too:

```ts
test("current project panel usage metrics ignore workspaceRoot usage file", async () => {
	const root = mkdtempSync(join(tmpdir(), "idu-cli-home-usage-root-"));
	try {
		const projectPath = join(root, "project");
		const stateRoot = join(root, "state");
		mkdirSync(projectPath, { recursive: true });
		await recordIduUsageEvent(projectPath, {
			projectId: "wrong-root",
			surface: "mcp",
			action: "wrong-root-event",
		});
		const status = buildCliHomeStatus({
			cwd: projectPath,
			registryPath: join(root, "projects.json"),
			exists: existsSync,
			runner: fakeToolRunner(),
		});
		const output = formatCliProjectStatus({
			...status,
			project: {
				...status.project,
				registered: true,
				projectId: "project",
				stateRoot,
			},
		});
		assert.match(output, /Uso local/u);
		assert.match(output, /eventos: 0/u);
		assert.doesNotMatch(output, /wrong-root-event/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
```

Update imports in `test/cli-home.test.ts` if missing:

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordIduUsageEvent } from "../src/usage-events.js";
```

Use the existing file's import style and avoid duplicate imports.

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
corepack pnpm build && node --test dist/test/cli-home.test.js
```

Expected: tests fail because `formatCliProjectStatus()` does not render usage metrics.

- [ ] **Step 3: Render usage panel from stateRoot**

In `src/cli-home.ts`, add import:

```ts
import {
	buildIduUsageReport,
	formatIduUsagePanel,
	readIduUsageEvents,
} from "./usage-events.js";
```

In `formatCliProjectStatus()`, replace the return body with this shape:

```ts
export function formatCliProjectStatus(status: CliHomeStatus): string {
	const project = status.project;
	const usagePanel = project.stateRoot
		? [
				"",
				formatIduUsagePanel(
					buildIduUsageReport(readIduUsageEvents(project.stateRoot, 500)),
				),
			]
		: [];
	return [
		"Proyecto actual",
		"",
		`ruta: ${project.candidatePath}`,
		`git repo: ${project.isGitRepository ? "sí" : "no"}`,
		`allowedRoots: ${project.allowedRoot === true ? "sí" : project.allowedRoot === false ? "no" : "unknown"}`,
		`enrolado: ${project.registered ? "sí" : "no"}`,
		`projectId: ${project.projectId}`,
		...(project.stateRoot ? [`stateRoot: ${project.stateRoot}`] : []),
		`session: ${project.supervisor}`,
		`Project Core: ${project.projectCore}`,
		`Constitution: ${project.constitution}`,
		...usagePanel,
		`recommended next: ${project.recommendedNext}`,
		...(project.warning ? [`aviso: ${project.warning}`] : []),
	].join("\n");
}
```

- [ ] **Step 4: Run focused panel tests and verify GREEN**

Run:

```bash
corepack pnpm build && node --test dist/test/cli-home.test.js dist/test/usage-events.test.js
```

Expected: focused tests pass.

## Task 3: Verification and Commit

**Files:**
- Verify all changed implementation and test files.

- [ ] **Step 1: Run full validation**

Run:

```bash
corepack pnpm test && git diff --check
```

Expected: full test suite passes and diff check reports no errors.

- [ ] **Step 2: Run LSP diagnostics**

Run LSP diagnostics on:

```text
src/usage-events.ts
src/cli-home.ts
test/usage-events.test.ts
test/cli-home.test.ts
```

Expected: zero diagnostics.

- [ ] **Step 3: Run Idu-pi postflight**

Expected files:

```text
src/usage-events.ts
src/cli-home.ts
test/usage-events.test.ts
test/cli-home.test.ts
```

Expected mode: `code`.
Expected contracts: `tests`, `agent`.

Expected: advisory pass or warning with no blocking required action.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add src/usage-events.ts src/cli-home.ts test/usage-events.test.ts test/cli-home.test.ts
git commit -m "feat(idu): show project usage metrics"
```

Expected: one implementation commit with only the expected paths.

- [ ] **Step 5: Push**

Run:

```bash
git push
```

Expected: `main -> main` pushed successfully.

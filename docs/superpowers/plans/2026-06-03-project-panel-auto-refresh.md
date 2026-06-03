# Project Panel Auto-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-refresh the current project panel every 3 seconds while the user remains on that screen.

**Architecture:** Extend `selectSearchableMenu()` in `src/cli.ts` with optional content auto-refresh support. The project panel passes a callback that rebuilds `buildCliHomeStatus()` and `formatCliProjectStatus()`. The menu renderer owns timer setup, anti-flicker content comparison, and cleanup.

**Tech Stack:** TypeScript, Node test runner, existing TUI helpers.

---

## File Structure

- Modify: `src/cli.ts`
  - Add optional `autoRefresh` setting to `selectSearchableMenu()`.
  - Add interval lifecycle and clear it in `finally`.
  - Re-render only when refreshed content changes.
  - Configure project panel with `intervalMs: 3000`.
- Modify: `test/cli-home.test.ts`
  - Add source-level regression tests for auto-refresh wiring and cleanup.

## Task 1: Add Auto-Refresh Wiring

**Files:**
- Modify: `src/cli.ts`
- Test: `test/cli-home.test.ts`

- [ ] **Step 1: Write failing test**

Update the existing `project panel exposes manual usage metrics refresh without auto refresh` test into an auto-refresh test:

```ts
test("project panel auto-refresh is scoped and cleaned up", () => {
	const source = readFileSync(join(process.cwd(), "src", "cli.ts"), "utf8");
	assert.match(source, /↻ Actualizar métricas/u);
	assert.match(source, /runProjectStatusPanelTui/u);
	const projectPanelBlock = source.slice(
		source.indexOf("async function runProjectStatusPanelTui"),
		source.indexOf("function mainMenuOptions"),
	);
	assert.match(projectPanelBlock, /autoRefresh/u);
	assert.match(projectPanelBlock, /intervalMs:\s*3000/u);
	assert.match(projectPanelBlock, /buildCliHomeStatus/u);
	assert.match(projectPanelBlock, /formatCliProjectStatus/u);

	const menuBlock = source.slice(
		source.indexOf("async function selectSearchableMenu"),
		source.indexOf("async function showTextView"),
	);
	assert.match(menuBlock, /setInterval/u);
	assert.match(menuBlock, /clearInterval/u);
	assert.match(menuBlock, /refreshedContent !== settings\.content/u);
	assert.doesNotMatch(menuBlock, /watchFile|fs\.watch/u);
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
corepack pnpm build && node --test dist/test/cli-home.test.js
```

Expected: test fails because `autoRefresh`, `setInterval`, and cleanup are absent.

- [ ] **Step 3: Extend menu settings type**

In `src/cli.ts`, update `selectSearchableMenu()` settings type to include:

```ts
autoRefresh?: {
	intervalMs: number;
	getContent: () => string;
};
```

- [ ] **Step 4: Add timer lifecycle**

Inside `selectSearchableMenu()`, add a timer variable before `render()`:

```ts
let refreshTimer: NodeJS.Timeout | undefined;
```

After initial `render();`, add:

```ts
if (settings.autoRefresh) {
	refreshTimer = setInterval(() => {
		const refreshedContent = settings.autoRefresh?.getContent();
		if (refreshedContent !== undefined && refreshedContent !== settings.content) {
			settings.content = refreshedContent;
			render();
		}
	}, settings.autoRefresh.intervalMs);
}
```

In `finally`, before restoring terminal state, add:

```ts
if (refreshTimer) clearInterval(refreshTimer);
```

- [ ] **Step 5: Configure project panel auto-refresh**

In `runProjectStatusPanelTui()`, keep the initial status/content for immediate display but pass auto-refresh:

```ts
const buildProjectPanelContent = () =>
	formatCliProjectStatus(
		buildCliHomeStatus({
			argvPath: process.argv[1],
			stdinInteractive: true,
		}),
	);
const choice = await selectMenu(
	"Proyecto actual",
	projectStatusPanelOptions(),
	undefined,
	formatCliProjectStatus(status),
	{
		autoRefresh: {
			intervalMs: 3000,
			getContent: buildProjectPanelContent,
		},
	},
);
```

If `selectMenu()` does not currently accept settings, minimally extend it to merge settings into `selectSearchableMenu()`.

- [ ] **Step 6: Run focused validation**

Run:

```bash
corepack pnpm build && node --test dist/test/cli-home.test.js dist/test/idu-cli.test.js && git diff --check
```

Expected: pass.

## Task 2: Final Validation

- [ ] **Step 1: Run full suite**

```bash
corepack pnpm test && git diff --check
```

Expected: pass.

- [ ] **Step 2: LSP diagnostics**

Check:

```text
src/cli.ts
test/cli-home.test.ts
```

Expected: zero diagnostics.

- [ ] **Step 3: Idu postflight**

Expected files:

```text
src/cli.ts
test/cli-home.test.ts
```

Expected mode: `code`; contracts: `tests`, `agent`.

- [ ] **Step 4: Commit and push**

```bash
git add src/cli.ts test/cli-home.test.ts
git commit -m "feat(idu): auto-refresh project metrics panel"
git push
```

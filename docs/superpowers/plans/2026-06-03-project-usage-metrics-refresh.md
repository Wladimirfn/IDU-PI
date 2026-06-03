# Project Usage Metrics Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual `↻ Actualizar métricas` action to the current project panel.

**Architecture:** Keep refresh control flow in `src/cli.ts`. Replace the one-shot project text view with a small loop that rebuilds `buildCliHomeStatus()` and re-renders `formatCliProjectStatus()` when the refresh action is selected.

**Tech Stack:** TypeScript, Node test runner, existing CLI TUI helpers.

---

## File Structure

- Modify: `src/cli.ts`
  - Add project panel options with refresh/back/exit.
  - Add `runProjectStatusPanelTui()` or equivalent helper.
  - Route main menu `project` choice through the helper.
- Modify: `test/cli-home.test.ts`
  - Add source-level assertions for refresh option and rebuild behavior, following existing interactive source tests.

## Task 1: Add Manual Refresh Project Panel

**Files:**
- Modify: `src/cli.ts`
- Test: `test/cli-home.test.ts`

- [ ] **Step 1: Add failing source assertion test**

Append this test near existing interactive/source tests in `test/cli-home.test.ts`:

```ts
test("project panel exposes manual usage metrics refresh without auto refresh", () => {
	const source = readFileSync(join(process.cwd(), "src", "cli.ts"), "utf8");
	assert.match(source, /↻ Actualizar métricas/u);
	assert.match(source, /runProjectStatusPanelTui/u);
	const projectPanelBlock = source.slice(
		source.indexOf("async function runProjectStatusPanelTui"),
		source.indexOf("function mainMenuOptions"),
	);
	assert.match(projectPanelBlock, /buildCliHomeStatus/u);
	assert.match(projectPanelBlock, /formatCliProjectStatus/u);
	assert.doesNotMatch(projectPanelBlock, /setInterval|setTimeout|watchFile|fs\.watch/u);
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
corepack pnpm build && node --test dist/test/cli-home.test.js
```

Expected: test fails because `runProjectStatusPanelTui` and `↻ Actualizar métricas` do not exist.

- [ ] **Step 3: Add project panel options/helper**

In `src/cli.ts`, add this helper near `mainMenuOptions()`:

```ts
function projectStatusPanelOptions(): MenuOption[] {
	return [
		{ label: "↻ Actualizar métricas", value: "refresh" },
		{ label: "← Volver", value: "back" },
		{ label: "Exit", value: "exit" },
	];
}
```

Add this helper near `runInteractiveHome()`:

```ts
async function runProjectStatusPanelTui(): Promise<"__back" | string> {
	while (true) {
		const status = buildCliHomeStatus({
			argvPath: process.argv[1],
			stdinInteractive: true,
		});
		const choice = await selectMenu(
			"Proyecto actual",
			projectStatusPanelOptions(),
			undefined,
			formatCliProjectStatus(status),
		);
		if (choice === "refresh") continue;
		if (choice === "back") return "__back";
		return "Salida sin cambios.";
	}
}
```

- [ ] **Step 4: Route main project menu through helper**

In `runInteractiveHome()`, replace the current `choice === "project"` block with:

```ts
if (choice === "project") {
	const result = await runProjectStatusPanelTui();
	if (result === "__back") continue;
	return result;
}
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
corepack pnpm build && node --test dist/test/cli-home.test.js
```

Expected: CLI home tests pass.

## Task 2: Validation and Commit

**Files:**
- Verify: `src/cli.ts`, `test/cli-home.test.ts`

- [ ] **Step 1: Run focused validation**

Run:

```bash
node --test dist/test/cli-home.test.js dist/test/idu-cli.test.js && git diff --check
```

Expected: focused CLI tests pass and diff check has no errors.

- [ ] **Step 2: Run full validation**

Run:

```bash
corepack pnpm test && git diff --check
```

Expected: full suite passes.

- [ ] **Step 3: Run LSP diagnostics**

Check:

```text
src/cli.ts
test/cli-home.test.ts
```

Expected: zero diagnostics.

- [ ] **Step 4: Run Idu-pi postflight**

Expected files:

```text
src/cli.ts
test/cli-home.test.ts
```

Expected mode: `code`.
Expected contracts: `tests`, `agent`.

Expected: advisory pass with no blocking action.

- [ ] **Step 5: Commit and push**

Run:

```bash
git add src/cli.ts test/cli-home.test.ts
git commit -m "feat(idu): refresh project usage metrics"
git push
```

Expected: main branch pushed successfully.

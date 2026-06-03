# Unified AgentLab Model Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a simplified Idu-pi model assignment UX that lets users select an Idu-pi/AgentLab role, then choose a provider/model from a unified Pi/Gentle/OpenCode-compatible model catalog without duplicate entries.

**Architecture:** Add a small model-catalog core that normalizes model entries to `provider/modelId`, deduplicates by canonical id, and groups models by provider. The Pi extension/runtime model registry is the preferred source when available; saved catalog snapshots, Gentle routing, `PI_AGENT_PROFILES`, and custom direct model ids remain additive fallback sources. The CLI model menu becomes role-first: select current assignment row → provider → model → confirm → write `stateRoot/model-assignments.json` only after explicit approval.

**Tech Stack:** TypeScript, Node.js, Pi model registry extension context, existing Idu-pi CLI/TUI menu helpers, existing `model-assignments.json`, `node:test`.

---

## File Structure

- Create: `src/model-catalog.ts`
  - Owns `UnifiedModelCatalogEntry`, provider grouping, canonical id normalization, dedupe, and catalog source merging.
  - Reads non-sensitive saved model catalog snapshots and Gentle routing files.
- Modify: `src/model-assignments.ts`
  - Keep current assignment file shape and direct-model compatibility.
  - Add helper to build role assignment options from unified catalog entries.
- Modify: `src/cli.ts`
  - Replace the confusing model profile menu with a role-first flow.
  - Preserve advanced/manual options behind an advanced entry only if needed.
- Optional modify: `.pi/extensions/idu-pi-commands.ts` or the installed/global Idu extension if it can access `ctx.modelRegistry.getAvailable()`.
  - Export a non-sensitive model catalog snapshot for CLI use if current extension architecture permits it.
- Test: `test/model-catalog.test.ts`
  - Unit tests for canonical ids, provider grouping, dedupe, MiniMax/OpenCode preservation, and source annotations.
- Modify test: `test/model-assignments.test.ts`
  - Existing direct model assignment remains valid; add catalog-derived options.
- Modify test: `test/cli-home.test.ts`
  - Role-first UX text and assignment flow.

## Task 1: Add unified model catalog core

**Files:**
- Create: `src/model-catalog.ts`
- Test: `test/model-catalog.test.ts`

- [ ] **Step 1: Write failing tests for dedupe and provider grouping**

Create `test/model-catalog.test.ts` with tests like:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildUnifiedModelCatalog,
  groupModelCatalogByProvider,
  normalizeModelCatalogId,
} from "../src/model-catalog.js";

test("unified catalog deduplicates by provider/model id and preserves sources", () => {
  const catalog = buildUnifiedModelCatalog({
    piModels: [
      { provider: "openai", id: "gpt-5.4", name: "GPT-5.4" },
      { provider: "minimax", id: "MiniMax-M2.7", name: "MiniMax M2.7" },
    ],
    gentleModelIds: ["openai/gpt-5.4", "opencode/minimax-m2.5-free"],
    profileModelIds: ["openai/gpt-5.4"],
  });

  assert.equal(catalog.entries.length, 3);
  const openai = catalog.entries.find((entry) => entry.canonicalId === "openai/gpt-5.4");
  assert.deepEqual(openai?.sources.sort(), ["gentle-routing", "pi-registry", "profile"].sort());
  assert.ok(catalog.entries.some((entry) => entry.canonicalId === "minimax/MiniMax-M2.7"));
  assert.ok(catalog.entries.some((entry) => entry.canonicalId === "opencode/minimax-m2.5-free"));
});

test("catalog groups providers without hardcoding MiniMax or OpenCode", () => {
  const catalog = buildUnifiedModelCatalog({
    piModels: [
      { provider: "minimax", id: "MiniMax-M2.7", name: "MiniMax M2.7" },
      { provider: "opencode", id: "gpt-5.4", name: "GPT-5.4 via OpenCode" },
    ],
  });
  const providers = groupModelCatalogByProvider(catalog.entries).map((group) => group.provider);
  assert.deepEqual(providers, ["minimax", "opencode"]);
});

test("normalizeModelCatalogId accepts provider/model and rejects unsafe text", () => {
  assert.equal(normalizeModelCatalogId("openai/gpt-5.4"), "openai/gpt-5.4");
  assert.equal(normalizeModelCatalogId(" minimax/MiniMax-M2.7 "), "minimax/MiniMax-M2.7");
  assert.equal(normalizeModelCatalogId("not a model"), undefined);
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
corepack pnpm build
```

Expected: fail because `src/model-catalog.ts` does not exist.

- [ ] **Step 3: Implement `src/model-catalog.ts`**

Implement:

```ts
export type ModelCatalogSource = "pi-registry" | "gentle-routing" | "profile" | "custom" | "snapshot";

export type ModelCatalogInputModel = {
  provider: string;
  id: string;
  name?: string;
  inputCost?: number;
  outputCost?: number;
};

export type UnifiedModelCatalogEntry = {
  canonicalId: string;
  provider: string;
  modelId: string;
  label: string;
  aliases: string[];
  sources: ModelCatalogSource[];
  costLabel?: string;
};

export type UnifiedModelCatalog = {
  entries: UnifiedModelCatalogEntry[];
  limitations: string[];
};

export function normalizeModelCatalogId(value: string): string | undefined {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9._~:@%+-]+\/[A-Za-z0-9._~:@%+/-]+$/u.test(trimmed)) return undefined;
  const [provider, ...rest] = trimmed.split("/");
  const modelId = rest.join("/");
  if (!provider || !modelId) return undefined;
  return `${provider}/${modelId}`;
}

export function buildUnifiedModelCatalog(input: {
  piModels?: ModelCatalogInputModel[];
  gentleModelIds?: string[];
  profileModelIds?: string[];
  customModelIds?: string[];
}): UnifiedModelCatalog {
  const byId = new Map<string, UnifiedModelCatalogEntry>();
  const add = (canonicalId: string | undefined, source: ModelCatalogSource, label?: string) => {
    if (!canonicalId) return;
    const [provider, ...rest] = canonicalId.split("/");
    const modelId = rest.join("/");
    if (!provider || !modelId) return;
    const current = byId.get(canonicalId) ?? {
      canonicalId,
      provider,
      modelId,
      label: label || modelId,
      aliases: [],
      sources: [],
    };
    if (label && !current.aliases.includes(label)) current.aliases.push(label);
    if (!current.sources.includes(source)) current.sources.push(source);
    byId.set(canonicalId, current);
  };
  for (const model of input.piModels ?? []) add(normalizeModelCatalogId(`${model.provider}/${model.id}`), "pi-registry", model.name);
  for (const modelId of input.gentleModelIds ?? []) add(normalizeModelCatalogId(modelId), "gentle-routing");
  for (const modelId of input.profileModelIds ?? []) add(normalizeModelCatalogId(modelId), "profile");
  for (const modelId of input.customModelIds ?? []) add(normalizeModelCatalogId(modelId), "custom");
  return {
    entries: [...byId.values()].sort((left, right) => left.provider.localeCompare(right.provider) || left.label.localeCompare(right.label)),
    limitations: [],
  };
}

export function groupModelCatalogByProvider(entries: UnifiedModelCatalogEntry[]): Array<{ provider: string; models: UnifiedModelCatalogEntry[] }> {
  const groups = new Map<string, UnifiedModelCatalogEntry[]>();
  for (const entry of entries) groups.set(entry.provider, [...(groups.get(entry.provider) ?? []), entry]);
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, models]) => ({ provider, models }));
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
corepack pnpm build
node --test dist/test/model-catalog.test.js
```

Expected: pass.

## Task 2: Feed catalog options into model assignments

**Files:**
- Modify: `src/model-assignments.ts`
- Test: `test/model-assignments.test.ts`

- [ ] **Step 1: Add failing test for catalog-derived role options**

Extend `test/model-assignments.test.ts` with:

```ts
import { assignmentOptionsFromModelCatalog } from "../src/model-assignments.js";
import { buildUnifiedModelCatalog } from "../src/model-catalog.js";

test("assignment options include profiles and unified catalog without duplicates", () => {
  const catalog = buildUnifiedModelCatalog({
    piModels: [{ provider: "minimax", id: "MiniMax-M2.7", name: "MiniMax M2.7" }],
    gentleModelIds: ["minimax/MiniMax-M2.7"],
  });
  const options = assignmentOptionsFromModelCatalog(
    [{ id: "default", label: "Pi default", provider: "pi", piArgs: [] }],
    catalog.entries,
  );
  assert.ok(options.some((option) => option.value === "default"));
  assert.equal(options.filter((option) => option.value === "minimax/MiniMax-M2.7").length, 1);
});
```

- [ ] **Step 2: Implement exported helper**

Add to `src/model-assignments.ts`:

```ts
import type { UnifiedModelCatalogEntry } from "./model-catalog.js";

export function assignmentOptionsFromModelCatalog(
  profiles: AgentProfile[],
  catalogEntries: UnifiedModelCatalogEntry[],
): Array<{ value: string; label: string; source: "profile" | "model" | "custom" }> {
  return [
    ...profiles.map((profile) => ({
      value: profile.id,
      label: `${profile.label} (${profile.id}) — ${profileModelLabel(profile)}`,
      source: "profile" as const,
    })),
    ...catalogEntries.map((entry) => ({
      value: entry.canonicalId,
      label: `${entry.label} (${entry.canonicalId})`,
      source: "model" as const,
    })),
    { value: "__custom_model__", label: "Custom model id (provider/model)", source: "custom" as const },
  ];
}
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
corepack pnpm build
node --test dist/test/model-assignments.test.js dist/test/model-catalog.test.js
```

Expected: pass.

## Task 3: Simplify CLI model menu to role-first flow

**Files:**
- Modify: `src/cli.ts`
- Test: `test/cli-home.test.ts`

- [ ] **Step 1: Add failing UX tests**

Update `test/cli-home.test.ts` expectations so the model menu exposes role-first language:

```ts
assert.match(menu, /Modelos Idu-pi/u);
assert.match(menu, /Supervisor principal/u);
assert.match(menu, /AgentLab seguridad/u);
assert.doesNotMatch(menu, /Editar PI_AGENT_PROFILES/u);
```

Add an assignment test that picks a role and model by catalog option where possible.

- [ ] **Step 2: Build catalog in CLI status/menu**

In `src/cli.ts`, replace `modelAssignmentOptions(status)` internals with catalog entries built from:

```ts
const catalog = buildUnifiedModelCatalog({
  gentleModelIds: readGentleModelRouting(status.cwd),
  profileModelIds: status.agentProfiles.map(profileModelLabel).filter(is provider/model),
});
return assignmentOptionsFromModelCatalog(status.agentProfiles, catalog.entries);
```

Keep the custom model fallback.

- [ ] **Step 3: Change TUI flow**

Change the TUI label from mechanism-first to role-first:

```text
Modelos Idu-pi
Asignaciones actuales:
  Supervisor principal        <current>
  AgentLab seguridad          <current>
  ...
```

Selecting a row opens provider groups, then model list. If provider grouping is too large for one slice, keep searchable flat model list but label it as the first implementation limitation in the output.

- [ ] **Step 4: Run focused tests**

Run:

```bash
corepack pnpm build
node --test dist/test/cli-home.test.js dist/test/model-assignments.test.js dist/test/model-catalog.test.js
```

Expected: pass.

## Task 4: Add Pi registry snapshot bridge if current extension can access it safely

**Files:**
- Modify: `.pi/extensions/idu-pi-commands.ts` or relevant Idu-pi extension source if present
- Modify: `src/model-catalog.ts`
- Test: `test/model-catalog.test.ts`

- [ ] **Step 1: Add snapshot read/write type test**

Add test that reads a JSON shape:

```json
{
  "version": 1,
  "generatedAt": "deterministic",
  "source": "pi-model-registry",
  "models": [{ "provider": "minimax", "id": "MiniMax-M2.7", "name": "MiniMax M2.7" }]
}
```

and confirms `buildUnifiedModelCatalog` includes `minimax/MiniMax-M2.7` once.

- [ ] **Step 2: Implement safe snapshot reader**

Read only non-sensitive metadata: provider, id, name, context/cost if available. Do not read or write API keys.

- [ ] **Step 3: If extension context is available, write snapshot**

From extension context:

```ts
const models = await ctx.modelRegistry.getAvailable();
```

Write only under a safe Idu/Gentle config path, for example:

```text
~/.pi/idu-pi/model-catalog.json
```

No secrets, no auth state, no prompts.

- [ ] **Step 4: Run focused tests**

Run:

```bash
corepack pnpm build
node --test dist/test/model-catalog.test.js
```

Expected: pass.

## Task 5: Full verification and publish

**Files:**
- All touched files

- [ ] **Step 1: Run build**

```bash
corepack pnpm build
```

Expected: no TypeScript errors.

- [ ] **Step 2: Run focused tests**

```bash
node --test dist/test/model-catalog.test.js dist/test/model-assignments.test.js dist/test/cli-home.test.js
```

Expected: pass.

- [ ] **Step 3: Run full suite and diff check**

```bash
corepack pnpm test && git diff --check
```

Expected: full suite pass, no whitespace errors.

- [ ] **Step 4: Run LSP diagnostics**

Use Pi LSP diagnostics on touched files.

Expected: zero diagnostics.

- [ ] **Step 5: Fresh review**

Run fresh reviewer focused on:

- no duplicate model entries;
- MiniMax/OpenCode preserved as dynamic providers;
- role-first UX;
- no secret reads/writes;
- no automatic AgentLab execution;
- assignments still require confirmation.

Expected: PASS.

- [ ] **Step 6: Idu postflight**

Run `idu_postflight` with expected files/contracts.

Expected: advisory ok, no unexpected files.

- [ ] **Step 7: Commit and push explicit paths only**

```bash
git add src/model-catalog.ts src/model-assignments.ts src/cli.ts test/model-catalog.test.ts test/model-assignments.test.ts test/cli-home.test.ts docs/superpowers/plans/2026-06-03-unified-agentlab-model-catalog.md
git commit -m "feat(idu): unify AgentLab model catalog"
git push
```

Expected: branch pushed and `git status --short --branch` clean.

## Self-Review

- Spec coverage: The plan covers role-first UX, unified catalog, Pi registry preference, Gentle routing fallback, OpenCode/MiniMax dynamic provider support, dedupe by `provider/modelId`, and compatibility with existing profiles/direct model assignments.
- Placeholder scan: No TBD/TODO/fill-in placeholders remain. Task 4 is explicitly optional based on extension availability, with a safe fallback path.
- Type consistency: `UnifiedModelCatalogEntry`, `assignmentOptionsFromModelCatalog`, and `Context` names are consistent across tasks.
- Scope: This is a medium slice. If Task 4 requires broad extension/runtime changes, split it into a follow-up and ship Tasks 1-3 first.

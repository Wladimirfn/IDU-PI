# Source-Derived Skill Candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate reports-only skill candidates from existing Source Library digests, with optional SKILL.md draft previews, without installing real skills or running AgentLabs.

**Architecture:** Add a focused `source-skill-candidates` module that reads the existing Source Library index/digest artifacts, derives deterministic candidates from digest topics/useWhen/recommendedReads, and writes a timestamped JSON report under `stateRoot/reports`. CLI and MCP expose create/review commands as advisory-only surfaces with no `.agents`, `.atl`, contract, or repo writes.

**Tech Stack:** TypeScript, Node.js filesystem APIs, existing Source Library digest/index structures, Node test runner, Idu-pi CLI/MCP runtime wrappers.

---

## File structure

- Create `src/source-skill-candidates.ts`
  - Owns source-derived candidate types, report creation, review/validation, formatting, and report path safety.
  - Reads `sourceLibraryPaths(stateRoot, projectId)` and digest JSON files already produced by `src/source-digest.ts`.
  - Writes only `reportsPath/source-skill-candidates-YYYYMMDD-HHMMSS.json`.
- Add `test/source-skill-candidates.test.ts`
  - Unit tests for missing index, candidate creation, report-only draft preview, specialized-reader skip, path safety, latest review.
- Modify `src/cli.ts`
  - Add runtime methods and command cases for create/review.
  - Add help text.
- Modify `src/mcp-server.ts`
  - Add MCP tool names, schemas, and advisory envelope cases.
- Modify `src/command-catalog.ts`
  - Add command catalog entries.
- Update tests:
  - `test/idu-cli.test.ts`
  - `test/mcp-server.test.ts`
  - `test/command-catalog.test.ts`
- Optionally update command docs if currently maintained for these surfaces:
  - `docs/cli-commands.md`
  - `docs/mcp-server.md`

No real skill file should be created by this slice.

---

### Task 1: Core source skill candidate module

**Files:**
- Create: `src/source-skill-candidates.ts`
- Test: `test/source-skill-candidates.test.ts`

- [ ] **Step 1: Write failing tests for report creation and safety**

Create `test/source-skill-candidates.test.ts` with:

```ts
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	createSourceSkillCandidates,
	formatSourceSkillCandidateCreationResult,
	reviewSourceSkillCandidates,
} from "../src/source-skill-candidates.js";
import { sourceLibraryPaths } from "../src/source-library.js";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-source-skill-candidates-"));
}

function writeDigest(stateRoot: string, projectId: string, sourceId: string, overrides: Record<string, unknown> = {}): void {
	const paths = sourceLibraryPaths(stateRoot, projectId);
	mkdirSync(paths.digestsDir, { recursive: true });
	mkdirSync(paths.chunksDir, { recursive: true });
	const chunkDir = join(paths.chunksDir, sourceId);
	mkdirSync(chunkDir, { recursive: true });
	writeFileSync(join(chunkDir, "chunk-001.md"), "Use small focused JavaScript modules with explicit tests.", "utf8");
	writeFileSync(
		paths.libraryIndexPath,
		JSON.stringify({
			version: 1,
			projectId,
			updatedAt: "2026-06-03T00:00:00.000Z",
			contractPromotionAllowed: false,
			entries: [
				{
					sourceId,
					title: "JavaScript engineering practices",
					kind: "manual_doc",
					topics: ["JavaScript", "testing", "engineering"],
					useWhen: ["JavaScript refactor", "frontend module", "API logic"],
					recommendedReads: ["chunk-001"],
					limitations: [],
					updatedAt: "2026-06-03T00:00:00.000Z",
				},
			],
		}),
		"utf8",
	);
	writeFileSync(
		join(paths.digestsDir, `${sourceId}.json`),
		JSON.stringify({
			version: 1,
			projectId,
			sourceId,
			title: "JavaScript engineering practices",
			kind: "manual_doc",
			generatedAt: "2026-06-03T00:00:00.000Z",
			processingMode: "direct",
			summary: "Reusable JavaScript engineering practices for maintainable modules and tests.",
			topics: ["JavaScript", "testing", "engineering"],
			useWhen: ["JavaScript refactor", "frontend module", "API logic"],
			chunks: [
				{
					chunkId: "chunk-001",
					title: "Engineering practice",
					path: join(chunkDir, "chunk-001.md"),
					summary: "Use focused modules and explicit tests.",
					topics: ["JavaScript", "testing"],
				},
			],
			recommendedReads: ["chunk-001"],
			limitations: [],
			contractPromotionAllowed: false,
			...overrides,
		}),
		"utf8",
	);
}

test("source skill candidates reports missing source index without creating skills", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		const result = createSourceSkillCandidates({
			stateRoot: root,
			reportsPath,
			projectId: "idu-pi",
			now: new Date("2026-06-03T12:00:00.000Z"),
		});
		assert.equal(result.ok, true);
		assert.equal(result.report.candidates.length, 0);
		assert.match(result.report.limitations.join("\n"), /source library index/i);
		assert.equal(existsSync(join(root, ".agents")), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source skill candidates create reports-only draft preview from digest evidence", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		writeDigest(root, "idu-pi", "source-js");
		const result = createSourceSkillCandidates({
			stateRoot: root,
			reportsPath,
			projectId: "idu-pi",
			now: new Date("2026-06-03T12:00:00.000Z"),
		});
		assert.equal(result.ok, true);
		assert.equal(result.report.candidates.length, 1);
		const candidate = result.report.candidates[0]!;
		assert.equal(candidate.requiresHumanApproval, true);
		assert.equal(candidate.contractPromotionAllowed, false);
		assert.equal(candidate.tokensCostMeasured, false);
		assert.equal(candidate.efficiencyEvidence, "no medido");
		assert.deepEqual(candidate.sourceIds, ["source-js"]);
		assert.deepEqual(candidate.chunkIds, ["chunk-001"]);
		assert.match(candidate.draftPreview, /^---\nname: /u);
		assert.match(candidate.draftPreview, /Source evidence/u);
		assert.equal(existsSync(join(root, ".agents")), false);
		assert.equal(existsSync(result.path), true);
		assert.match(formatSourceSkillCandidateCreationResult(result), /Reports-only/u);
		assert.match(formatSourceSkillCandidateCreationResult(result), /tokens\/cost: no medido/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source skill candidates skip specialized-reader digests", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		writeDigest(root, "idu-pi", "source-pdf", {
			processingMode: "requires_specialized_reader",
			requiredAction: {
				type: "dispatch_librarian_reader",
				sourceId: "source-pdf",
				reason: "PDF requires reader",
			},
		});
		const result = createSourceSkillCandidates({
			stateRoot: root,
			reportsPath,
			projectId: "idu-pi",
			now: new Date("2026-06-03T12:00:00.000Z"),
		});
		assert.equal(result.report.candidates.length, 0);
		assert.match(result.report.requiredActions.join("\n"), /source-pdf/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("source skill candidates review latest validates reports and rejects unsafe paths", () => {
	const root = tempRoot();
	try {
		const reportsPath = join(root, "reports");
		writeDigest(root, "idu-pi", "source-js");
		const created = createSourceSkillCandidates({
			stateRoot: root,
			reportsPath,
			projectId: "idu-pi",
			now: new Date("2026-06-03T12:00:00.000Z"),
		});
		const review = reviewSourceSkillCandidates("latest", reportsPath);
		assert.equal(review.ok, true);
		assert.equal(review.path, created.path);
		assert.equal(review.report?.candidates.length, 1);
		const unsafe = reviewSourceSkillCandidates(join(root, "outside.json"), reportsPath);
		assert.equal(unsafe.ok, false);
		assert.match(unsafe.errors.join("\n"), /outside reports/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
corepack pnpm build
```

Expected: FAIL because `../src/source-skill-candidates.js` does not exist.

- [ ] **Step 3: Implement core module**

Create `src/source-skill-candidates.ts` with:

```ts
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sourceLibraryPaths } from "./source-library.js";

export type SourceSkillCandidate = {
	candidateId: string;
	title: string;
	suggestedSkillName: string;
	purpose: string;
	triggers: string[];
	sourceIds: string[];
	chunkIds: string[];
	evidenceRefs: string[];
	draftTargetPath: string;
	draftPreview: string;
	limitations: string[];
	duplicateHints: string[];
	requiresHumanApproval: true;
	contractPromotionAllowed: false;
	tokensCostMeasured: false;
	efficiencyEvidence: "no medido";
};

export type SourceSkillCandidateReport = {
	version: 1;
	projectId: string;
	createdAt: string;
	source: "source_library";
	warning: string;
	contractPromotionAllowed: false;
	requiresHumanApproval: true;
	tokensCostMeasured: false;
	efficiencyEvidence: "no medido";
	candidates: SourceSkillCandidate[];
	limitations: string[];
	requiredActions: string[];
};

export type CreateSourceSkillCandidatesOptions = {
	stateRoot: string;
	reportsPath: string;
	projectId: string;
	selector?: string;
	maxCandidates?: number;
	now?: Date;
};

export type SourceSkillCandidateCreationResult = {
	ok: true;
	path: string;
	report: SourceSkillCandidateReport;
};

export type SourceSkillCandidateReview =
	| { ok: true; path: string; report: SourceSkillCandidateReport; errors: [] }
	| { ok: false; path?: string; report?: undefined; errors: string[] };

const FILE_PREFIX = "source-skill-candidates-";
const WARNING = "Source-derived skill candidates. Reports-only; no real skills, .agents, .atl, contracts, or project code were modified.";

export function createSourceSkillCandidates(options: CreateSourceSkillCandidatesOptions): SourceSkillCandidateCreationResult {
	const now = options.now ?? new Date();
	const maxCandidates = Math.max(1, options.maxCandidates ?? 5);
	const paths = sourceLibraryPaths(options.stateRoot, options.projectId);
	const limitations: string[] = [];
	const requiredActions: string[] = [];
	const candidates: SourceSkillCandidate[] = [];
	if (!existsSync(paths.libraryIndexPath)) {
		limitations.push(`Missing source library index: ${paths.libraryIndexPath}`);
	} else {
		const entries = readLibraryIndexEntries(paths.libraryIndexPath, limitations);
		for (const entry of entries) {
			if (candidates.length >= maxCandidates) break;
			if (options.selector && options.selector !== "all" && options.selector !== "latest" && entry.sourceId !== options.selector) continue;
			const digestPath = join(paths.digestsDir, `${entry.sourceId}.json`);
			const digest = readDigest(digestPath, limitations);
			if (!digest) continue;
			if (digest.processingMode === "requires_specialized_reader") {
				requiredActions.push(`source ${entry.sourceId} requires specialized reader before skill extraction`);
				continue;
			}
			const candidate = candidateFromDigest(entry, digest, digestPath);
			if (candidate) candidates.push(candidate);
			else limitations.push(`source ${entry.sourceId} did not contain reusable skill signals`);
		}
	}
	if (!candidates.length && !limitations.length) limitations.push("No reusable source-derived skill candidates found.");
	const report: SourceSkillCandidateReport = {
		version: 1,
		projectId: safeSlug(options.projectId),
		createdAt: now.toISOString(),
		source: "source_library",
		warning: WARNING,
		contractPromotionAllowed: false,
		requiresHumanApproval: true,
		tokensCostMeasured: false,
		efficiencyEvidence: "no medido",
		candidates,
		limitations,
		requiredActions,
	};
	mkdirSync(options.reportsPath, { recursive: true });
	const path = join(options.reportsPath, `${FILE_PREFIX}${timestamp(now)}.json`);
	writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	return { ok: true, path, report };
}

export function reviewSourceSkillCandidates(pathOrLatest: string, reportsPath: string): SourceSkillCandidateReview {
	const resolved = resolveReportPath(pathOrLatest || "latest", reportsPath);
	if (!resolved.ok) return { ok: false, errors: resolved.errors };
	try {
		const parsed: unknown = JSON.parse(readFileSync(resolved.path, "utf8"));
		const report = parseReport(parsed);
		if (!report) return { ok: false, path: resolved.path, errors: ["Invalid source skill candidate report schema"] };
		return { ok: true, path: resolved.path, report, errors: [] };
	} catch (error) {
		return { ok: false, path: resolved.path, errors: [error instanceof Error ? error.message : String(error)] };
	}
}

export function formatSourceSkillCandidateCreationResult(result: SourceSkillCandidateCreationResult): string {
	return [
		"Source skill candidates",
		"",
		`candidates: ${result.report.candidates.length}`,
		`report: ${result.path}`,
		`warning: ${result.report.warning}`,
		"tokens/cost: no medido",
		"",
		"candidates:",
		...(result.report.candidates.length ? result.report.candidates.map((candidate) => `- ${candidate.suggestedSkillName}: ${candidate.title}`) : ["- none"]),
		...(result.report.limitations.length ? ["", "limitations:", ...result.report.limitations.map((item) => `- ${item}`)] : []),
		...(result.report.requiredActions.length ? ["", "required actions:", ...result.report.requiredActions.map((item) => `- ${item}`)] : []),
	].join("\n");
}

export function formatSourceSkillCandidateReview(review: SourceSkillCandidateReview): string {
	if (!review.ok) return ["Source skill candidates review", "", "Estado:", "invalid", "", "Errores:", ...review.errors.map((error) => `- ${error}`)].join("\n");
	return [
		"Source skill candidates review",
		"",
		"Estado:",
		"valid",
		"",
		`Archivo: ${review.path}`,
		`candidates: ${review.report.candidates.length}`,
		`warning: ${review.report.warning}`,
		"tokens/cost: no medido",
	].join("\n");
}
```

Then add helper functions in the same file:

```ts
type IndexEntry = { sourceId: string; title?: string; topics?: string[]; useWhen?: string[]; recommendedReads?: string[]; limitations?: string[] };
type Digest = { sourceId: string; title: string; processingMode?: string; summary?: string; topics?: string[]; useWhen?: string[]; recommendedReads?: string[]; limitations?: string[] };

function readLibraryIndexEntries(path: string, limitations: string[]): IndexEntry[] {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as { entries?: unknown };
		if (!Array.isArray(parsed.entries)) return [];
		return parsed.entries.flatMap((entry) => isRecord(entry) && typeof entry.sourceId === "string" ? [{
			sourceId: entry.sourceId,
			title: typeof entry.title === "string" ? entry.title : undefined,
			topics: stringArray(entry.topics),
			useWhen: stringArray(entry.useWhen),
			recommendedReads: stringArray(entry.recommendedReads),
			limitations: stringArray(entry.limitations),
		}] : []);
	} catch (error) {
		limitations.push(`Could not read source library index: ${error instanceof Error ? error.message : String(error)}`);
		return [];
	}
}

function readDigest(path: string, limitations: string[]): Digest | undefined {
	try {
		if (!existsSync(path)) {
			limitations.push(`Missing source digest: ${path}`);
			return undefined;
		}
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(parsed) || typeof parsed.sourceId !== "string" || typeof parsed.title !== "string") return undefined;
		return {
			sourceId: parsed.sourceId,
			title: parsed.title,
			processingMode: typeof parsed.processingMode === "string" ? parsed.processingMode : undefined,
			summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
			topics: stringArray(parsed.topics),
			useWhen: stringArray(parsed.useWhen),
			recommendedReads: stringArray(parsed.recommendedReads),
			limitations: stringArray(parsed.limitations),
		};
	} catch (error) {
		limitations.push(`Could not read source digest ${path}: ${error instanceof Error ? error.message : String(error)}`);
		return undefined;
	}
}

function candidateFromDigest(entry: IndexEntry, digest: Digest, digestPath: string): SourceSkillCandidate | undefined {
	const topics = unique([...(digest.topics ?? []), ...(entry.topics ?? [])]).slice(0, 6);
	const triggers = unique([...(digest.useWhen ?? []), ...(entry.useWhen ?? [])]).slice(0, 6);
	const chunkIds = unique([...(digest.recommendedReads ?? []), ...(entry.recommendedReads ?? [])]).slice(0, 6);
	const signalText = [...topics, ...triggers, digest.summary ?? "", digest.title].join(" ").toLowerCase();
	if (!/(practice|practices|testing|test|engineering|architecture|design|security|javascript|typescript|workflow|pattern|standard|convention|quality|review)/u.test(signalText)) return undefined;
	const suggestedSkillName = safeSlug(`${topics[0] ?? digest.title}-${digest.title}`).slice(0, 64);
	const title = digest.title;
	const candidateId = `source-skill-${safeSlug(digest.sourceId)}-${safeSlug(suggestedSkillName)}`.slice(0, 96);
	const evidenceRefs = chunkIds.length ? chunkIds.map((chunkId) => `${digest.sourceId}/${chunkId}`) : [`${digest.sourceId}/digest`];
	return {
		candidateId,
		title,
		suggestedSkillName,
		purpose: `Apply source-backed guidance from ${title}.`,
		triggers: triggers.length ? triggers : topics.map((topic) => `${topic} task`),
		sourceIds: [digest.sourceId],
		chunkIds,
		evidenceRefs,
		draftTargetPath: `.agents/skills/${suggestedSkillName}/SKILL.md`,
		draftPreview: skillDraftPreview(suggestedSkillName, title, triggers, topics, evidenceRefs, digestPath),
		limitations: [...(digest.limitations ?? []), ...(entry.limitations ?? [])],
		duplicateHints: [],
		requiresHumanApproval: true,
		contractPromotionAllowed: false,
		tokensCostMeasured: false,
		efficiencyEvidence: "no medido",
	};
}

function skillDraftPreview(name: string, title: string, triggers: string[], topics: string[], evidenceRefs: string[], digestPath: string): string {
	return [
		"---",
		`name: ${name}`,
		`description: Source-derived candidate from ${title}. Requires human approval before installation.`,
		"---",
		"",
		"# Source-derived skill candidate",
		"",
		"Use this candidate only after human approval and AgentLab review when required.",
		"",
		"## Triggers",
		...(triggers.length ? triggers.map((item) => `- ${item}`) : ["- Source-backed task matching the evidence below"]),
		"",
		"## Guidance topics",
		...(topics.length ? topics.map((item) => `- ${item}`) : ["- Review source digest before use"]),
		"",
		"## Source evidence",
		`- digest: ${digestPath}`,
		...evidenceRefs.map((ref) => `- ${ref}`),
		"",
		"## Limits",
		"- Reports-only candidate; do not install without approval.",
		"- tokens/cost: no medido",
	].join("\n");
}

function resolveReportPath(pathOrLatest: string, reportsPath: string): { ok: true; path: string } | { ok: false; errors: string[] } {
	const reportsRoot = resolve(reportsPath);
	if (pathOrLatest === "latest") {
		const latest = latestReportFile(reportsRoot);
		return latest ? { ok: true, path: latest } : { ok: false, errors: ["No source skill candidate reports found"] };
	}
	const resolved = resolve(pathOrLatest);
	if (!resolved.startsWith(reportsRoot)) return { ok: false, errors: ["Report path is outside reports directory"] };
	if (!existsSync(resolved)) return { ok: false, errors: [`Report not found: ${resolved}`] };
	return { ok: true, path: resolved };
}

function latestReportFile(reportsRoot: string): string | undefined {
	if (!existsSync(reportsRoot)) return undefined;
	return readdirSync(reportsRoot)
		.filter((name) => name.startsWith(FILE_PREFIX) && name.endsWith(".json"))
		.sort()
		.at(-1)
		? join(reportsRoot, readdirSync(reportsRoot).filter((name) => name.startsWith(FILE_PREFIX) && name.endsWith(".json")).sort().at(-1)!)
		: undefined;
}

function parseReport(value: unknown): SourceSkillCandidateReport | undefined {
	if (!isRecord(value) || value.version !== 1 || value.source !== "source_library") return undefined;
	if (!Array.isArray(value.candidates) || !Array.isArray(value.limitations) || !Array.isArray(value.requiredActions)) return undefined;
	return value as SourceSkillCandidateReport;
}

function timestamp(date: Date): string {
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function safeSlug(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "source-skill";
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}

function unique(values: string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
```

- [ ] **Step 4: Run focused GREEN tests**

Run:

```bash
corepack pnpm build && node --test dist/test/source-skill-candidates.test.js
```

Expected: PASS.

---

### Task 2: CLI runtime and command wiring

**Files:**
- Modify: `src/cli.ts`
- Test: `test/idu-cli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Add to `test/idu-cli.test.ts` near other command wiring tests:

```ts
test("CLI source skill candidate commands funcionan reports-only", async () => {
	await withRuntime(async (runtime) => {
		runtime.sourceSkillCandidatesCreate = (selector = "all") => ({
			ok: true,
			path: "reports/source-skill-candidates-20260603-120000.json",
			report: {
				version: 1,
				projectId: "idu-pi",
				createdAt: "2026-06-03T12:00:00.000Z",
				source: "source_library",
				warning: `selector ${selector}; Reports-only`,
				contractPromotionAllowed: false,
				requiresHumanApproval: true,
				tokensCostMeasured: false,
				efficiencyEvidence: "no medido",
				candidates: [],
				limitations: [],
				requiredActions: [],
			},
		});
		runtime.sourceSkillCandidatesReview = () => ({
			ok: true,
			path: "reports/source-skill-candidates-20260603-120000.json",
			errors: [],
			report: {
				version: 1,
				projectId: "idu-pi",
				createdAt: "2026-06-03T12:00:00.000Z",
				source: "source_library",
				warning: "Reports-only",
				contractPromotionAllowed: false,
				requiresHumanApproval: true,
				tokensCostMeasured: false,
				efficiencyEvidence: "no medido",
				candidates: [],
				limitations: [],
				requiredActions: [],
			},
		});

		const create = await runCliCommand(["idu-source-skill-candidates-create", "all"], runtime);
		assert.equal(create.exitCode, 0);
		assert.match(create.stdout, /Source skill candidates/u);
		assert.match(create.stdout, /Reports-only/u);
		assert.match(create.stdout, /tokens\/cost: no medido/u);

		const review = await runCliCommand(["idu-source-skill-candidates-review", "latest"], runtime);
		assert.equal(review.exitCode, 0);
		assert.match(review.stdout, /Source skill candidates review/u);
	});
});
```

If the existing `CliRuntime` fake cannot be reassigned directly, adjust the fake runtime factory in the test to include these methods instead.

- [ ] **Step 2: Run RED**

Run:

```bash
corepack pnpm build
```

Expected: FAIL because CLI runtime lacks the new methods.

- [ ] **Step 3: Wire CLI runtime**

In `src/cli.ts`:

1. Import from the new module:

```ts
import {
	createSourceSkillCandidates,
	formatSourceSkillCandidateCreationResult,
	formatSourceSkillCandidateReview,
	reviewSourceSkillCandidates,
	type SourceSkillCandidateCreationResult,
	type SourceSkillCandidateReview,
} from "./source-skill-candidates.js";
```

2. Add to `CliRuntime`:

```ts
sourceSkillCandidatesCreate: (selector?: string) => SourceSkillCandidateCreationResult;
sourceSkillCandidatesReview: (pathOrLatest: string) => SourceSkillCandidateReview;
formatSourceSkillCandidateCreationResult: (result: SourceSkillCandidateCreationResult) => string;
formatSourceSkillCandidateReview: (review: SourceSkillCandidateReview) => string;
```

3. Add to `createCliRuntime()`:

```ts
sourceSkillCandidatesCreate: (selector = "all") =>
	createSourceSkillCandidates({
		stateRoot: masterPlanStateRoot,
		reportsPath,
		projectId: activeProject.id,
		selector,
	}),
sourceSkillCandidatesReview: (pathOrLatest: string) =>
	reviewSourceSkillCandidates(pathOrLatest, reportsPath),
formatSourceSkillCandidateCreationResult,
formatSourceSkillCandidateReview,
```

4. Add command cases near source commands:

```ts
case "idu-source-skill-candidates-create":
case "source-skill-candidates-create": {
	const activeRuntime = requireRuntime();
	return {
		exitCode: 0,
		stdout: activeRuntime.formatSourceSkillCandidateCreationResult(
			activeRuntime.sourceSkillCandidatesCreate(rest.join(" ").trim() || "all"),
		),
		stderr: "",
	};
}
case "idu-source-skill-candidates-review":
case "source-skill-candidates-review": {
	const activeRuntime = requireRuntime();
	return {
		exitCode: 0,
		stdout: activeRuntime.formatSourceSkillCandidateReview(
			activeRuntime.sourceSkillCandidatesReview(rest.join(" ").trim() || "latest"),
		),
		stderr: "",
	};
}
```

5. Add help text:

```ts
"  idu-pi idu-source-skill-candidates-create all",
"  idu-pi idu-source-skill-candidates-review latest",
```

- [ ] **Step 4: Run focused CLI tests**

Run:

```bash
corepack pnpm build && node --test dist/test/idu-cli.test.js --test-name-pattern "source skill candidate"
```

Expected: PASS.

---

### Task 3: Command catalog entries

**Files:**
- Modify: `src/command-catalog.ts`
- Test: `test/command-catalog.test.ts`

- [ ] **Step 1: Write failing catalog assertions**

Add assertions near source/skill command catalog tests:

```ts
assert.match(text, /\/source_skill_candidates_create/);
assert.match(text, /\/source_skill_candidates_review/);
assert.match(text, /corepack pnpm cli -- idu-source-skill-candidates-create all/);
assert.match(text, /corepack pnpm cli -- idu-source-skill-candidates-review latest/);
```

- [ ] **Step 2: Run RED**

Run:

```bash
corepack pnpm build && node --test dist/test/command-catalog.test.js
```

Expected: FAIL because commands are missing.

- [ ] **Step 3: Add catalog entries**

In `src/command-catalog.ts`, add two command definitions matching existing source/skill entries:

```ts
{
	command: "source_skill_candidates_create",
	description: "Propone candidatos de skill desde fuentes digeridas; reports-only.",	
	cli: "corepack pnpm cli -- idu-source-skill-candidates-create all",
},
{
	command: "source_skill_candidates_review",
	description: "Revisa el último reporte de candidatos de skill desde fuentes.",
	cli: "corepack pnpm cli -- idu-source-skill-candidates-review latest",
},
```

Use the exact field names/style used by the existing catalog.

- [ ] **Step 4: Run catalog tests**

Run:

```bash
corepack pnpm build && node --test dist/test/command-catalog.test.js
```

Expected: PASS.

---

### Task 4: MCP advisory tools

**Files:**
- Modify: `src/mcp-server.ts`
- Test: `test/mcp-server.test.ts`

- [ ] **Step 1: Write failing MCP tests**

Add test cases near source MCP tests:

```ts
test("MCP exposes source skill candidate tools as advisory reports-only", async () => {
	const tools = await callListTools();
	const names = tools.map((tool) => tool.name);
	assert.ok(names.includes("idu_source_skill_candidates_create"));
	assert.ok(names.includes("idu_source_skill_candidates_review"));
});

test("MCP source skill candidates create returns advisory envelope", async () => {
	const result = await callTool("idu_source_skill_candidates_create", {
		projectPath: PROJECT_PATH,
		selector: "all",
	});
	assert.equal(result.ok, true);
	assert.equal(result.tool, "idu_source_skill_candidates_create");
	assert.match(JSON.stringify(result.safeNotes), /No modifiqué skills reales|reports-only|AgentLabs/u);
});
```

Adapt helper names to the existing `test/mcp-server.test.ts` conventions.

- [ ] **Step 2: Run RED**

Run:

```bash
corepack pnpm build && node --test dist/test/mcp-server.test.js --test-name-pattern "source skill candidate"
```

Expected: FAIL because MCP tools are missing.

- [ ] **Step 3: Wire MCP tools**

In `src/mcp-server.ts`:

1. Extend tool name union:

```ts
| "idu_source_skill_candidates_create"
| "idu_source_skill_candidates_review"
```

2. Add tool definitions with schemas:

```ts
{
	name: "idu_source_skill_candidates_create",
	description: "Crea reporte reports-only de candidatos de skill derivados de Source Library; no instala skills ni ejecuta AgentLabs.",
	inputSchema: {
		type: "object",
		properties: {
			projectPath: { type: "string" },
			selector: { type: "string", description: "all, latest, or sourceId" },
		},
	},
},
{
	name: "idu_source_skill_candidates_review",
	description: "Revisa reporte de candidatos de skill desde fuentes; advisory-only.",
	inputSchema: {
		type: "object",
		properties: {
			projectPath: { type: "string" },
			selector: { type: "string", description: "latest or report path" },
		},
	},
},
```

3. Add runtime calls in the tool switch. Use the existing project resolution pattern and envelope helper. Safe notes must include:

```ts
"No modifiqué skills reales, .agents ni .atl.",
"No ejecuté AgentLabs.",
"No promoví contratos ni Master Plan.",
"Reporte reports-only en stateRoot/reports.",
"tokens/cost: no medido."
```

4. When candidates exist, add/return a decision envelope with:

```ts
recommendation: "warn"
orchestratorDecisionRequired: true
requiresHuman: true
allowedToProceed: true
summary: "Revisar candidatos antes de instalar o auditar con AgentLabs."
```

Use existing decision envelope style; do not invent authority.

- [ ] **Step 4: Run focused MCP tests**

Run:

```bash
corepack pnpm build && node --test dist/test/mcp-server.test.js --test-name-pattern "source skill candidate"
```

Expected: PASS.

---

### Task 5: Documentation and command help consistency

**Files:**
- Modify as applicable: `docs/cli-commands.md`, `docs/mcp-server.md`
- Test: existing doc/catalog tests if any cover these docs

- [ ] **Step 1: Add concise docs**

In `docs/cli-commands.md`, add:

```md
### Source-derived skill candidates

```bash
idu-pi idu-source-skill-candidates-create all
idu-pi idu-source-skill-candidates-review latest
```

Creates/reviews reports-only skill candidates derived from registered Source Library digests. Does not install skills, edit `.agents`/`.atl`, run AgentLabs, or promote contracts. Tokens/cost remain `no medido` unless structured evidence exists.
```

In `docs/mcp-server.md`, add MCP tool descriptions for:

```text
idu_source_skill_candidates_create
idu_source_skill_candidates_review
```

Use advisory-only language.

- [ ] **Step 2: Run doc-related tests if present**

Run:

```bash
corepack pnpm build && node --test dist/test/command-catalog.test.js
```

Expected: PASS.

---

### Task 6: Final verification, postflight, memory, commit, push

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run LSP diagnostics**

Use pi-lens LSP diagnostics for:

```text
src/source-skill-candidates.ts
src/cli.ts
src/mcp-server.ts
src/command-catalog.ts
test/source-skill-candidates.test.ts
test/idu-cli.test.ts
test/mcp-server.test.ts
test/command-catalog.test.ts
```

Expected: 0 diagnostics.

- [ ] **Step 2: Run focused validation**

Run:

```bash
corepack pnpm build && node --test dist/test/source-skill-candidates.test.js dist/test/idu-cli.test.js dist/test/mcp-server.test.js dist/test/command-catalog.test.js --test-name-pattern "source skill|source_skill|source-skill" && git diff --check
```

Expected: build succeeds, focused tests pass, diff check passes.

- [ ] **Step 3: Run full validation**

Run:

```bash
corepack pnpm test && git diff --check
```

Expected: full suite passes with 0 failures.

- [ ] **Step 4: Run Idu-pi postflight**

Use expected files actually changed, likely:

```json
{
  "projectPath": "C:/Users/elmas/pi-telegram-bridge",
  "expectedChangeMode": "code",
  "expectedFiles": [
    "src/source-skill-candidates.ts",
    "src/cli.ts",
    "src/mcp-server.ts",
    "src/command-catalog.ts",
    "test/source-skill-candidates.test.ts",
    "test/idu-cli.test.ts",
    "test/mcp-server.test.ts",
    "test/command-catalog.test.ts",
    "docs/cli-commands.md",
    "docs/mcp-server.md"
  ],
  "expectedContracts": ["tests", "agent"]
}
```

Expected: `allowedToProceed: true`.

- [ ] **Step 5: Save memory**

Save a project memory:

```text
**What**: Implemented reports-only source-derived skill candidates from Source Library digests.
**Why**: Documentation should produce auditable project skill candidates without installing skills or inventing cost/token benefits.
**Where**: src/source-skill-candidates.ts, CLI/MCP surfaces, tests.
**Learned**: Candidates must carry source/chunk evidence, human approval requirement, no contract promotion, and `tokens/cost: no medido`.
```

- [ ] **Step 6: Commit explicit paths only**

Run with actual changed paths:

```bash
git add src/source-skill-candidates.ts src/cli.ts src/mcp-server.ts src/command-catalog.ts test/source-skill-candidates.test.ts test/idu-cli.test.ts test/mcp-server.test.ts test/command-catalog.test.ts docs/cli-commands.md docs/mcp-server.md docs/superpowers/plans/2026-06-03-source-derived-skill-candidates.md
git commit -m "feat(idu): add source skill candidates"
git push
```

Expected: branch clean and pushed.

---

## Self-review

- Spec coverage: The plan covers source-derived candidates, reports-only stateRoot artifacts, draft preview inside JSON, CLI/MCP advisory surfaces, no AgentLabs, no skill installation, no contract promotion, no measured token/cost claims, unreadable-source limitations, and tests.
- Placeholder scan: No unfinished placeholder markers remain.
- Type consistency: `SourceSkillCandidate`, `SourceSkillCandidateReport`, `createSourceSkillCandidates`, and `reviewSourceSkillCandidates` are defined before CLI/MCP references.
- Scope check: Duplicate merge, AgentLab skill comprehension tests, human approval/apply flows, and real skill installation remain future slices.
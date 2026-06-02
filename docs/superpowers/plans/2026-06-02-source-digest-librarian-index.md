# Source Digest & Librarian Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe NotebookLM-like librarian layer for Idu-pi that digests registered sources, chunks large readable documents, and recommends relevant sources/chunks to the orchestrator.

**Architecture:** Extend Source Library with stateRoot-only conversion/chunk/digest artifacts. PDF conversion is best-effort and safe: try embedded-text conversion without OCR or new dependencies; if conversion fails, keep the PDF metadata-only and mark it pending conversion. A separate source digest module builds deterministic advisory summaries, chunk metadata, and task recommendations from readable text.

**Tech Stack:** TypeScript, Node built-ins only, existing CLI/MCP runtime, node:test.

---

### Task 1: Add source artifact directories and safe PDF conversion metadata

**Files:**
- Modify: `src/source-library.ts`
- Test: `test/source-library.test.ts`

- [ ] Extend `SourceLibraryPaths` with `convertedDir`, `chunksDir`, and `digestsDir` under `Doc/<project>/sources/`.
- [ ] Extend `SourceLibraryItem` with optional `convertedTextPath`, `conversionStatus`, `conversionLimitations`, and `digestStatus` fields.
- [ ] On PDF add, try safe embedded text conversion to Markdown under `sources/converted/<sourceId>.md`; do not use OCR and do not add dependencies.
- [ ] If conversion yields readable text, set `convertedTextPath`, `extractedTextPath`, `conversionStatus: "converted"`, and `digestStatus: "pending"`.
- [ ] If conversion fails, set `conversionStatus: "metadata_only"`, limitation text, and keep `readStatus: "metadata_only"`.
- [ ] Tests must prove converted PDFs are readable when embedded text exists and metadata-only when extraction fails.

### Task 2: Add digest/chunk module

**Files:**
- Create: `src/source-digest.ts`
- Test: `test/source-digest.test.ts`

- [ ] Implement chunking by size/tokens approximation using bounded characters and overlap.
- [ ] Write chunks to `sources/chunks/<sourceId>/<chunkId>.md`.
- [ ] Build a deterministic advisory digest JSON under `sources/digests/<sourceId>.json` with summary, topics, useWhen, chunk summaries, recommendedReads, limitations, and `contractPromotionAllowed:false`.
- [ ] Build/update global `source-library-index.json` with compact per-source librarian entries.
- [ ] Keep summaries deterministic and heuristic for now; the orchestrator can later delegate richer summaries to a bibliotecario subagent.

### Task 3: Add recommendation API

**Files:**
- Modify: `src/source-digest.ts`
- Test: `test/source-digest.test.ts`

- [ ] Implement `recommendSourcesForTask({ request })` over digest/index topics, titles, summaries, and chunk summaries.
- [ ] Return source IDs, chunk IDs, whyRelevant, confidence, and an instruction for the orchestrator to send a scout/subagent to read those chunks before coding.
- [ ] Never return contracts as approved; always keep `contractPromotionAllowed:false`.

### Task 4: Wire CLI/MCP/docs/tests

**Files:**
- Modify: `src/cli.ts`, `src/mcp-server.ts`, `src/command-catalog.ts`, `README.md`, `docs/cli-commands.md`, `docs/mcp-server.md`
- Test: `test/idu-cli.test.ts`, `test/mcp-server.test.ts`, `test/command-catalog.test.ts`

- [ ] Add CLI: `source-digest`, `source-digest-status`, `source-chunk-read`, `source-recommend` plus `idu-` aliases.
- [ ] Add MCP: `idu_source_digest`, `idu_source_digest_status`, `idu_source_chunk_read`, `idu_source_recommend_for_task`.
- [ ] Update local command catalog, README, CLI docs, and MCP docs.
- [ ] Update fake runtimes and MCP tool count/list tests.

### Task 5: Verify and test existing PDF

**Files:**
- No code files unless defects appear.

- [ ] Run `corepack pnpm build`.
- [ ] Run focused tests for source-library/source-digest/MCP/CLI/command-catalog.
- [ ] Run `corepack pnpm test`.
- [ ] Run `git diff --check`.
- [ ] Use MCP or CLI against the already registered PDF source and report whether conversion succeeded or remains `metadata_only/pending_conversion`.
- [ ] Run fresh reviewer before commit/push.

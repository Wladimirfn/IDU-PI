# Bibliotecario Evidence Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Bibliotecario evidence policy/ranking layer that classifies claim types, required evidence, source hierarchy, raw honesty limits, and security warnings.

**Architecture:** Add a pure policy module, enrich external source registry recommendations with policy metadata, then surface the policy through MCP Bibliotecario proactive advisory and external source recommendation. Keep all behavior advisory-only, no-fetch by default, Telegram-free, and compatible with existing stateRoot Source Library.

**Tech Stack:** TypeScript ESM, Node test runner, existing MCP/CLI registry code.

---

## File Map

- Create `src/bibliotecario-evidence-policy.ts` — pure claim/evidence policy classifier.
- Create `test/bibliotecario-evidence-policy.test.ts` — unit coverage for claim types and hierarchy.
- Modify `src/external-source-registry.ts` — attach policy metadata to recommendations and report.
- Modify `test/external-source-registry.test.ts` — policy metadata and no-fetch safety tests.
- Modify `src/mcp-server.ts` — expose compact policy in `idu_bibliotecario_proactive_advisory` and `idu_external_source_recommend` outputs.
- Modify `test/mcp-server.test.ts` — assert policy object, no raw content, no Telegram/web/contract promotion.

---

### Task 1: Pure evidence policy module

**Files:**
- Create: `src/bibliotecario-evidence-policy.ts`
- Create: `test/bibliotecario-evidence-policy.test.ts`

- [ ] Write tests first for:
  - API/version request -> official docs/changelog primary.
  - Security request -> advisories/standards primary, community insufficient as sole authority.
  - Academic request -> academic discovery primary.
  - Open data request -> open data/catalog primary.
  - Fact-check request -> fact-checking/primary sources.
  - Community source role -> requires corroboration.

- [ ] Run RED:

```bash
corepack pnpm build && node --test dist/test/bibliotecario-evidence-policy.test.js
```

Expected: fail because module does not exist.

- [ ] Implement pure module with:
  - `BibliotecarioClaimType`
  - `BibliotecarioEvidenceCategory`
  - `BibliotecarioEvidencePolicy`
  - `classifyBibliotecarioClaimType(request)`
  - `buildBibliotecarioEvidencePolicy(input)`
  - `policyForSourceRecommendation(input)`

- [ ] Run GREEN:

```bash
corepack pnpm build && node --test dist/test/bibliotecario-evidence-policy.test.js
```

- [ ] Commit:

```bash
git add src/bibliotecario-evidence-policy.ts test/bibliotecario-evidence-policy.test.ts
git commit -m "feat(idu): add bibliotecario evidence policy"
```

---

### Task 2: Registry policy metadata

**Files:**
- Modify: `src/external-source-registry.ts`
- Modify: `test/external-source-registry.test.ts`

- [ ] Add failing tests proving:
  - security recommendations expose `claimType: "security"` and primary/canonical roles for security advisory/standards sources.
  - community recommendations expose `requiresCorroboration: true` and `forbiddenAsSoleAuthority: true`.
  - registry report remains no-fetch/no-raw/no-contract-promotion.

- [ ] Run RED focused external-source-registry test.

- [ ] Enrich `ExternalSourceRegistryRecommendation` and `ExternalSourceRecommendationReport` with policy fields from the pure module.

- [ ] Run GREEN focused test.

- [ ] Commit:

```bash
git add src/external-source-registry.ts test/external-source-registry.test.ts
git commit -m "feat(idu): rank bibliotecario source evidence"
```

---

### Task 3: MCP surfaces

**Files:**
- Modify: `src/mcp-server.ts`
- Modify: `test/mcp-server.test.ts`

- [ ] Add failing tests for:
  - `idu_bibliotecario_proactive_advisory` includes `data.evidencePolicy` or equivalent compact policy object.
  - `sourceEcosystem.externalRegistry.matches[]` includes policy role/canonicality/corroboration fields.
  - `idu_external_source_recommend` includes report-level policy and per-match policy fields.
  - raw content is not included; web fetch remains false; contract promotion false; AgentLab auto-run false.

- [ ] Run RED focused MCP tests.

- [ ] Update MCP output projections with bounded policy fields.

- [ ] Run GREEN focused MCP tests.

- [ ] Commit:

```bash
git add src/mcp-server.ts test/mcp-server.test.ts
git commit -m "feat(idu): expose bibliotecario evidence policy"
```

---

### Task 4: Verification and review

- [ ] Run LSP diagnostics on touched files.
- [ ] Run focused tests:

```bash
corepack pnpm build && node --test dist/test/bibliotecario-evidence-policy.test.js dist/test/external-source-registry.test.js dist/test/mcp-server.test.js
```

- [ ] Run full gate:

```bash
corepack pnpm build && corepack pnpm test && git diff --check
```

- [ ] Run fresh reviewer with focus on:
  - policy correctness;
  - no web/live fetch;
  - no raw content leakage;
  - no Telegram dependency;
  - no AgentLabs/dependency/rule/skill/contract mutation;
  - Source Library document used as local advisory evidence only.

- [ ] If PASS, push `main` only after verifying user-approved direct-main workflow remains intended.

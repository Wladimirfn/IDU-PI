# Bibliotecario Evidence Policy v1 — Design

## Status

Approved by user direction on 2026-06-05. Work stays on `main`; no new branch.

## Purpose

Improve Idu-pi Bibliotecario so it does not only recommend sources, but explains what kind of evidence is required for a request, which sources can be primary/canonical, which sources are only supplementary, and which safety constraints apply before the orchestrator relies on the recommendation.

The design is based on the local Source Library document:

- `source-idu-pi-deep-research-report-09dffe7ce5ea`
- `deep-research-report.md`

The document's core lesson is: search discovers candidates; it is not truth. Bibliotecario must classify evidence quality and limitations before the orchestrator or agents act.

## Non-goals

- No free web/live fetch.
- No automatic AgentLabs.
- No dependency updates.
- No rule, skill, contract, or Master Plan promotion.
- No RAG/vector engine implementation.
- No Telegram dependency.
- No raw document/chunk leakage in MCP responses.

## Current Gap

Current Bibliotecario surfaces have safe source recommendations and strong no-fetch flags, but they are source-centric. They do not expose a machine-readable policy like:

```text
claim type -> required evidence -> primary sources -> secondary sources -> insufficient/unsafe conditions
```

As a result, a community source and official documentation may both appear as recommendations, but the response does not clearly state whether the evidence is sufficient for technical, security, academic, legal, open-data, or fact-checking claims.

## Proposed Architecture

### 1. New core evidence policy module

Create `src/bibliotecario-evidence-policy.ts`.

The module is pure and has no filesystem, network, Telegram, or MCP dependency.

It classifies a request into a claim type:

- `technical_api`
- `version_release`
- `security`
- `academic`
- `legal_regulatory`
- `open_data`
- `fact_check`
- `implementation_example`
- `general`

For each claim type, it returns:

- required evidence categories;
- primary source categories;
- secondary/supplementary source categories;
- forbidden sole-authority categories;
- security warnings;
- raw-honesty limitations;
- whether human/orchestrator review is required.

### 2. External registry integration

Extend `src/external-source-registry.ts` so recommendations include compact policy fields:

- `claimType`
- `evidenceRole`: `primary | secondary | discovery | insufficient`
- `canonicality`: `canonical | strong | supplemental | weak`
- `requiresCorroboration`
- `forbiddenAsSoleAuthority`
- `policyWarnings`

The registry remains no-fetch and pointer-only.

### 3. MCP Bibliotecario proactive advisory integration

Enhance `idu_bibliotecario_proactive_advisory` output with an `evidencePolicy` object:

- claim type;
- required evidence;
- sufficiency summary;
- limitations;
- security warnings;
- no-web/no-raw/no-promotion flags.

Also include policy fields in `sourceEcosystem.externalRegistry.matches` so downstream agents can distinguish official/canonical sources from community/discovery sources.

### 4. External source recommendation integration

Enhance `idu_external_source_recommend` / `recommendExternalSources()` to return policy fields for each recommendation and a report-level policy summary.

Keep `allowedToProceed` semantics as "safe to use these as pointers", not "evidence is sufficient". The report must explicitly say when evidence is not sufficient for claims or contracts.

### 5. Raw honesty and security constraints

Every policy result must preserve raw honesty:

- no token/cost measurement unless actually measured;
- no raw source content included;
- web fetch disabled unless using a separate allowlisted external-intelligence path;
- community/UGC cannot be sole authority;
- security claims require official advisories, standards, CVE/NVD/GitHub/npm advisory-style evidence;
- ACL/RAG-related claims must require access-control-before-retrieval and prompt-injection/RAG-poisoning warnings.

## Acceptance Criteria

- Bibliotecario can classify claim type from a request.
- Technical/API/version claims prefer official docs/changelogs/releases.
- Security claims require security advisories/OWASP/CVE/NVD/GitHub/npm advisory-style evidence and flag community/blog-only evidence as insufficient.
- Academic claims prefer academic discovery sources such as OpenAlex/Crossref/PubMed-style categories.
- Open-data claims prefer CKAN/official open-data portals.
- Community sources are always secondary/discovery and require corroboration.
- MCP proactive advisory exposes an `evidencePolicy` object.
- External source recommendations expose policy fields without fetching web/live sources.
- No raw document/chunk content leaks.
- No Telegram dependency.
- Full verification and fresh review pass.

# Semantic Debt Control Design

## Goal
Detect context bloat, stale evidence, stale/missing source digests, noisy accumulated artifacts, old plans/specs, and semantic debt without deleting or changing contracts automatically.

## Scope
This slice adds a read-only advisory report and MCP surface. It does not delete files, archive sources, promote/demote contracts, run AgentLabs, or store raw prompts/docs.

## Architecture
Add `src/context-pruning-advisory.ts` to aggregate safe metadata from existing local sources:

- context quality events;
- Source Library status;
- Source Digest status/required actions;
- docs/superpowers plan/spec file metadata;
- optional static architectural pruning candidates.

Expose the report through one read-only MCP tool such as `idu_context_pruning_advisory`.

## Safety Requirements
- `mode: "advisory_only"`.
- `noDeletion: true`.
- `noAutoDelete: true`.
- `noContractPromotion: true`.
- `rawPromptsStored: false`.
- `rawDocsStored: false`.
- `remoteAnalytics: false`.
- Evidence refs are paths, counts, ids, and metadata only.
- No raw prompt/doc/plan content is stored.

## Signals
Categories:
- `context_bloat`
- `stale_evidence`
- `stale_digest`
- `artifact_noise`
- `old_plan_or_spec`
- `semantic_debt`

Each signal has severity, confidence, source, evidence refs, summary, recommended action, and blockers.

## Non-goals
- Do not clean automatically.
- Do not mutate Source Library.
- Do not update Plan Maestro.
- Do not read full docs/plans/spec text except bounded metadata/count checks.
- Do not infer external freshness.

## Tests
- Report safety flags and no raw fields.
- Context bloat signal from truncated context quality events.
- Stale source/missing digest required-action signal.
- Old/noisy plan/spec signal using file metadata/checklist counts only.
- MCP tool returns advisory envelope and safe notes; no deletion or write behavior.

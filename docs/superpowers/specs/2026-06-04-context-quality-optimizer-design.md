# Context Quality Optimizer Design

## Goal
Measure whether supervisor context packs give the orchestrator compact, relevant, low-noise, complete-enough context without storing raw prompts or raw documents.

## Scope
This slice adds local-only context quality events and a read-only panel. It records derived counts/ratings from `idu_supervisor_context_pack` outputs only. It does not add a public MCP tool, store raw pack text, infer tokens/cost/context percentages, or perform remote analytics.

## Architecture
Add a local JSONL store:

```text
<stateRoot>/reports/context-quality-events.jsonl
```

Recording is observational:

```text
idu_supervisor_context_pack returns safe pack
→ derive context quality event from counts/budget metadata
→ write local JSONL under stateRoot/reports
→ status/home panel reads and summarizes events
```

## Event Signals
Allowed event data:
- project id;
- timestamp;
- source: `mcp` or `cli`;
- scope: `supervisor_context_pack`;
- profile and character-budget counts;
- truncation flag;
- omission reasons aggregated by reason only;
- counts for contracts, required reads, risks, autonomy gates, skip/noise guidance;
- booleans for human vision, plan objective, task goal, task package, task context;
- ratings: `ok`, `warning`, `incomplete` for compactness, relevance, noise, completeness.

Forbidden event/report data:
- prompts;
- raw user text;
- raw README/docs/source chunks;
- task package request text;
- plan snapshot text;
- env/headers;
- tokens/cost/context percentage;
- remote analytics identifiers.

Reports must explicitly include:

```ts
promptTextStored: false;
rawUserTextStored: false;
rawDocsStored: false;
tokensMeasured: false;
costMeasured: false;
contextPercentMeasured: false;
remoteAnalytics: false;
```

## Rating Rules
- Compactness: `ok` when not truncated; `warning` when truncated or omitted; `incomplete` when no context budget exists.
- Relevance: `ok` when task goal exists and contracts or required reads exist; `warning` when only task goal exists; `incomplete` when task goal is missing.
- Noise: `ok` when skip/noise guidance exists; `warning` when missing; `incomplete` only if forbidden raw fields appear in tests.
- Completeness: `ok` when human vision, plan objective, task goal, task package, task context, and autonomy gates exist; `warning` when non-critical pieces are missing; `incomplete` when task goal or task context is missing.

## Non-goals
- Do not record every task package/advisory tool in this slice.
- Do not store raw omitted paths if they could contain content.
- Do not create a new public MCP tool.
- Do not change context pack generation behavior.

## Tests
- JSONL path stays under `stateRoot/reports`.
- Event/report privacy flags are false and serialized output excludes forbidden raw keys.
- Representative context pack yields deterministic ratings/counts.
- MCP `idu_supervisor_context_pack` records exactly one context quality event.
- CLI project panel shows compact qualitative summary and privacy lines.

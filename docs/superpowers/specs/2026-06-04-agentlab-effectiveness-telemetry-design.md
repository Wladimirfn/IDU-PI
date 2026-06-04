# AgentLab Effectiveness Telemetry Design

## Goal
Measure whether AgentLabs are useful using local-only, stateRoot-only effectiveness events and summaries.

## Scope
This slice observes existing AgentLab request/create, run, and status flows. It does not execute AgentLabs, schedule reviews, change runner behavior, add remote analytics, or store prompts/raw text.

## Architecture
Add a dedicated JSONL store:

```text
<stateRoot>/reports/agentlab-effectiveness-events.jsonl
```

The store is separate from usage events and supervisor activity events. It records only sanitized labels and aggregate counts from already-existing AgentLab artifacts.

MCP integration is observational:

```text
idu_agentlab_request_create -> request_created event
idu_agentlab_review_run -> run_completed event
idu_agentlab_review_status -> status_checked event
```

## Privacy and Safety Requirements
Events and reports must not store:
- prompts;
- raw user text;
- AgentLab raw summaries/output;
- env;
- headers;
- tokens;
- cost;
- context percentages;
- remote analytics identifiers.

Reports must explicitly include:

```ts
tokensMeasured: false;
contextPercentMeasured: false;
promptTextStored: false;
rawUserTextStored: false;
remoteAnalytics: false;
```

## Event Data
Allowed data:
- project id;
- timestamp;
- event type: `request_created`, `run_completed`, `status_checked`;
- source: `mcp` or `cli`;
- request/run/status counts;
- outcomes: `completed`, `partial`, `timed_out`, `stale`, `failed`, `security_violation`;
- findings by severity;
- human approval required count;
- evidence completeness: `complete`, `partial`, `missing`;
- ok boolean.

## Evidence Completeness
- `complete`: valid parsed report with non-empty report evidence and all findings have evidence.
- `partial`: run status is `partial`, quality warnings exist, or report required fallback/repair.
- `missing`: invalid/no parsed report or parsed report has no evidence.

## Non-goals
- Do not store request objective/context text.
- Do not copy workload envelope token hints or context budgets into telemetry.
- Do not expose a new public MCP tool in this slice.
- Do not add UI unless the core event/report module and MCP recording are proven.

## Tests
- JSONL writes under stateRoot reports only.
- Malformed lines are ignored while valid lines are summarized.
- Request/run/status events summarize counts and outcomes.
- Findings by severity and evidence completeness are computed from run results.
- Serialized events/reports do not contain forbidden raw fields.
- MCP AgentLab tools record the right event type without changing no-run/no-auto-run behavior.

## Risks
- Status checks can be repeated; keep them separate from run completions to avoid confusing outcome trends.
- AgentLab raw summaries can contain arbitrary text; never store them.
- Stale is status-layer evidence, not a persisted run mutation.

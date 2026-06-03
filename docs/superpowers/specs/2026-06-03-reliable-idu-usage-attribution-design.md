# Reliable Idu-pi Usage Attribution Design

## Status
Approved for implementation planning.

## Goal
Track only reliable, project-local Idu-pi usage signals: cumulative Idu-pi calls, calls by surface/action, observed Pi session identifiers, and explicitly detected Pi compactions. Avoid token/cost/context percentages unless Pi exposes structured evidence.

## Non-goals
- Do not estimate Idu-pi token usage from visual Pi status text.
- Do not infer percentage of Pi context consumed by Idu-pi.
- Do not store prompts, full user text, environment variables, headers, tokens, secrets, or credentials.
- Do not add remote analytics.
- Do not treat model compaction as an Idu-pi event unless there is explicit observable evidence.
- Do not reset project event counts when Pi compacts or starts a new session window.

## User-facing behavior
The current project panel should distinguish persistent project counters from unavailable token/context metrics.

Expected compact display shape:

```text
Uso local
eventos Idu-pi: 9
superficie: cli 0 · mcp 9 · tui 0
acciones top:
- idu_postflight 9

Sesión Pi
compactaciones detectadas: 0
tokens Idu-pi: no medido
% contexto Idu-pi: no medido
```

The detailed usage status command may show the same fields with more detail.

Key rule: `eventos Idu-pi` is cumulative for the project stateRoot and must not reset when the Pi CLI compacts or starts a new context window.

## Data model
Extend local usage/event reporting around two reliable event classes:

```text
idu_call
pi_compaction_detected
```

`idu_call` is recorded when an actual Idu-pi CLI/MCP/TUI action is invoked and passes existing safe-field constraints.

`pi_compaction_detected` is recorded only when the runtime provides a reliable observable signal. If no such signal exists, compactations remain `0` or `no medido`, not guessed.

Safe fields should remain limited to structured operational metadata, for example:

```text
id
timestamp
projectId
sessionId
surface
action
eventType
active
risk
recommendation
allowedToProceed
requiresHuman
durationMs
ok
```

No prompt text, secrets, token contents, headers, env values, or full user messages are allowed.

## Token and context accounting
Token/context metrics are intentionally reported as unavailable unless backed by structured data.

Allowed labels:

```text
tokens Idu-pi: no medido
% contexto Idu-pi: no medido
```

If a future Pi API exposes structured per-session token counters, a separate design must define how to record snapshots and calculate attribution. Until then, the UI must not derive token deltas from visual text like:

```text
↑120M ↓1.9M R1124M $1217.233 (sub) 40.4%/272k (auto)
```

That status may guide humans, but it is not reliable structured evidence for Idu-pi accounting.

## Session and compaction model
A project can accumulate many Pi sessions. Each usage event may include `sessionId` when available. The report should aggregate:

- total Idu-pi calls for the project;
- calls by action;
- calls by surface;
- observed session count when session IDs exist;
- detected compaction count when explicit compaction events exist.

Compaction affects the Pi context window but not the project event history.

## Architecture
Keep usage recording local-only and stateRoot-only:

```text
<stateRoot>/reports/idu-usage-events.jsonl
```

Recommended changes:

- Normalize usage events around an explicit `eventType`, defaulting existing call records to `idu_call`.
- Update summary/report builders to count only `idu_call` for action/surface top lists.
- Add compaction counters based only on `pi_compaction_detected` events.
- Add display fields for unavailable token/context metrics.
- Preserve existing non-blocking, best-effort write behavior.

## Error handling
- Missing usage file: zero calls, zero compactions, token/context unavailable.
- Legacy events without `eventType`: treat as `idu_call` for backward compatibility.
- Malformed JSONL lines: ignore through the existing bounded reader.
- Unknown event types: do not count as Idu-pi calls; optionally surface them in detailed/debug output only.
- Missing session ID: do not invent one.

## Testing
Add or update tests for:

- legacy events without `eventType` still count as Idu-pi calls;
- `idu_call` events count toward total/action/surface metrics;
- `pi_compaction_detected` increments compaction count but not action top calls;
- token/context display says `no medido`;
- project event count persists independently of session/compaction events;
- no sensitive fields are accepted or rendered.

## Implementation scope
Expected files:

- `src/usage-events.ts`
- `src/cli-home.ts`
- `test/usage-events.test.ts`
- `test/cli-home.test.ts`

Keep this as a reliable accounting slice only. Bibliotecario, skill efficacy, and model quality metrics should build on top of this later, using the same evidence-first rule.
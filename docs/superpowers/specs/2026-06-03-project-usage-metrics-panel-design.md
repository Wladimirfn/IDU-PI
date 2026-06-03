# Project Usage Metrics Panel Design

## Status
Approved for implementation.

## Goal
Show local Idu-pi usage/effectiveness metrics in the current project configuration panel, while keeping the existing CLI usage status as the detailed/debug view.

## Non-goals
- Do not add remote analytics.
- Do not store prompts, full user text, environment variables, headers, tokens, secrets, or model credentials.
- Do not add a live Pi status-bar integration in this slice.
- Do not add auto-refresh loops that could increase TUI flicker.

## User-facing behavior
The current project panel should include a compact `Uso local` section when a project is enrolled and its `stateRoot` can be resolved.

The section should show:

- total event count from the bounded local event reader;
- last activity, rendered as a short relative value when available;
- CLI vs MCP counts;
- active vs inactive counts;
- human-review/blocked signal counts;
- failed event count;
- top actions, limited to a small list.

For an enrolled project with no usage file or no valid events, the panel should show a short empty state instead of an error.

The detailed CLI command remains available:

```text
idu-pi idu-usage-status
```

## Architecture
`src/usage-events.ts` remains the core usage telemetry module. It should expose a small report model above the existing summary helpers so UI surfaces can consume structured metrics without reparsing text.

The CLI home/current-project panel should read from `stateRoot`, not from the repository root. It should not write usage events just because the panel is opened.

Recommended split:

- `IduUsageReport`: structured compact metrics for UI/reporting.
- `buildIduUsageReport(events, options?)`: calculates bounded display metrics.
- `formatIduUsagePanel(report)`: renders a concise panel section.
- Existing `formatIduUsageSummary()` can continue as the detailed CLI renderer and may reuse the report internally.

## Data and privacy
All data comes from the existing local JSONL file:

```text
<stateRoot>/reports/idu-usage-events.jsonl
```

The report must only aggregate already-sanitized event fields. It must not read or infer sensitive content from other files.

## Refresh model
This slice uses pull-based refresh only:

- opening/re-rendering the current project panel reads the latest JSONL snapshot;
- no timers;
- no background watchers;
- no status-bar runtime integration.

A future slice may add explicit `↻ Actualizar métricas` or optional status-bar display after measuring flicker and usefulness.

## Error handling
- Missing usage file: report zero events.
- Malformed JSONL lines: ignored by the existing reader.
- Missing `stateRoot`: omit usage metrics or show unavailable state.
- Read failures: produce an empty/unavailable report, never block the panel.

## Testing
Add or update tests for:

- usage report metrics with CLI/MCP, active/inactive, human-required, not-allowed, failed events;
- compact formatting for populated and empty reports;
- current project panel includes `Uso local` for enrolled project stateRoot;
- panel reads from `stateRoot`, not workspace root;
- no new sensitive fields are introduced.

## Implementation scope
Expected files:

- `src/usage-events.ts`
- `src/cli-home.ts` or the current-project panel module
- related CLI home/current-project tests
- `test/usage-events.test.ts`

Keep the change small and reviewable. Do not touch Pi status bar integration in this slice.

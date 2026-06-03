# Project Usage Metrics Manual Refresh Design

## Status
Approved for implementation.

## Goal
Add an explicit `↻ Actualizar métricas` action to the current project panel so users can refresh local usage metrics without leaving the screen.

## Non-goals
- Do not add automatic refresh in this slice.
- Do not add timers, watchers, or background loops.
- Do not integrate with the Pi status bar.
- Do not write usage events when viewing or refreshing the panel.
- Do not add remote analytics or sensitive payloads.

## User-facing behavior
When the user opens `Proyecto actual`, the panel shows the current project status and the `Uso local` metrics for enrolled projects with `stateRoot`.

The screen actions should be:

```text
↻ Actualizar métricas
← Volver
Exit
```

Choosing `↻ Actualizar métricas` should rebuild the current home/project status and re-render the same project panel. This gives the user an explicit pull refresh while staying in the current location.

For projects that are not enrolled or have no `stateRoot`, the refresh action may remain visible but should not create usage files or show false metrics.

## Architecture
Keep refresh orchestration in `src/cli.ts`, where the interactive home flow already lives.

Recommended split:

- Add a project-panel menu helper that wraps `showTextView`-style behavior with an extra refresh option.
- Each refresh iteration should call `buildCliHomeStatus({ argvPath: process.argv[1], stdinInteractive: true })` again before formatting the project panel.
- Reuse `formatCliProjectStatus(status)` for rendering.

## Refresh model
This slice is manual and pull-based only.

A future slice may add auto-refresh while the user remains on the project panel. That future slice should stop refreshing when the user leaves the panel and avoid re-rendering when content has not changed.

## Error handling
- If status rebuild fails in a future extension point, return to the current safe CLI behavior; this slice does not need new failure channels.
- Missing or malformed usage files remain handled by the existing usage event reader.

## Testing
Add tests or source assertions for:

- Project panel actions include `↻ Actualizar métricas`.
- Selecting refresh stays in the project panel and rebuilds status before rendering again.
- Selecting back exits to the parent menu behavior.
- Refreshing does not write usage events by itself.

## Implementation scope
Expected files:

- `src/cli.ts`
- `test/cli-home.test.ts` or `test/idu-cli.test.ts`

Keep this as a small UX/control-flow slice. Do not modify usage event storage or report calculations unless a test proves it is necessary.

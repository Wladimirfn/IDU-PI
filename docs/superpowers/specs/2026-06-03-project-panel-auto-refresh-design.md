# Project Panel Auto-Refresh Design

## Status
Approved for implementation.

## Goal
Automatically refresh the current project panel while the user remains on that screen, so local usage metrics update without manual action.

## Non-goals
- Do not refresh outside the current project panel.
- Do not add file watchers.
- Do not integrate with the Pi status bar.
- Do not write usage events while viewing or refreshing.
- Do not add remote analytics or sensitive payloads.

## User-facing behavior
When the user opens `Proyecto actual`, the panel should refresh automatically every 3 seconds.

The screen still keeps manual controls:

```text
↻ Actualizar métricas
← Volver
Exit
```

Manual refresh remains immediate. Auto-refresh runs only while this screen is active.

When the user leaves the screen through `← Volver`, `Exit`, `Esc`, or `q`, the refresh timer must stop.

## Anti-flicker behavior
The refresh loop should only re-render when the formatted panel content changes. If the content is unchanged, it should do nothing.

This keeps the TUI stable and avoids unnecessary redraws.

## Architecture
Extend the shared menu renderer with optional auto-refresh support:

- `intervalMs`: refresh cadence.
- `getContent()`: recalculates panel content.

The menu renderer owns timer lifecycle and cleanup. Project panel supplies a content callback that rebuilds `buildCliHomeStatus()` and formats `formatCliProjectStatus()`.

## Error handling
This slice does not introduce new error surfaces. If content generation fails in the future, the renderer should keep current behavior rather than writing files or crashing from background work.

## Testing
Add source-level regression tests for:

- project panel configures auto-refresh with 3000ms interval;
- auto-refresh uses `buildCliHomeStatus()` and `formatCliProjectStatus()`;
- renderer uses `setInterval` and cleans with `clearInterval`;
- renderer avoids re-rendering unchanged content;
- no `fs.watch` or `watchFile` is introduced.

## Expected files
- `src/cli.ts`
- `test/cli-home.test.ts`

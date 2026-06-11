# Idu-pi Revival — technical design

This design makes the existing idu-pi harness reachable (RoleEngine, trigger engine, event
bridge, AgentLab selector) and adds a non-critical signal digest, without inventing new
subsystems. Every decision reuses an existing pattern already proven in the codebase:
the `supervisor-trigger.json` toggle, the event-bus in-process pub/sub, the trigger-engine
sha1 idempotency, the existing risk taxonomy, and the autonomous-alert cron tick as the
single carrier of periodic work. No new daemon, no new background process, no new taxonomy.

## The five decisions (lead with the answer)

| # | Decision | One-line rationale |
|---|----------|--------------------|
| D1 | **Digest delivery = MCP injections primary; Telegram optional mirror** | The primary consumer is the orchestrator (MCP). `injections.jsonl` is already a durable, pull-based, acked store with `idu_pending_injections`. Telegram is a best-effort push mirror, never the source of truth. |
| D2 | **Event-bridge idempotency = durable seen-state file keyed by `taskId+domain+UTC-hour-bucket`** | The in-memory `seenHashesByRoot` dedup does not survive process restarts and the alert cron runs per-process. A small `stuck-events-seen.json` under stateRoot mirrors the `supervisor-trigger.json` pattern and stops cross-tick double-emits. |
| D3 | **Trigger gate = persisted per-project config flag (env var kept as legacy OR-override)** | A config flag is inspectable via `idu_status`, survives restarts, and is owner-toggleable. The env var was dead precisely because it is invisible and per-process. New flag follows the `supervisor-trigger.json` shape. |
| D4 | **RoleEngine wiring point = lazy singleton subscribed at MCP server startup, gated by config** | `appendEvent` already notifies in-process listeners. Subscribing once at startup makes supervisor roles reachable on the real event path. The config gate (`enabled=false` default + per-role flags) means zero model invocations when disabled — the subscription is cheap, the invocation is gated. |
| D5 | **Digest scheduler = cadence check inside the existing autonomous-alert cron tick** | The cron already runs periodically and already carries the trigger engine. A `digest-schedule.json` last-flush timestamp + a slot table (e.g. 09:00/14:00/19:00 local) lets the same tick decide "is it time to flush?" — no new daemon. |

## Architecture overview

```
                    autonomous-alert cron tick  (runCliAutonomousAlertScheduledTick, cli.ts:3111)
                    │
   ┌────────────────┼───────────────────────────────────────────────┐
   │                │                                                 │
   ▼                ▼                                                 ▼
 alert report   event bridge (1c)                              digest flush check (D5)
 (existing)     emitStuckTaskEventsFromAlertReport             readDigestSchedule()
   │            + seen-state dedup (D2)                         due? → flush pending
   │                │                                                 │
   │                ▼ appendEvent("task_stuck")                       ▼
   │            ┌── event-bus notifyListeners (in-process) ──┐   injections.jsonl (digest entry)
   │            │                                            │   + Telegram mirror (best-effort)
   │            ▼                                            ▼
   │     RoleEngine.onEvent (D4)                       trigger engine tick (1b/D3)
   │     gated by role-engine.json enabled             gated by trigger config flag
   │            │                                            │
   │            ▼ supervisor-main/semantic/compaction        ▼ stuck_tasks_1h etc.
   │     model invocation → model_invocation_log       injection (non-critical) → digest queue
   │                                                         critical (security/db/data_loss) → immediate
   ▼
 idu_status (reads role-engine + trigger config + digest schedule for inspectability)
```

The seam everything hangs off is the **event bus** (`appendEvent` → `notifyListeners`) and the
**autonomous-alert cron tick** (the only periodic carrier). Nothing introduces a parallel loop.

## Decision detail

### D1 — Digest delivery mechanism

**Decision: MCP injections (`injections.jsonl`) is the primary, durable delivery channel.
Telegram is an optional best-effort push mirror. Both receive the digest; only injections is
authoritative.**

A digest is one `Injection` envelope (`triggerId: "non_critical_digest"`, `severity: "info"`,
`orchestratorDecisionRequired: false`) summarizing the coalesced signals, appended via the
existing `appendInjection`. The orchestrator pulls it through `idu_pending_injections`. The
full per-signal record continues to land in `injections.jsonl` exactly as today (durable log,
acceptance criterion Phase 2 line 205). Telegram delivery (via `src/index.ts` grammY) sends the
same digest summary text; a Telegram failure is logged and ignored — it never blocks the
injection write.

| Alternative | Tradeoff | Rejected because |
|-------------|----------|------------------|
| Telegram primary (proposal default) | Owner-facing push, immediate visibility | The primary consumer is the orchestrator, not a human phone. Telegram is remote/optional and can be offline; making it authoritative risks silent signal loss. |
| Injections-only | Simplest, fully durable | Loses the owner's remote-glance affordance the proposal wants for a trial. Cheap to add Telegram as a mirror. |
| Both, both authoritative (dual-write transaction) | No signal lost on either channel | Two sources of truth means reconciliation and ack-state divergence. Avoided: one truth (injections), one mirror (Telegram). |

**Testing impact (strict TDD, node:test):** the digest writer is a pure function
`buildDigestInjection(signals, now) → Injection` — unit-testable with no I/O. The delivery layer
takes an injected `notify?: (text) => void` so Telegram is a stub in tests; default real impl is
best-effort. Tests assert: injection always written, Telegram failure never throws, critical
signals are NOT in the digest.

### D2 — Event-bridge idempotency

**Decision: durable seen-state file `stuck-events-seen.json` under stateRoot, keyed by
`${taskId}|${domain}|${UTC-hour-bucket}`. `emitStuckTaskEventsFromAlertReport` consults and
updates it; a key already present in the current hour bucket is skipped.**

The event bus already dedups identical events via `seenHashesByRoot` (event-bus.ts:77,147-153),
but that set is **in-memory and per-process** — across consecutive cron ticks in fresh processes
it provides no protection, and the same stuck task with a new `now` timestamp produces a new
event hash anyway (ts is part of the hash). So bridge-level dedup is required.

The hour-bucket key matches `stuck_tasks_1h` semantics: a task stuck across the same hour should
emit at most one `task_stuck`. New hour → new bucket → re-emit allowed (the task is still stuck,
the trigger window has rolled). The file follows the `supervisor-trigger.json` shape exactly:
tiny, side-effect-free, atomic tmp-write, lenient parse-or-default-empty.

```jsonc
// stateRoot/stuck-events-seen.json
{
  "version": 1,
  "updatedAt": "2026-06-11T14:00:00.000Z",
  "seen": {
    "task-abc|stale_work|2026-06-11T14": "2026-06-11T14:03:00.000Z"
  }
}
```

Pruning: on write, drop entries older than 2 hours (bounded growth, only the current + previous
bucket matter for a 1h window).

| Alternative | Tradeoff | Rejected because |
|-------------|----------|------------------|
| Event-window query before emit (read events.jsonl, skip if a matching `task_stuck` exists in window) | No new state file, reuses `readEvents` | Couples emit to a JSONL scan every tick (O(events)); race-y if two ticks overlap; harder to reason about than an explicit key. |
| Rely on existing `seenHashesByRoot` | Zero new code | Does not survive restarts and ts-in-hash defeats it across ticks. Confirmed insufficient. |
| Dedup by `taskId+status` (no time bucket) | Simplest key | A task stuck for days would emit exactly once ever, so a re-stuck task after resolution never re-fires. Hour bucket preserves "still stuck this hour" semantics. |

**Testing impact:** `emitStuckTaskEventsFromAlertReport` gets an injected clock and a stateRoot
tmpdir. Tests: (1) two consecutive calls in the same hour with the same report emit once;
(2) advancing the clock to the next hour re-emits; (3) distinct taskIds in one report all emit;
(4) seen-file is pruned past 2h. Pure file I/O against a tmpdir, no models.

### D3 — Trigger engine gate

**Decision: persisted per-project config flag `trigger-engine-config.json` under stateRoot (same shape
as `supervisor-trigger.json`), toggled by the dedicated `idu-trigger-engine` CLI/MCP surface.
The legacy `IDU_PI_TRIGGER_ENGINE=1` env var stays as an OR-override for backward compatibility.**

`isTriggerEngineOptIn()` (trigger-engine-invocation.ts:3) changes from
`env === "1"` to `env === "1" || readTriggerEngineConfig(stateRoot).enabled`. Because the current
signature takes no stateRoot, `runTriggerEngineTickOptIn` already has `input.stateRoot` — we move
the gate decision inside it (it already receives stateRoot) and keep `isTriggerEngineOptIn()` as
an env-only helper for legacy callers/tests. Default (no file) = disabled, matching today's dead
state, so no existing deployment silently turns on.

| Alternative | Tradeoff | Rejected because |
|-------------|----------|------------------|
| Installer sets env var (status quo intent) | No code change to the gate | Env vars are invisible, per-process, lost across scheduler/shell contexts — this is *why* the engine was dead (LH-003). Repeating it repeats the bug. |
| Config flag, drop env var entirely | Cleanest single source | Breaks any current deployment relying on the env var; the proposal explicitly wants the legacy override kept (line 94). |
| Reuse `supervisor-trigger.json` | One fewer file | Conflates the scheduled-tick opt-in (different concern, already documented) with the trigger-engine gate. Separate file = separate, inspectable concern. |

**Testing impact:** `readTriggerEngineConfig` is a tiny parse-or-default function (copy the
`readSupervisorTriggerFile` test pattern). Gate logic tested as a truth table: {env unset, file
absent}→off; {env=1, file absent}→on; {env unset, file enabled}→on; {env=1, file disabled}→on
(env OR-override). No models.

### D4 — RoleEngine wiring point

**Decision: instantiate a lazy module-singleton `RoleEngine` and subscribe it to the event bus
once at MCP server startup (`src/mcp-server.ts`). The subscription is unconditional and cheap;
the *invocation* is gated by `role-engine.json` (`enabled=false` + all `roleEnabled=false` by
default). When disabled, `onEvent` short-circuits before any model call (`skippedByDisabled`).**

`appendEvent` already calls `notifyListeners` synchronously before the JSONL write
(event-bus.ts:154-159), and `subscribeToEventKind` exists. The minimal wiring is: at server
startup, build one `RoleEngine` with the project's `AgentRouter` + `LabDbRepository` +
`loadRoleEngineConfig(stateRoot)`, then `subscribeToEventKind(kind, (e) => engine.onEvent(e))`
for each kind the registered roles subscribe to. Because `onEvent` checks
`config.roleEnabled[roleId]` first (role-engine.ts:128-132) and skips disabled roles before
touching the router, a disabled engine costs only a Map lookup per event — no model runs on the
event path until the owner enables it.

This is why the AgentLab bypass (`router.promptForRole` direct call) does not need to change:
AgentLab keeps its direct path; the engine path becomes the *additional* live route for the
supervisor roles that today have zero invocations.

Enable/disable surface (mirrors `idu-supervisor-trigger enable|disable|status`):
- CLI: `idu-role-engine enable|disable|status [--role <roleId>]` → writes via the existing
  `saveRoleEngineConfig` (role-engine-config.ts:172); first enable runs the existing
  `runRoleEngineMigration` (line 248).
- MCP: `idu_role_engine_control` tool with the same verbs; `idu_role_engine_status` for
  inspection. Token cost stays visible through the already-wired `idu_model_invocation_status`
  (roles record provider/model/prompt-chars/response-chars via `ctx.repository.appendInvocation`).

| Alternative | Tradeoff | Rejected because |
|-------------|----------|------------------|
| Instantiate per cron tick | No long-lived state in MCP process | Loses in-memory per-turn cap + cooldown continuity; rebuilds engine + reloads state every tick; misses events emitted by MCP tools between ticks. |
| Instantiate inside supervisor tick only | Scoped to the supervisor path | Supervisor roles also need to react to MCP-tool-emitted events (e.g. `agentlab_finding_ready`), which happen outside the tick. Startup subscription catches both. |
| Always-on, no config gate | Simplest wiring | Violates the firm owner constraint (OFF by default, opt-in, cost-visible). Unacceptable token risk. |

**Testing impact:** the wiring is a thin `createRoleEngineSubscription(deps) → unsubscribe`
function — unit-tested with a fake router that records calls and a config with `enabled=false`,
asserting zero router calls; then `enabled=true` + one `roleEnabled` true asserting exactly one
invocation recorded. Strict TDD: write the disabled-path test first (it must prove no model
runs), then the enabled-path test. The existing role unit tests stay untouched.

### D5 — Digest scheduler

**Decision: the existing autonomous-alert cron tick performs a cadence check each run against a
`digest-schedule.json` (last-flush timestamp + configured local-time slots, default 3/day:
09:00, 14:00, 19:00). If the current time has passed an unflushed slot, the tick flushes the
pending non-critical queue into one digest injection (D1) and records the flush. No new daemon.**

Non-critical signals accumulate in `digest-queue.jsonl` under stateRoot (append-only, same
write discipline as `injections.jsonl`). The interrupt classifier (below) routes each signal:
critical → immediate injection (today's behavior, bypasses the queue); everything else →
appended to `digest-queue.jsonl`. The cron tick, which already runs `runTriggerEngineTickOptIn`
(cli.ts:3170), gains a `maybeFlushDigest({ stateRoot, now })` call right after.

`maybeFlushDigest` is idempotent per slot: it only flushes if `now` is past a slot boundary that
is newer than `lastFlushAt`. This tolerates irregular cron cadence — if the cron runs every few
minutes, the digest still flushes at most once per slot.

```jsonc
// stateRoot/digest-schedule.json
{
  "version": 1,
  "slotsLocal": ["09:00", "14:00", "19:00"],
  "lastFlushAt": "2026-06-11T14:01:00.000Z"
}
```

**Interrupt classifier (reuses existing taxonomy, no new types):** a pure function
`classifyInterrupt(signal) → "immediate" | "digest"`. `immediate` iff the signal's risk maps to
**security**, **db_change / data_loss** (from `HumanIntentRiskHint`, human-intent.ts:54), or
`guardRisk` (autonomous-alert-engine.ts:48) flags a critical guard. Everything else → `digest`.
This is the firm interrupt policy (proposal line 116). No new severity scale is created — it maps
the existing hints to a binary route.

| Alternative | Tradeoff | Rejected because |
|-------------|----------|------------------|
| New scheduler daemon / setInterval | Precise timing | Adds a long-lived process and lifecycle to manage; contradicts "avoid adding a new daemon"; the cron already runs periodically. |
| Fixed interval (every N hours from first signal) | No slot table | Drifts relative to the owner's day; "2-3 times/day" is easier to reason about as wall-clock slots. |
| Flush on queue-size threshold | Responsive to volume | Defeats the anti-fatigue goal — a noisy burst would flush immediately, recreating the spam. Cadence is the point. |

**Testing impact:** `maybeFlushDigest` takes injected `now` and a stateRoot tmpdir. Tests:
(1) before first slot → no flush; (2) `now` past slot 1 with queued signals → one digest
injection, `lastFlushAt` updated; (3) second call same slot → no second flush; (4) empty queue
at slot time → no empty digest emitted. `classifyInterrupt` is a pure truth-table test over the
risk hints. No models, no network.

## Module-level change map

| Stream | Files changed | Nature | New file |
|--------|---------------|--------|----------|
| 0a (formatting) | working-tree formatter diff + `.atl/skill-registry.md` | commit only, no behavior | — |
| 0b (path fix) | `src/project-connection.ts:442-456`, `src/idu-supervisor-loop.ts:193,221` | replace `reports/lab.db`+`reports/tasks.jsonl` with `runtime.labDbPath` pattern (cli.ts:2066-2073) | — |
| 1a (RoleEngine) | `src/mcp-server.ts` (startup wiring + 2 MCP tools), `src/cli.ts` (`idu-role-engine` command) | new wiring + opt-in surface | `src/role-engine-subscription.ts` (thin `createRoleEngineSubscription`) |
| 1b/D3 (trigger gate) | `src/trigger-engine-invocation.ts:3-4,14` | gate reads config OR env | `src/trigger-engine-config.ts` (mirror of `supervisor-trigger.ts`) |
| 1c/D2 (event bridge) | `src/cli.ts:~3174` (call bridge in tick), `src/autonomous-alert-engine-event-bridge.ts` (add seen-state dedup + clock) | wire + idempotency | `stuck-events-seen.json` is runtime state, not source |
| 1d (selector) | `src/agentlab-review-runner.ts:1565`, `src/agentlab-review-requests.ts:155` | normalize bare selector → append `.json` before `RUN_RE` | — |
| 2/D1+D5 (digest) | `src/cli.ts:~3174` (call `maybeFlushDigest`), `src/index.ts` (Telegram mirror hook), `src/mcp-server.ts` (digest status tool optional) | new digest module wired into tick | `src/digest.ts` (`buildDigestInjection`, `classifyInterrupt`, `maybeFlushDigest`, schedule + queue I/O) |

### New persistent state files (all under stateRoot, all `supervisor-trigger.json` discipline)

| File | Purpose | Shape |
|------|---------|-------|
| `trigger-engine-config.json` | D3 trigger gate flag | `{ version, enabled, updatedAt, source? }` |
| `stuck-events-seen.json` | D2 bridge idempotency | `{ version, updatedAt, seen: { "<taskId>|<domain>|<UTChour>": iso } }` |
| `digest-queue.jsonl` | D5 pending non-critical signals | append-only `Injection`-like records |
| `digest-schedule.json` | D5 cadence state | `{ version, slotsLocal: string[], lastFlushAt: iso }` |
| `role-engine.json` (exists) | D4 engine gate | reuse `loadRoleEngineConfig`/`saveRoleEngineConfig` (already at role-engine-config.ts:84,172) |

## How existing tests are protected (no behavior change out of scope)

- **Path fix (0b)** only changes *where idu-pi reads* canonical `lab.db`/`tasks.jsonl`; it moves
  no operator data and deletes nothing. Existing tests that point at canonical paths already
  pass; tests asserting the buggy `reports/` path (if any) are the bug and get corrected.
- **RoleEngine (1a)** ships disabled by default. Any test that runs the cron/MCP without enabling
  the engine sees zero new model invocations — the subscription short-circuits at
  `skippedByDisabled`. Existing role unit tests (`router.promptForRole` direct) are untouched
  because the AgentLab bypass path is unchanged.
- **Trigger gate (1b)** default (no file) = disabled = today's behavior; the env-var OR-override
  preserves any test that sets `IDU_PI_TRIGGER_ENGINE=1`.
- **Event bridge (1c)** is currently never called, so wiring it touches a previously-dead path;
  the seen-state dedup defaults to "emit" when the file is absent, matching the function's
  current pure behavior for first-ever emit.
- **Digest (2)** adds new files and a new tick call; tools not in scope (`idu_status`,
  `idu_queue_detail`, `idu_pending_injections`) keep their contracts — the digest is just another
  `Injection` they already know how to surface.
- **Selector (1d)** narrows a failing path to a passing one; no currently-passing selector
  changes (a selector that already had `.json` is unaffected by the normalization).

## Strict TDD sequencing (node:test, `pnpm test`)

Each stream lands test-first. New pure functions (`buildDigestInjection`, `classifyInterrupt`,
`maybeFlushDigest`, `readTriggerEngineConfig`, bridge dedup, `createRoleEngineSubscription`) are
designed with injected clocks and stateRoot tmpdirs so they are deterministic and model-free.
The only model-touching assertion (Phase 1 acceptance: a real supervisor invocation) is an
integration check gated behind an explicitly-enabled engine config in a sandbox stateRoot, kept
separate from the fast unit suite.

## Open risks carried into tasks

- **Telegram mirror coupling (D1):** `src/index.ts` is the grammY entry; the mirror hook must be
  injectable so the digest module has no hard dependency on a running bot. Confirm the seam in
  tasks.
- **RoleEngine router/repository availability at MCP startup (D4):** the engine needs an
  `AgentRouter` + `LabDbRepository` bound to the active project at server start. If the MCP server
  is project-agnostic until a project is selected, the subscription may need to be (re)bound on
  project activation rather than once at process start. Resolve the binding lifecycle in tasks.
- **Local-time slots (D5):** "09:00/14:00/19:00 local" depends on the host timezone of the cron;
  document the assumption and make slots configurable (they already are, via the file).
- **Cron cadence vs slots (D5):** if the autonomous-alert cron is not actually scheduled in a
  given deployment, the digest never flushes. The digest scheduler inherits the cron's liveness;
  flag this in tasks so the trial deployment confirms the cron runs.

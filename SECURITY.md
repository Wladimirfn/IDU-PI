# Security boundaries

What idu-pi actually enforces, and what it does not. Everything below was
measured against running code, not inferred from the source.

Read this before describing the ONE ORCHESTRATOR RULE as a guarantee.

## The goal

A delegated worker runs on its own harness. It keeps that harness's native
subagents, skills, codegraph and engram. The one thing it must never get is a
route back into idu-pi, because `worker -> idu-pi -> worker` is a loop that
burns tokens and loses the thread.

## The MCP surface holds

A worker's MCP catalogue comes back **empty** (`tools/list` returns `[]`) and
`tools/call` refuses **by name**, so a client that cached the orchestrator's
catalogue cannot get through either.

Verified against a live delegated Pi worker on 2026-10-01: 0 idu-pi tools
exposed, while engram (19 tools), the native subagent tools and codegraph were
all still reachable. That is the requirement, met.

This is *hiding*, not *denying*. It keeps the loop out of reach of a worker that
does not go looking.

## The CLI surface does not hold

The guard in `delegate()` fires on one condition:

```ts
if (process.env.IDU_WORKER === "true") throw new Error("ONE ORCHESTRATOR RULE VIOLATION: ...");
```

`IDU_WORKER` is an environment variable the worker owns. Measured on
2026-10-01, against the shipped binary:

| Worker state | Result |
| --- | --- |
| `IDU_WORKER=true` | refused |
| `IDU_WORKER=false` | **passes the guard** |
| `IDU_WORKER` unset | **passes the guard** |

A delegated Pi worker that ran `$env:IDU_WORKER="false"` before calling
`idu delegate` spawned a nested worker and reported success. The loop is real
and reachable in one command.

### What the guard still buys

A worker that has no idea it inherited the marker cannot walk into a loop by
accident, and the refusal lands in the run log where a post-mortem can find it.
That is worth having. It is not a boundary.

### Every known way past it

None of these need elevated privileges. A worker with `workspace` permissions
and a shell has all of them:

1. Set `IDU_WORKER` to anything other than `true`, or drop it.
2. **Copy `dist/src/cli.js`** somewhere else and run it there.
3. **Import the class as a library** and call `delegate()` in-process:
   `CrossCliProcessManager.getInstance().delegate({ ... })`. No process ancestry
   involved, so no ancestry check of any kind would see it.
4. `Start-Process`, `cmd /c start`, `schtasks`, or `Win32_Process.Create` to
   break the process tree.
5. `PROC_THREAD_ATTRIBUTE_PARENT_PROCESS` to declare a different parent.
6. Edit the guard's own source. The worker runs in the same repository.

Ancestry-based detection was designed and **rejected**: a worker can delete the
registry it reads from, and walking the parent chain on Windows costs 400-1600
ms per `delegate()` call via CIM. Paying a second per delegation to stop a
bypass that takes thirty seconds is a bad trade. Signed capability tokens were
also rejected, and for a structural reason rather than a cryptographic one: this
rule is about **policy** ("may you delegate from where you stand?"), not about
**authentication** ("who are you?"). Signing does not answer the question the
guard is asking.

## Retired config keys

`oneOrchestratorRule` is no longer read. Both keys were switches that disabled
the guard from `~/.idu/config.json`, a file every worker can write to:

```json
{ "oneOrchestratorRule": { "enabled": false, "allowRecursiveDelegation": true } }
```

`enabled: false` was the cheapest bypass in the system: one edit, no shell
tricks, and it turned the rule off globally rather than for one process. The
block still parses so old configs keep loading, and a warning says it is inert.
`idu status` reports the rule as `ACTIVE (always on, not configurable)`.

## What closing this properly would cost

Only removing authority from the worker works. Two shapes, both unbuilt:

- **A supervisor process.** Delegation moves behind an authenticated IPC
  channel. The client binary may be copied; the worker still cannot speak to
  the supervisor. The hard part is protecting issuance and use of the
  credential, not the cryptography.
- **A separate OS user.** idu-pi runs as a service account and the worker's
  account is denied the binary and its state. Windows compares the client's
  token against the channel's DACL, and an "allow the current user" ACL does
  not distinguish root from worker when they are the same user.

Job Objects are not isolation: Microsoft documents that processes created
through `Win32_Process.Create` do not inherit the requesting job.

Both require a decision that has not been made: **should idu-pi ever run as a
service, under its own user?** Until that is answered, the loop is a
convention with a loud failure mode, and this file is the honest description of
it.

## Related

- `test/cross-cli.test.ts` — "ONE ORCHESTRATOR RULE is identity-only, and that
  is the whole boundary" pins the measured bypass as a regression test, so a
  future "fix" has to confront it instead of quietly re-closing the door.
- `src/process-manager.ts` — the guard.
- `src/mcp-server.ts` — the MCP catalogue filter that does hold.

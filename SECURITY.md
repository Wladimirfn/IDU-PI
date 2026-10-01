# Security boundaries

What idu-pi actually enforces, and what it does not. Everything below was
measured against running code, not inferred from the source.

Read this before describing the ONE ORCHESTRATOR RULE as a guarantee.

## The goal

A delegated worker runs on its own harness. It keeps that harness's native
subagents, skills, codegraph and engram. The one thing it must never get is a
route back into idu-pi, because `worker -> idu-pi -> worker` is a loop that
burns tokens and loses the thread.

## There is one signal, and both surfaces depend on it

```ts
// src/mcp-server.ts:46
function isWorkerProcess(): boolean { return process.env.IDU_WORKER === "true"; }

// src/process-manager.ts, in delegate()
if (process.env.IDU_WORKER === "true") throw new Error("ONE ORCHESTRATOR RULE VIOLATION: ...");
```

`IDU_WORKER` is an environment variable the worker owns. It can unset it, set
it to `"false"`, or never propagate it, and neither surface can tell the
difference. Measured on 2026-10-01 against the shipped binary:

| `IDU_WORKER` | `tools/list` | `tools/call idu_delegate` | CLI `delegate` |
| --- | --- | --- | --- |
| `true` | 0 tools | refused | refused |
| `false` | **13 tools** | **passes** | **passes** |
| unset | **13 tools** | **passes** | **passes** |

So this is not one strong defence and one weak one. It is a single cooperative
identity contract, implemented in two places.

### What the MCP filter is still worth

With `IDU_WORKER` inherited normally, a worker's tool catalogue comes back
empty and `tools/call` refuses **by name**, so a client that cached the
orchestrator's catalogue cannot get through either. Verified against a live
delegated Pi worker: 0 idu-pi tools exposed, while engram (19 tools), the native
subagent tools and codegraph were all still reachable.

That is real, and it is what the requirement asked for. But it is **hiding, not
denying**. A worker that clears the variable gets the full catalogue back. Do
not describe this as a boundary.

### What the CLI guard is worth

The same, one level down: a worker that has no idea it inherited the marker
cannot walk into a loop by accident, and the refusal lands in the run log where
a post-mortem can find it.

### Every known way past it

None need elevated privileges. A worker with `workspace` permissions and a shell
has all of these:

1. Set `IDU_WORKER` to anything other than `true`, or drop it.
2. **Copy `dist/src/cli.js`** somewhere else and run it there.
3. **Import the class as a library** and call `delegate()` in-process:
   `CrossCliProcessManager.getInstance().delegate({ ... })`. No process ancestry
   involved, so no ancestry check of any kind would see it.
4. `Start-Process`, `cmd /c start`, `schtasks`, or `Win32_Process.Create` to
   break the process tree.
5. `PROC_THREAD_ATTRIBUTE_PARENT_PROCESS` to declare a different parent.
6. Edit the guard's own source. The worker runs in the same repository.

### Two routes that never touch idu-pi

The goal above is "no route back into idu-pi". Note that a nested worker does
not require idu-pi at all:

- **Call the harness directly.** `claude -p "..."`, `pi -p "..."`, `cmdc -p
  "..."`. Every one of those CLIs is on the user's PATH, and idu-pi holds none
  of their credentials.
- **Write `~/.idu/profiles.json`.** Same argument that retired
  `oneOrchestratorRule`: that file lives in a home directory every worker can
  write. A worker can add a profile with an arbitrary `command` and arbitrary
  `permissions`, and `buildWorkerArgs` will honour it.

So closing the idu-pi route does not stop nested workers. It stops *nested
workers routed through idu-pi*, which is what the accounting and the logs
depend on, and not more than that.

### Designs that were rejected, and why

- **Ancestry detection.** A worker can delete the registry it would be read
  from, and `Start-Process`/`schtasks`/WMI break the chain anyway. Walking the
  parent chain on Windows costs 400-1600 ms per `delegate()` call via CIM. A
  second per delegation to stop a bypass that takes thirty seconds.
- **Signed capability tokens.** These answer the wrong question. The rule is
  about **policy** ("may you delegate from where you stand?"), not
  **authentication** ("who are you?"). The orchestrator can mint a fresh token
  whenever it likes, and a worker can skip the signature by importing the class.
- **Job Objects.** Not isolation. Microsoft documents that processes created
  through `Win32_Process.Create` do not inherit the requesting job.

## Retired config keys

`oneOrchestratorRule` is no longer read. Both keys were switches that disabled
the guard from `~/.idu/config.json`, a file every worker can write to:

```json
{ "oneOrchestratorRule": { "enabled": false, "allowRecursiveDelegation": true } }
```

`enabled: false` was the cheapest bypass in the system: one edit, no shell
tricks, and it turned the rule off globally rather than for one process. The
block still parses so old configs keep loading, and a warning fires when a key
is present with a value that used to matter. `idu status` reports the rule as
`ACTIVE (always on, not configurable)`.

`IDU_ALLOW_DELEGATION=false` is still written into every worker's environment
for compatibility and is read by nothing. It is not a second signal.

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

Both require a decision that has not been made: **should idu-pi ever run as a
service, under its own user?** Until that is answered, the loop is a convention
with a loud failure mode, and this file is the honest description of it.

## Related

- `test/cross-cli.test.ts` — "ONE ORCHESTRATOR RULE is identity-only, and that
  is the whole boundary" pins the measured CLI bypass as a regression test, so
  a future "fix" has to confront it instead of quietly re-closing the door.
- `src/process-manager.ts` — the CLI guard.
- `src/mcp-server.ts` — the MCP catalogue filter. Same predicate, same limits.

# Tick deployment directory

Issue #483. The supervisor tick cron previously ran `scripts\idu-supervisor-tick.ps1` directly from the operator's working checkout (`C:\Users\elmas\pi-telegram-bridge`). That meant whatever branch the operator had checked out at tick time was the production code: no CI, no review, no merge. The fix is a deployment directory: a separate clone of the repo, kept on `main`, which the cron task points to via `WorkingDir`.

## Layout

```
C:\Users\elmas\pi-telegram-bridge\            <- operator's working checkout (any branch)
C:\Users\elmas\Documents\bridge-agents\       <- stateRoot (unchanged)
C:\idu-pi-deploy\                             <- new deployment directory (always on main)
```

The cron task's `WorkingDir` becomes `C:\idu-pi-deploy\`. The bootstrap script is at `C:\idu-pi-deploy\scripts\idu-supervisor-tick-bootstrap.ps1`, and it calls the script via `$PSScriptRoot` so the call is locatable from any directory.

## Operator setup (one-time)

1. Run `scripts\install-deploy-tick.ps1` from the operator's working checkout. It creates `C:\idu-pi-deploy\`, clones the repo, checks out main, and runs the initial build.
2. Re-register the Windows task `Idu-pi Supervisor Tick` with:
   - `WorkingDir : C:\idu-pi-deploy`
   - `Action     : powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\idu-supervisor-tick-bootstrap.ps1`

The operator must do step 2 manually. The PR brings the script and the directory; the cron task lives on the operator's machine, not in the repo. (Forgetting step 2 is exactly the bug this issue documents — the merge alone is not enough.)

## Update (per merge)

Run `scripts\update-deploy-tick.ps1` to pull the latest main and rebuild. The cron task's next tick runs against the updated code.

If the operator forgets to update after a merge, the tick still runs against the previous commit. The watermark advances only when the preflight succeeds, so a stale deploy doesn't lose commits — it just processes them twice. But the operator should run the update on every merge to keep the deploy in sync.

## What this fixes (and what it doesn't)

With the deployment directory, the cron always runs against a `main` commit. The watermark (`cron-last-sha.txt`) is always written against a `main` commit, so the diff between the watermark and the current `HEAD` is always a valid `main..main` diff. This is the central fix.

What this does NOT fix:
- Force-push or rebase of `main` can still orphan the watermark. The deployment directory's `HEAD` would not be an ancestor of the watermark's SHA. The next tick would compute a diff against an orphan commit and return a plausible-but-wrong file list. This is the "rare case" defense-in-depth that #484 addresses via `git merge-base --is-ancestor`.
- A bad commit on `main` (one that passes CI but breaks the cron) is still deployed. The cron task re-running the broken cron is the cost of having a cron at all. The fix is at the CI level (better broken-commit detection), not at the deployment level.
- The deployment directory is on the same machine as the operator's checkout. A determined operator could still bypass the deployment by editing the deployment directly. The fix is administrative (operator discipline), not technical.

## Why a separate clone, not a worktree

A git worktree shares the `.git` directory with the main checkout. The cron task would still depend on the operator's working checkout's `.git` (the shared one). If the operator is on a branch with a broken `.git` state, the cron fails. A separate clone has its own `.git` and is decoupled from the operator's checkout.

A separate clone also lets the cron task's `WorkingDir` be the deployment directory's root — the script can read `git rev-parse HEAD` and get the deployment's HEAD, not the operator's. With a worktree, the path manipulation is more fragile.

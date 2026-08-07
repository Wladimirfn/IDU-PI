$env:IDU_PI_TICK_STATE_ROOT = "C:\Users\elmas\Documents\bridge-agents\projects\idu-pi"
$env:AGENT_WORKSPACE_ROOT = "C:\Users\elmas\Documents\bridge-agents"
$env:IDU_PI_REGISTRY_PATH = "C:\Users\elmas\Documents\bridge-agents\registry\projects.json"
# Issue #483: the bootstrap must be locatable from the deployment
# directory, not the operator's working checkout. $PSScriptRoot is the
# directory of this script; the cron task's WorkingDir points to the
# deployment directory, so `$PSScriptRoot\idu-supervisor-tick.ps1` resolves
# to the deployment directory's copy of the script. The previous
# hardcoded path to the operator's working checkout installed whichever
# branch was locally checked out at tick time — bypassing CI and review.
& "$PSScriptRoot\idu-supervisor-tick.ps1"

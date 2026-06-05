# Supervisor Self-Maintenance Advisory Design

## Goal
Make Idu-pi natively detect project work-health problems: accumulated backlog, stale tasks, repeated mistakes, repeated failure patterns, neglected areas, and missing follow-up loops. The supervisor must surface advisory proposals before the orchestrator drifts or repeats failures.

## Master Plan Alignment
Idu-pi is a supervisor/auditor for the orchestrator. It must keep the project aligned to the approved Master Plan, evidence, contracts, and safe execution gates. A supervisor that only records tasks but does not detect repeated failure or backlog pressure is incomplete.

This feature belongs natively in Idu-pi because it supports:
- evidence-first project governance;
- continuous improvement;
- semantic debt control;
- skill optimization;
- Bibliotecario/context quality;
- orchestrator accountability.

## Authority Model
The feature is advisory-only.

Allowed:
- read existing project stateRoot signals;
- compute pressure/risk signals;
- recommend cleanup tasks, regression tests, Bibliotecario reviews, Skill Learning Loop inputs, and supervisor improvement proposals;
- expose JSON-first report through MCP/CLI.

Forbidden:
- no automatic implementation;
- no automatic AgentLab execution;
- no automatic skill installation or modification;
- no automatic rule/contract promotion;
- no broad web search;
- no deletion or mutation of repo/stateRoot data in v1.

## Inputs
V1 may inspect bounded existing signals:
- structured task queue: pending/running/done/failed/guarded tasks;
- supervisor activity events;
- usage events;
- AgentLab effectiveness events;
- semantic audit status/counters;
- optionally a bounded orchestrator todo snapshot when a safe surface exists.

V1 must not depend on raw chat history or raw prompt content.

## Signals

### Backlog pressure
Triggered when pending/running tasks exceed configured thresholds.

Initial threshold guidance:
- warning: 10+ open tasks;
- high: 20+ open tasks;
- high: 5+ running/in-progress tasks.

### Stale task pressure
Triggered when tasks are old and not closed.

Initial threshold guidance:
- running older than 2 hours;
- pending older than 3 days;
- failed tasks without follow-up.

### Repeated failure patterns
Triggered when similar failure categories recur.

Initial sources:
- repeated task failure reasons;
- repeated bug tasks with similar keywords;
- AgentLab failed/timed_out/stale outcomes;
- usage events with failed/notAllowed/requiresHuman clusters.

### Neglected areas
Triggered when an area is repeatedly mentioned but does not receive completed work.

Examples:
- Telegram was repeatedly discussed but not implemented until late;
- Bibliotecario external updates requested but only registry/advisory exists;
- context pressure repeatedly mentioned without metrics.

V1 should infer neglected areas conservatively from task texts/statuses and evidence refs. It must report low confidence when evidence is weak.

### Learning-loop pressure
Triggered when repeated bugs/failures should become:
- regression tests;
- supervisor improvement proposal;
- skill improvement proposal;
- skill draft proposal after human approval;
- Bibliotecario documentation task.

## Output
JSON-first report:

```ts
type SupervisorSelfMaintenanceAdvisoryReport = {
  version: 1;
  authority: "advisory";
  mode: "advisory_only";
  generatedAt: string;
  projectId: string;
  noWrites: true;
  agentLabsExecuted: false;
  rulesApplied: false;
  skillsModified: false;
  totals: {
    pendingTasks: number;
    runningTasks: number;
    failedTasks: number;
    staleTasks: number;
    guardedTasks: number;
    supervisorEvents: number;
    usageFailures: number;
    agentLabStaleRequests: number;
    semanticNewEvents: number;
  };
  signals: Array<{
    id: string;
    category:
      | "backlog_pressure"
      | "stale_tasks"
      | "repeated_failure_patterns"
      | "neglected_areas"
      | "learning_loop_pressure"
      | "semantic_audit_pressure"
      | "supervisor_activity_pressure";
    severity: "info" | "warning" | "high";
    confidence: number;
    evidenceRefs: string[];
    summary: string;
    recommendedActions: string[];
    bibliotecarioInputs?: string[];
    skillLearningInputs?: string[];
  }>;
  recommendedActions: string[];
  safeNotes: string[];
};
```

## MCP/CLI Surface
Add a read-only MCP tool:

```text
idu_supervisor_self_maintenance_advisory
```

Purpose:
- return advisory report;
- no writes;
- no AgentLabs;
- no task creation in v1.

CLI can expose an equivalent command later or in the same slice if cheap:

```text
idu-pi supervisor-self-maintenance-advisory
```

## Bibliotecario and Skill Loop Integration
V1 does not create skills or documentation automatically. It only emits inputs:

- `bibliotecarioInputs`: bounded documentation/research recommendations;
- `skillLearningInputs`: patterns that should be reviewed by Skill Learning Loop;
- `recommendedActions`: exact next commands or task suggestions.

Example:

```text
Repeated postflight/task-trace confusion detected. Recommended: add regression test and propose Skill Learning Loop improvement for postflight local-only files.
```

## Safety Rules
- Do not globally ignore files or failures.
- Do not hide backlog pressure because tasks are old.
- Do not create noisy tasks on every run; report first.
- Do not infer certainty from weak evidence.
- Prefer counts, IDs, and categories over raw task/chat text.
- Keep report bounded and JSON-first.

## Testing
Required tests:
- detects backlog pressure from many pending/running tasks;
- detects stale tasks from old pending/running tasks;
- detects repeated failure pattern without modifying skills/tasks;
- reports safe no-write flags;
- MCP tool lists and returns advisory envelope;
- real unexpected failures are not hidden by advisory report.

## Rollout
1. Pure builder module and tests.
2. MCP read-only tool.
3. Optional CLI/catalog surfacing.
4. Later slice: feed findings into supervisor improvement proposals or Skill Learning Loop proposals, still with human approval.

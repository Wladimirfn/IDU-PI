# Supervisor Context Pack Natural Flow Design

## Goal
Make `idu_supervisor_context_pack` the natural first context step for orchestrator implementation workflows, instead of leaving it as a manual-only MCP tool.

## Scope
This slice updates MCP procedure guidance, tests, and docs only. It does not change queue persistence, Telegram commands, AgentLab execution, or task package schemas.

## Architecture
`idu_supervisor_context_pack` already composes compact goals, Plan Maestro context, task package, task context, risks, required reads, noise guidance, and autonomy gates. The smallest safe integration point is `buildOrchestratorProcedure("implement_change")`, because it is the orchestrator-facing procedure that explains what tools to call before delegation.

The procedure should promote this flow:

```text
idu_status
→ idu_supervisor_context_pack
→ idu_task_context only as fallback or narrow extra advisory
→ normal orchestrator subagents
→ idu_postflight
→ idu_agentlab_* only for explicit audit-only review when needed
```

## Requirements
- `idu_orchestrator_procedure` for `implement_change` must mention `idu_supervisor_context_pack` as the primary pre-delegation context call.
- The procedure must keep `idu_task_context` as fallback when the full pack is unavailable or when narrow advisory is needed.
- Advisory-only boundaries must remain explicit: Idu-pi informs/audits/recommends; the orchestrator decides and implements.
- AgentLabs remain audit-only and explicit.
- Existing context pack compactness rules remain unchanged.
- Documentation must match the new natural loop.

## Non-goals
- Do not modify semantic task queue formats.
- Do not modify Telegram or CLI task creation flows.
- Do not make AgentLabs run automatically.
- Do not change `idu_task_package_create` schema.

## Tests
- Add a regression test that `idu_orchestrator_procedure({ purpose: "implement_change" })` includes `idu_supervisor_context_pack` and preserves advisory-only decision envelope fields.
- Extend the approved plan loop test so it includes `idu_supervisor_context_pack` between `idu_plan_snapshot` and action/package creation.
- Keep existing truncation/no-raw prompt tests unchanged and green.

## Risks
- Procedure/docs drift if only one surface is updated.
- Fallback ambiguity if projects lack a Master Plan review capability.
- Context duplication if the orchestrator treats embedded taskPackage and separately created task package as competing authorities. Procedure wording must say the pack gives context, while explicit task package creation can still provide traceable package IDs for postflight.

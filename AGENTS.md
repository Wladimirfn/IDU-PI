# AGENTS.md

> Entry pointer for any orchestrator agent (Claude Code, Pi, OpenCode, Codex, Antigravity) working in this project.

## Authority Boundaries

- **`openspec/`**: **Canonical intention**. Change proposals, specs, design, and acceptance criteria.
- **`src/` + `test/`**: **Canonical behavior**. The actual implementation, tests, and execution harness.
- **`.idu/`**: **Execution adapter**. Machine-local limits, profiles, and runtime locks (zero normative authority).
- **`AGENTS.md`**: **Short entry pointer**. Points to the protocol skill (this document; <= 1 screen).
- **`docs/`**: **Human documentation**. Architecture explanations and operational runbooks.

---

## Load the Parent Protocol Skill

Before starting work, load the protocol skill:

- **Pi CLI**: `/skills` -> `idu-pi-parent-protocol`
- **OpenCode**: `skill({ name: "idu-pi-parent-protocol" })`
- **Antigravity / Claude**: reads `.pi/skills/idu-pi-parent-protocol/SKILL.md`

Skill locations (kept strictly byte-identical):
```
.pi/skills/idu-pi-parent-protocol/SKILL.md                    (project-local, Pi)
.agents/skills/idu-pi-parent-protocol/SKILL.md                (project-local, OpenCode)
~/.pi/agent/skills/idu-pi-parent-protocol/SKILL.md            (global, user home)
```

---

## Standard Workflow

1. **Session Start**: Call `idu_status` to inspect workspace health, active branch, and dirty tree.
2. **Before Changes**: Call `idu_preflight` with your task and expected files to assess blast radius.
3. **Delegation**: Delegate long or complex sub-tasks via `idu_delegate` using the appropriate profile.
4. **Monitoring**: Wait with `idu_worker_wait` or inspect with `idu_worker_status`.
5. **After Changes**: Always run `idu_postflight` to verify actual git diffs match expected files.
6. **Decisions**: Record key architectural or governance choices via `idu_decision_record`.

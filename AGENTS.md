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
3. **Local Implementation**: Implement code and execute changes directly in the active orchestrator (Pi, OpenCode, Claude Code, Codex, Antigravity, Command Code) using local edit tools and native SDD workflows (`sdd-apply`, `sdd-verify`) where available. NEVER delegate primary coding away.
4. **Delegation**: Call `idu_delegate` for exploration, consultation, architecture review, cross-audits and bounded design/icon artifacts (e.g. `--profile arch-claude`). Workers stay within their role; the active orchestrator remains the sole implementer of core code.
   - If running asynchronously, wait with `idu_worker_wait` or `idu-pi wait <runId> --timeout 540000`. Never use `node dist/src/cli.js`.
   - Profile governance: modify existing profiles freely, but never create roles or profiles without explicit user approval.
5. **After Changes**: Always run `idu_postflight` to verify actual git diffs match expected files.
6. **Decisions**: Record key architectural or governance choices via `idu_decision_record`.

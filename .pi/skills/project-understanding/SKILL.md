---
name: project-understanding
description: "Use before modifying a project when blueprint/flows may be missing, stale, unconfirmed, or when adding modules, databases, auth/login, dashboards, integrations, or large architecture changes. Forces AgentLabs and orchestrators to understand the real project before building."
category: development
risk: safe
source: project
---

# Project Understanding

## Purpose

Idu-pi primero comprende el proyecto, luego ayuda a construirlo.

This skill makes Idu-pi act as a cerebellum/sidecar: observe, understand, validate, remember, and alert before the orchestrator or AgentLabs build on weak structural ground. It does not replace the orchestrator and must not convert guesses into project truth.

> Idu-pi no empieza construyendo; primero entiende el terreno.

## When to Use This Skill

Use this skill before:

- creating new modules;
- touching databases or persistent storage;
- modifying auth, login, sessions, permissions, or identity flows;
- creating dashboards or admin panels;
- connecting modules or changing cross-module flows;
- large architecture changes;
- working when `project-blueprint` or `project-flows` are absent, default, stale, or unconfirmed;
- working when `scan_project_map` detects many differences;
- implementing a user request for something not present in the functional map.

Do not use this skill for trivial text edits, obvious one-line fixes, or commands that only inspect runtime state.

## Mandatory Rules

- Do not assume every project is HTML.
- Do not assume every project has buttons.
- Identify the project type first.
- Distinguish between HTML UI, Telegram bot, CLI, API, Python, Next.js, industrial system, and other project shapes.
- Review README, docs, package metadata, configuration, and folder structure before proposing changes.
- Compare documentation against code.
- Declare uncertainties explicitly.
- Ask the human before converting inferences into project truth.
- Do not modify `project-blueprint` or `project-flows` without human review.
- Do not apply implementation changes if the structural floor is weak.
- Treat generated or default maps as drafts until confirmed by a human.

> project-flows es el mapa funcional del proyecto real, no el mapa interno de Idu-pi.
>
> La IA puede sugerir; el humano convierte en verdad del proyecto.

## Project Types to Consider

Classify the project as one of these, or explain why it is mixed/unknown:

- `telegram-bot`
- `cli-tool`
- `html-app`
- `react-next-app`
- `api-server`
- `python-data-tool`
- `node-library`
- `maintenance-system / RCM / CMMS`
- `unknown`

A project may combine types. Example: a Telegram bot may also include a CLI installer and SQLite storage. Name the primary type and secondary surfaces.

## Analysis Method

Follow this sequence before recommending or building changes:

1. **Discover structure**
   - Inspect README/docs, package metadata, config files, source folders, scripts, tests, and generated/default project maps.
   - Identify whether the map is project-local, default, missing, stale, or unconfirmed.

2. **Infer purpose**
   - Summarize what the project appears to do.
   - Separate evidence from inference.

3. **Identify interfaces**
   - Telegram commands/handlers, CLI commands, HTTP/API routes, HTML screens/buttons/forms, Next.js pages/actions, Python entrypoints, dashboards, industrial workflows, or other interfaces.

4. **Identify storage**
   - JSON/JSONL files, SQLite/Postgres, Supabase, filesystem reports, queues, environment variables, caches, browser storage, external services.

5. **Identify modules**
   - Name modules/components/services and their responsibilities.
   - Mark modules found in code but missing from the map.
   - Mark mapped modules not found in code.

6. **Identify main flows**
   - Describe end-to-end flow chains from user/event to handler/service/storage/response.
   - Keep likely flows separate from confirmed flows.

7. **Detect gaps**
   - Compare docs vs code vs blueprint vs project-flows vs scan output.
   - Highlight contradictions, missing flows, stale docs, default maps, and unsafe assumptions.

8. **Ask minimum questions**
   - Ask only the questions needed to turn high-impact uncertainties into human-confirmed truth.

9. **Generate reviewable drafts only**
   - If map changes are needed, produce drafts or recommendations.
   - Do not write or apply `project-blueprint`/`project-flows` without explicit human review and approval.

## Expected Output for AgentLabs

Return a concise report in this format:

```text
Tipo de proyecto inferido:
- <type(s)>

Evidencia:
- <file/command/code evidence>

Confianza:
- Alta | Media | Baja, with reason

Módulos detectados:
- <module>: <responsibility>

Interfaces detectadas:
- <interface>: <entrypoint/handler/screen/command>

Storage detectado:
- <storage>: <path/table/service/purpose>

Flujos probables:
- <flow chain>

Incertidumbres:
- <unknown or weak inference>

Preguntas al humano:
- <minimal question>

Recomendación:
- Continue | update docs/map draft | pause for human confirmation | do not implement yet
```

## Examples

### Telegram bot

```text
comando Telegram -> handler -> servicio -> JSONL/SQLite -> respuesta Telegram
```

Example analysis:

```text
Tipo de proyecto inferido:
- telegram-bot with CLI/PowerShell setup surface

Evidencia:
- README documents Telegram commands.
- src/index.ts registers bot.command handlers.
- src/lab-db.ts defines SQLite tables.

Flujos probables:
- /queue_detail -> Telegram handler -> StructuredTaskQueue -> SQLite user_signal_events -> Telegram response
```

### HTML app

```text
botón -> función -> API/DB -> dashboard/vista
```

Do not assume this shape unless HTML/screens/buttons/forms are present in the code or docs.

### RCM / CMMS maintenance system

```text
activo -> OT -> materiales -> bodega/compras -> bitácora -> cierre -> historial/KPI
```

For maintenance systems, distinguish operational reality from UI implementation. A missing button does not mean the maintenance flow does not exist; it may be represented as Telegram commands, API endpoints, forms, reports, or manual process steps.

## Stop Conditions

Pause before implementation when:

- project type is `unknown` and the requested change depends on project shape;
- blueprint or project-flows are missing/default/stale and the change is architectural;
- scan output contradicts the map in many places;
- user asks for a feature not represented in docs, code, or map;
- database/auth/dashboard changes require assumptions about ownership, permissions, or lifecycle;
- the recommendation would modify `project-blueprint` or `project-flows` without review.

When paused, return the smallest useful evidence summary and the minimum human questions needed to proceed.

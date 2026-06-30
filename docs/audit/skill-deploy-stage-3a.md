# Etapa 3a — Skill Deploy (id-pi → host)

## Objetivo cumplido

idu-pi ahora espeja sus skills idu-pi-owned desde **fuente** (`.idu/skills/`, ya poblada por `syncNecessarySkills` desde el bundle interno) **hacia la ubicación que el host CLI lee** (`.agents/skills/` para OpenCode), de forma **aditiva** e **idempotente**. Sin borrar skills del usuario.

## Wiring

```
src/skills-host-deploy.ts                     (nuevo, 154 líneas)
  - listIduPiOwnedSkills(sourceDir)            → solo subdirs con SKILL.md (sorted)
  - listHostUserSkills(hostDir)                → subdirs SIN SKILL.md (sorted)
  - writeHostSkillIndex(hostDir)               → regenera INDEX.md con 2 buckets
  - deploySkillsToHost({sourceDir, hostDir, projectPath})
      mkdir + cpSync recursivo por skill
      tracks copied vs overwritten
      preserva subdirs del usuario (no los enumera)
      regenera INDEX.md al final
  - formatSkillsHostDeployResult(result)       → output legible

src/cli/single/handlers.ts                     (handleIduSkillsDeploy, +34)
src/cli/single/index.ts                       (export barrel, +1)
src/cli.ts                                     (case dispatch, +4)

test/skills-host-deploy.test.ts               (nuevo, 8 tests)
test/cli-command-catalog.test.ts              (catalog frozen, +2 labels)
```

## Comando CLI

```
node dist/src/cli.js idu-skills-deploy
node dist/src/cli.js skills-deploy           # alias
```

Default target: `<repo>/.agents/skills/` (OpenCode). Etapa 3b extenderá a `~/.pi/skills/` y `~/.claude/skills/` con `--target pi|claude`.

## Output crudo del deploy real contra el repo live

```
=== Etapa 3a — live deploy against <cwd> ===
cwd: C:\Users\elmas\pi-telegram-bridge

--- pre-state ---
.idu/skills/ exists: true
.agents/skills/ exists: true
.agents/skills/ contents: .gitkeep, INDEX.md, bug-hunter, codebase-audit-pre-push,
                           idu-pi-parent-protocol, jq, mcp-work-discipline,
                           performance-optimizer, project-understanding, skill-check,
                           technical-change-tracker

--- added user-custom-skill/ to .agents/skills/ ---
.agents/skills/ after add: ...id-u...id-u-pi-parent-protocol...user-custom-skill

--- formatSkillsHostDeployResult ---
Skills deploy (host mirror)

Source:  C:\Users\elmas\pi-telegram-bridge\.idu\skills
Host:    C:\Users\elmas\pi-telegram-bridge\.agents\skills
Index:   C:\Users\elmas\pi-telegram-bridge\.agents\skills\INDEX.md

Copied (new on host):

Overwritten (stale refreshed):
  - bug-hunter
  - codebase-audit-pre-push
  - idu-pi-parent-protocol
  - jq
  - mcp-work-discipline
  - performance-optimizer
  - project-understanding
  - skill-check
  - technical-change-tracker

User skills preserved (no SKILL.md — not touched):
  - user-custom-skill

Missing in source (declared NECESSARY but absent upstream):

Note: idu-pi deploy only touches subdirs with SKILL.md.
      Anything else under ... is yours.

--- post-state ---
.agents/skills/ contents: .gitkeep, INDEX.md, bug-hunter, ..., user-custom-skill

INDEX.md (first 14 lines):
# Host Skill Index
...
| Skill | Path |
| --- | --- |
| bug-hunter | .agents/skills/bug-hunter/SKILL.md |
| codebase-audit-pre-push | .agents/skills/codebase-audit-pre-push/SKILL.md |
| idu-pi-parent-protocol | .agents/skills/idu-pi-parent-protocol/SKILL.md |
| jq | .agents/skills/jq/SKILL.md |
| mcp-work-discipline | .agents/skills/mcp-work-discipline/SKILL.md |
| performance-optimizer | .agents/skills/performance-optimizer/SKILL.md |
| project-understanding | .agents/skills/project-understanding/SKILL.md |
| skill-check | .agents/skills/skill-check/SKILL.md |

user-custom-skill/NOTES.md (preserved byte-for-byte):
"this is the user — must survive\n"
```

## Contratos verificados (tests pasando)

| # | Contrato | Test | Estado |
|---|---|---|---|
| 1 | Copia las N skills idu-pi-owned de `.idu/skills` → dir del host | `Etapa 3a contract 1 — deploy copies all idu-pi-owned skills to host dir` | ✓ pass |
| 2 | Sobreescribe versión stale en el host | `Etapa 3a contract 2 — overwrites a stale version on the host` | ✓ pass |
| 3 | NO borra subdirs del host sin SKILL.md (user skill preservada) | `Etapa 3a contract 3 — preserves host subdirs WITHOUT SKILL.md` | ✓ pass |
| 4 | Idempotente (segunda corrida = sin cambios destructivos) | `Etapa 3a contract 4 — second deploy is idempotent` | ✓ pass |

Más tests auxiliares:

| Test | Cubre |
|---|---|
| `lists idu-pi-owned skills (subdir with SKILL.md) only` | `listIduPiOwnedSkills` filtra bien |
| `listHostUserSkills returns subdirs WITHOUT SKILL.md, sorted` | `listHostUserSkills` filtra bien |
| `formatSkillsHostDeployResult shows copied/overwritten/preserved buckets` | formatter |
| `writeHostSkillIndex regenerates INDEX.md with both idu and user buckets` | index dual-bucket |

**Resultados suite completa**: 2469 pass / 0 fail / 2 skipped (esperados, los mismos de Etapas anteriores).

## Decisiones de diseño

1. **`cpSync` recursivo sin `rmSync`** — mismo principio que `safeCopy` (Etapa 1). Sobre-escribe contenidos en el subdir sin removerlo. Subdirs no enumerados (los del usuario) quedan intactos.
2. **Filtro SKILL.md idéntico a hygiene-migrate** — usa el mismo modelo territorio: solo subdirs con `SKILL.md` son idu-pi-owned. El filtro se llama la misma manera en `listIduPiOwnedSkills` y `listHostUserSkills`.
3. **`mkdirSync({recursive:true})` en hostDir** — crea el dir si no existe. Sin rmSync, el dir del usuario con archivos fuera de SKILL.md queda.
4. **INDEX.md regenerado** — `writeHostSkillIndex` produce dos secciones (idu-pi-owned primero, user después). Reemplaza el INDEX preexistente (que era un idu-pi-owned artifact según el modelo).
5. **Etapa 3a NO toca `--target` parser** — el default hardcoded es OpenCode path. Etapa 3b extenderá `IduMcpTarget` con `claude` y agregará branching en `handleIduSkillsDeploy` para resolver el host dir por target.
6. **No tocar `.gitignore`** — el modelo explícito es commitear el dir del host (verbatim del brief), para que un clone fresco tenga skills disponibles antes de que idu-pi corra. El Índice de git ya tenía `.agents/skills/**` whitelisted; nada cambia.

## Lo que NO hice (limites respetados)

- **No agregué deploy en `handleIdu`** — vos pediste explícitamente "comando explícito + eventualmente auto en connect". Etapa 3a es solo el comando explícito. Wiring en connect queda para cuando confirmes el diseño del trigger.
- **No extendí `IduMcpTarget`** — eso es Etapa 3b (Pi/Claude). El default OpenCode es correcto para hoy.
- **No toqué `.gitignore`** — modelo declarado en el brief.
- **No agregué `~/.pi/agent/skills` ni `~/.claude/skills` globales** — el brief los marca opt-in explícito, default project-local.

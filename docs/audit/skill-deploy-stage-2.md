# idu-pi skills deploy — Etapa 2 (bundle interno + parent-protocol)

## What changed

`src/config-wizard.ts:147`:
- `NECESSARY_PROJECT_SKILLS` +1: `"idu-pi-parent-protocol"` (6 → 7).

`src/index.ts:1643-1652` (`sourceSkillsDir()`):
- Antes: `registry.projects.find(p => p.id === "sistema_de_mantencion")` → fallaba (ese proyecto no estaba registrado).
- Ahora: `<packageRoot>/skills-bundle/` (con `existsSync` fallback).

`skills-bundle/` (nuevo dir):
- 7 SKILL.md copiados desde `.idu/skills/` con hashes SHA256 idénticos verificados.
- `bug-hunter`, `codebase-audit-pre-push`, `performance-optimizer`, `skill-check`, `technical-change-tracker`, `jq`, `idu-pi-parent-protocol`.

`package.json`:
- `skills-bundle` agregado al array `"files"[]` (entra en `npm pack`).

`test/config-wizard.test.ts:685+`:
- Aserción nueva: `idu-pi-parent-protocol/SKILL.md` debe existir post-sync, con mensaje de intención.

## Why

`syncNecessarySkills` reportaba "No encontré el proyecto fuente sistema_de_mantencion para sincronizar skills." El bridge entre idu-pi y los proyectos cliente estaba roto. Con el bundle, la fuente vive **dentro del package** y viaja con `npm pack`.

## Lo que NO cambió (instrucción explícita del usuario)

- `sistema_de_mantencion` intacto — "no borres archivos del otro lado"
- `.idu/skills/` intacto (sigue siendo el deployment target del host)
- `safeCopy`/`safeMove` de Etapa 1 sin tocar
- `writer-migration.test.ts:225` sin tocar (writer territory, contrato distinto)

## Verificación

- 2461/2461 + 1 = 2461 pass. Build limpio.
- End-to-end runtime: `syncNecessarySkills(skills-bundle, projectPath, stateRoot)` → `copied: 7, missing: [], INDEX.md lista las 7, source preserved: true`.
- Hash match verificado con `Get-FileHash -Algorithm SHA256`.

## Deuda pendiente (no bloqueante)

Cosmetic: `result.moved` ahora contiene entradas **copiadas** (con el corte arreglado, en realidad son espejos aditivos). Mensaje del test dice "skill-a moved" cuando es copia. Renombrar `moved → applied/mirrored` queda para una iteración futura.

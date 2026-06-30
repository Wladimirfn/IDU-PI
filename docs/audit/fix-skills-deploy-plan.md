# Plan: Fix migrate-corte-de-skills + completar set predefinido

## Cambios concretos que voy a hacer

### 1. `src/hygiene-migrate.ts` — convertir el CORTE en COPIA aditiva

**Hoy (líneas 115-126, 128-140, 142-154):** `safeMove(from, to)` → `renameSync` (o `cpSync + rmSync` cross-device). Borra el origen por diseño.

**Cambio:** introducir `safeCopy(from, to)` análogo a `safeMove` pero **sin** la rama de `rmSync`. Para mantener el contrato observable, **cambio el tipo de `MigrationResult.moved` por `MigrationResult.rehomed`** (rename semántico: ya no mudamos, reseteamos al lado idu-pi sin tocar el origen).

**Por qué `rehomed` y no `moved`:** el tipo se exporta. Cambiar el nombre del campo es un breaking change para consumers. Mejor mantengo `moved` por compat con tests y agrego un flag nuevo `preservedFromCopy: boolean` en `MovedEntry`. Pero para no romper el contrato, mantengo el nombre del campo y agrego el flag.

**Lo más seguro:** renombrar `MovedEntry.from` semánticamente: sigue siendo el origen, pero la semántica del array cambia de "moví" a "reubiqué con copia aditiva". El nombre del array lo dejo (cambiar el nombre = breaking change). Comentario explicativo en `migrateHygieneLayout` para que el auditor vea la nueva semántica.

**Borra el origen si está vacío:** las líneas `tryRmdirIfEmpty(legacySkillsDir)` (línea 158) y `tryRmdirIfEmpty(legacyConfigDir)` (línea 89). Estas solo borran si el dir quedó vacío post-migración. Con el cambio a copy, **el dir de origen queda lleno** (no se borra nada) → `tryRmdirIfEmpty` no hace nada → **correcto por side-effect**. No las toco.

### 2. `src/config-wizard.ts` — agregar `idu-pi-parent-protocol` a NECESSARY_PROJECT_SKILLS

**Hoy (líneas 140-147):** 6 skills, no incluye `idu-pi-parent-protocol`.

**Cambio:** agrego `"idu-pi-parent-protocol"` al array. Resultado: 7 skills. La skill ya existe físicamente en `.idu/skills/idu-pi-parent-protocol/SKILL.md` (verificado con glob).

**Justificación del nombre:** parent-protocol es **la skill que define el protocolo entre orquestador e idu-pi** (cómo invocar MCP, cómo levantar supervisores, cómo evitar anti-patterns documentados). Sin esa skill copiada al proyecto cliente, el orquestador queda ciego al protocolo y termina improvisando — exactamente el tipo de cosa que rompe el "chico primero".

### 3. Bundle dentro de idu-pi (opción 3 que pediste)

**Source actual:** `sourceSkillsDir()` (index.ts:1643-1650) → proyecto `sistema_de_mantencion/.agents/skills`.

**Cambio:** cambiar `sourceSkillsDir()` para que apunte a un bundle interno: `<packageRoot>/skills-bundle/`. 

**Pasos:**
- Crear `skills-bundle/` en el repo root con las 7 SKILL.md predefinidas (de `.idu/skills/`).
- Actualizar `sourceSkillsDir()` para resolver a `join(resolvePackageRoot(), "skills-bundle")`.
- Agregar `"skills-bundle"` a `package.json` "files"[] para que se incluya en el package.
- Sin eliminar nada de sistema_de_mantencion (instrucción explícita). El proyecto `sistema_de_mantencion` queda intacto.

**Pero:** la fuente actual de las skills predefinidas es `sistema_de_mantencion/.agents/skills/`. Si cambio el bundle a interno, **las skills que viven ahí se quedan huérfanas**. NO las borro (instrucción explícita: "al mover archivos no los elimines del otro lado"). Solo cambio de fuente.

### 4. Tests que romper y cómo los actualizo

| Test | Archivo:línea | Cambio |
|---|---|---|
| `migrateHygieneLayout: skills migration by SKILL.md enumeration` | `test/hygiene-migrate.test.ts:191` | Aserción final `assert.ok(!existsSync(join(repoRoot, ".agents", "skills")))` (línea 260) **deja de ser cierta** (el origen queda intacto). Lo cambio a: el origen sigue existiendo Y los archivos siguen ahí. |
| `migrateHygieneLayout: leaves dirs without SKILL.md untouched` | `test/hygiene-migrate.test.ts:267` | Sigue válido (el comportamiento de "no migrar lo que no es SKILL.md" se preserva). |
| `syncNecessarySkills copies only necessary skills and writes a simple index` | `test/config-wizard.test.ts:660` | Si agrego `idu-pi-parent-protocol` al set, el test debe ofrecer esa skill en el source que arma. Loop sobre el array, no asume longitudes hardcoded. |

### 5. Memorias nuevas (no romper, agregar)

| Memoria | topic_key | Contenido |
|---|---|---|
| `idu-pi/skill-deploy-bug-pre-fix` | sim | Snapshot del estado de skills antes/después; justificación del cambio de semántica. |
| `idu-pi/skills-bundle-introduction` | sim | Por qué se introdujo `skills-bundle/`, qué queda en `sistema_de_mantencion`, qué se quita de la dependencia externa. |

## Cosas que NO hago (límite explícito)

- **No toco `config-wizard.ts:146`** NECESSARY_PROJECT_SKILLS sin agregar `idu-pi-parent-protocol`. Orden importa: si agrego `parent-protocol` al set pero el bundle no la tiene, `syncNecessarySkills` la marca como `missing`.
- **No edito `safeMove`** sin reemplazarlo. Si solo cambio `safeMove`, rompo el contrato de la configuración (`migrateHygieneLayout: config migration`) — porque las 4 governance files legacys (`config/project-core.json`, etc.) **sí deben moverse** (esas son del idu-pi, no del usuario). El cambio es **solo en la rama Skills** del bloque `else` (líneas 102-159), no en la rama Config (líneas 70-90).
- **No rompo `tryRmdirIfEmpty`**. Es seguro dejarlo.
- **No borro `sistema_de_mantencion/.agents/skills/*`**. La instrucción es "al mover archivos no los elimines del otro lado para que no rompamos nada".

## Lo que pido antes de actuar

Tu OK sobre:
1. El plan arriba (5 pasos, tests que rompo y arreglo, semántica del array `moved`).
2. El nuevo set predefinido: `["bug-hunter", "codebase-audit-pre-push", "performance-optimizer", "skill-check", "technical-change-tracker", "jq", "idu-pi-parent-protocol"]` (7 skills).
3. La creación de `skills-bundle/` con los 7 SKILL.md adentro (sin eliminar nada del otro lado).

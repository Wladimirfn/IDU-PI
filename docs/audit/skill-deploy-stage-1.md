# idu-pi skills deploy — Etapa 1 (hygiene-migrate cut → copy)

## What changed

`src/hygiene-migrate.ts` (rama Skills, líneas 92-159):
- 3 calls `safeMove(from, to)` → `safeCopy(from, to)` (skill dirs, INDEX.md, .gitkeep).
- Eliminado `tryRmdirIfEmpty(legacySkillsDir)` en esa rama.
- Nuevo helper `safeCopy(from, to)` = `mkdirSync + cpSync` (sin `rmSync`).

`test/hygiene-migrate.test.ts`:
- 3 tests actualizados (los que afirmaban el corte):
  - `skills migration by SKILL.md enumeration`
  - `skill dir with sub-dirs is moved recursively`
  - `migrates BOTH config and skills in one call`
- Cada assert reemplazado por aserción POSITIVA que **afirma** la preservación del source `.agents/skills/`.

## Why

Causa raíz: `safeMove` borraba el read-path del host (`<repo>/.agents/skills/`). El orquestador quedaba sin skills visibles después del primer migrate. Decisión: cortar nunca es correcto cuando el "origen" es un deployment dir del host.

## Rama Config intacta

Sigue usando `safeMove` correctamente (las 4 governance files **sí** son idu-pi, no del usuario).

## writer-migration.test.ts NO tocado

Es un test del writer territory (cuando idu-pi escribe NUEVO va solo a `.idu/skills/`, no toca `.agents/skills/`). Contrato distinto, sigue válido.

## Verificación

- 11/11 pass en `dist/test/hygiene-migrate.test.js`
- 2461/2461 en la suite completa (Etapa 1 lock)

## Decisión consciente

**No toqué** `result.moved` (rename cosmético a `applied`/`mirrored`) — es deuda futura. El array funciona igual con su nombre actual.

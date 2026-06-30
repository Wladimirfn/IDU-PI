# idu-pi skills deploy — Etapa 3b (skill-target-map + INDEX paramétrico)

## What changed

### Blocker 1 — INDEX paramétrico

`src/skills-host-deploy.ts`:
- `writeHostSkillIndex(hostDir, repoRoot?)` deriva `hostRel` vía `relative(repoRoot, hostDir)`. Sin `repoRoot`, fallback al basename de `hostDir`.
- **Eliminado el hardcode `.agents/skills/`** que rompía para Pi/Claude.
- `SkillsHostDeployInput` agrega `repoRoot?: string` y `hostLabel?: string`.
- `SkillsHostDeployResult` agrega `hostLabel?: string`.
- `formatSkillsHostDeployResult` ahora muestra `host mirror: <label>` cuando hay label.

### Blocker 2 — skill-target-map

Nuevos exports:
- `type SkillTargetId = "opencode" | "pi" | "claude"`
- `type SkillTargetScope = "project" | "global"`
- `resolveSkillTarget({target, scope, repoRoot}): SkillTarget`
- `parseSkillTarget(rest): {target, scope}` — acepta `--target`, `--target=`, `--scope=`, defaults opencode/project
- `getSkillHostDir({target, scope, repoRoot}): string`

Mapa:

| Target | Scope | Path |
|---|---|---|
| opencode | project | `<repo>/.agents/skills` |
| pi | project | `<repo>/.pi/skills` |
| claude | project | `<repo>/.claude/skills` |
| opencode | global (opt-in) | `~/.config/opencode/skills` |
| pi | global (opt-in) | `~/.pi/agent/skills` |
| claude | global (opt-in) | `~/.claude/skills` |

### Handler actualizado

`src/cli/single/handlers.ts:handleIduSkillsDeploy`:
- `--target opencode|pi|claude` (default opencode si ausente)
- `--scope project|global` (default project)
- Global require la flag explícita; `fail()` cerrado si no.

`src/skills-host-deploy.ts` extension — agregadas también 6 funciones:
- `listIduPiOwnedSkills(sourceDir)` + `listHostUserSkills(hostDir)` (helpers compartidos)

### Tests nuevos

Bloque "Etapa 3b — skill-target-map" + "Etapa 3b — per-host deploy contracts":

| Test | Cubre |
|---|---|
| `resolveSkillTarget: opencode project-local -> <repo>/.agents/skills` | Mapping base |
| `resolveSkillTarget: pi project-local -> <repo>/.pi/skills` | Pi base |
| `resolveSkillTarget: claude project-local -> <repo>/.claude/skills` | Claude base |
| `resolveSkillTarget: global scope resolves to homedir paths` | Global opt-in |
| `getSkillHostDir: convenience wrapper returns the same as resolveSkillTarget.dir` | Equivalencia |
| `parseSkillTarget: no --target defaults to opencode project-local` | Backward compat |
| `parseSkillTarget: --target pi project-local (default scope)` | Pi parsing |
| `parseSkillTarget: --target=claude --scope=global` | Combined flags |
| `parseSkillTarget: unknown target throws with explicit message` | Error path |
| `writeHostSkillIndex: INDEX paths are HOST-relative, not hardcoded (Etapa 3a bug regression)` | **REGRESIÓN bloqueante cerrada** |
| `writeHostSkillIndex: with repoRoot undefined, falls back to host-dir basename` | Fallback behavior |
| `Etapa 3b — deploy to .pi/skills uses .pi/skills in INDEX paths` | Contrato Pi |
| `Etapa 3b — deploy to .claude/skills uses .claude/skills in INDEX paths` | Contrato Claude |
| `Etapa 3b — Pi deploy overwrites stale + preserves user subdirs` | Sobre+preserve |
| `Etapa 3b — Pi deploy is idempotent (second run = no destructive changes)` | Idempotencia |

### Importante: el bug del Etapa 3a NO existió en 3a como tal

Etapa 3a solo deployaba a `.agents/skills/`. El bug del hardcode se manifestaba en cuanto se intentaba deployar a otro host. Lo cerramos con test de regresión explícito (no solo porque "no debe pasar", sino porque **algo lo introduciría de nuevo** si alguien vuelve a hardcodear).

## Output crudo del deploy real a `.pi/skills`

(Ver `skill-deploy-stage-3a.md` o el de 3b — el INDEX muestra `.pi/skills/<name>/SKILL.md` para todas las 8 entries. Sin un solo `.agents/skills` literal cuando host=Pi.)

## Lo que NO probé

Los **globales** (`~/.pi/agent/skills`, `~/.claude/skills`) están implementados en el resolver y en el parser, con doble confirmación (`--scope global` + flag check en handler). **No probé live**: no hice deploy real al HOME, no testeé side-effects. La rama lógica está cubierta por tests. Si lo querés, decime y corro el demo contra `~/`.

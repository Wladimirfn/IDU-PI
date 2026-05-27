# Git hygiene for Idu-pi

Idu-pi separates source/templates from runtime state. Use this guide before committing new files.

## Versionable source

Commit these files when they change intentionally:

- `src/**` — TypeScript source.
- `test/**` — tests.
- `docs/**` and `README.md` — documentation.
- `package.json`, `pnpm-lock.yaml`, `tsconfig.json` — project metadata/tooling.
- `config/default-*.json` — default templates used by installers/bootstrap.
- `.pi/extensions/idu-pi-commands.ts` — source template copied to the user's global Pi extensions directory.
- `.atl/skill-registry.md` — source skill registry.
- `.agents/skills/**` — base skills shipped with this repo.

## Runtime or generated state: do not commit

These are ignored and should stay local/generated:

- `.env`, `.env.*` except `.env.example`.
- `dist/`, `.pi-lens/`, build/test output and caches.
- `reports/`, `workspaces/`, `semantic-audit/`, `semantic/lab/generated/`, `bridge-agents/`, `AGENT_WORKSPACE_ROOT/`.
- SQLite/database files: `*.db`, `*.sqlite`, `*.sqlite3`.
- queues and learning state: `tasks.jsonl`, `supervisor-learning-rules.json`, `supervisor-learning-rules.backup-*.json`.
- generated review/draft artifacts:
  - `semantic-compaction-draft-*.json`
  - `supervisor-improvement-proposals-*.json`
  - `skill-improvement-proposals-*.json`
  - `skill-draft-*.json`
  - `agentlab-review-request-*.json`
  - `agentlab-review-run-*.json`
  - `agentlab-consolidation-*.json`

## Project-local config

In the Idu-pi repo, bootstrap-generated project config is ignored:

- `config/project-core.json`
- `config/project-constitution.json`
- `config/project-blueprint.json`
- `config/project-flows.json`

The repo keeps only versionable templates:

- `config/default-core.json`
- `config/default-constitution.json`
- `config/default-blueprint.json`
- `config/default-flows.json`

For external projects, the team decides whether `config/project-core.json` and `config/project-constitution.json` are project truth and should be committed. If committed, Project Core still becomes authoritative only after human confirmation.

## Review commands

Before committing hygiene-sensitive changes:

```bash
git status --ignored
git ls-files
```

Check whether a path is ignored:

```bash
git check-ignore -v reports/test.json
git check-ignore -v .env
git check-ignore -v config/project-core.json
```

For tracked files that may match ignore rules, use `--no-index` to inspect ignore rules independent of tracking:

```bash
git check-ignore -v --no-index .pi/extensions/idu-pi-commands.ts
git check-ignore -v --no-index .atl/skill-registry.md
```

Expected behavior in this repo:

```text
.pi/extensions/idu-pi-commands.ts  -> not ignored
.atl/skill-registry.md             -> not ignored
config/default-core.json           -> not ignored
config/project-core.json           -> ignored
reports/test.json                  -> ignored
.env                               -> ignored
```

## Staging rule

Do not use `git add .`. Stage explicit paths, for example:

```bash
git add .gitignore docs/git-hygiene.md
```

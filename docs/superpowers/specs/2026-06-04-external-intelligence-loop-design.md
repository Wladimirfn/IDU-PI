# External Intelligence Loop Design

## Goal
Give Bibliotecario controlled external ecosystem/security/update intelligence for feasibility and plan decisions without turning Idu-pi into a free web crawler or auto-updater.

## Scope
This slice adds a small allowlisted external intelligence report. It can query only known source IDs mapped internally to approved URLs. It stores normalized metadata/signals under `stateRoot/reports`, never raw fetched docs.

## Safety Requirements
- Advisory-only.
- Exact allowlist; no arbitrary URL input.
- No automatic dependency updates.
- No AgentLab auto-run.
- No contract promotion.
- No raw prompts, docs, response bodies, headers, env, tokens, costs, or remote analytics.
- Partial failures are reported as limitations.
- This MVP only produces an advisory external intelligence report/tool. Master Plan consumption is future work and must use these signals as feasibility/risk evidence only.

## MVP Sources
Start with conservative source ids:
- `nodejs-releases`: official Node.js release index.
- `nextjs-releases`: official GitHub releases for `vercel/next.js` if allowlisted.
- `npm-advisories`: intentionally supported as skipped/unsupported until a stable public source is selected.

## Report Shape
`ExternalIntelligenceReport` contains:
- version/project/generatedAt/mode;
- allowlist version;
- source statuses;
- normalized signals;
- limitations;
- safety booleans.

## Non-goals
- No source-library raw import from remote URLs.
- No generic browser/search.
- No dependency manifest edits.
- No plan approval by external signal alone.

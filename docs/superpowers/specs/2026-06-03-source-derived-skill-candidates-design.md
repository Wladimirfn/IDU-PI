# Source-Derived Skill Candidates Design

## Status
Approved for implementation planning.

## Goal
Allow the librarian/source library to turn local or external documentation evidence into auditable project skill candidates and optional SKILL.md draft previews, without installing real skills or modifying `.agents`, `.atl`, or project code.

## Non-goals
- Do not install generated skills.
- Do not write `.agents/skills/**`, `.atl/**`, or real project skill files.
- Do not run AgentLabs automatically.
- Do not promote source evidence into project contracts or Master Plan rules automatically.
- Do not infer token/cost savings without structured evidence.
- Do not use web/live sources in this slice; use already registered/digested Source Library artifacts only.
- Do not merge or archive duplicate skills yet; only report duplicate candidates as advisory if detected.

## User-facing behavior
A user can register and digest documentation through the existing Source Library flow. Then the librarian can generate a reports-only artifact containing skill candidates derived from source digests.

Expected flow:

```text
source_add / source_digest
→ source_skill_candidates_create
→ source_skill_candidates_review latest
→ optional future AgentLab audit
→ optional future human-approved skill draft/install
```

A creation result should say clearly:

```text
Source skill candidates
candidates: 3
report: <stateRoot>/reports/source-skill-candidates-YYYYMMDD-HHMMSS.json
warning: Reports-only. No real skills were modified.
tokens/cost: no medido
```

A candidate should look conceptually like:

```json
{
  "candidateId": "source-skill-js-engineering-practices",
  "title": "JavaScript engineering practices",
  "suggestedSkillName": "javascript-engineering-practices",
  "purpose": "Apply JS engineering practices from registered documentation.",
  "triggers": ["JavaScript refactor", "frontend module", "API logic"],
  "sourceIds": ["source-123"],
  "chunkIds": ["chunk-001", "chunk-004"],
  "evidenceRefs": ["source-123/chunk-001"],
  "draftTargetPath": ".agents/skills/javascript-engineering-practices/SKILL.md",
  "draftPreview": "---\nname: javascript-engineering-practices\n...",
  "requiresHumanApproval": true,
  "contractPromotionAllowed": false,
  "tokensCostMeasured": false,
  "efficiencyEvidence": "no medido"
}
```

## Source evidence model
The candidate generator must consume existing Source Library artifacts:

```text
<stateRoot>/Doc/<project>/source-library-index.json
<stateRoot>/Doc/<project>/sources/digests/<sourceId>.json
<stateRoot>/Doc/<project>/sources/chunks/<sourceId>/<chunkId>.md
```

It should prefer structured digest fields:

- `topics`
- `useWhen`
- `summary`
- `recommendedReads`
- `limitations`
- `requiredAction`

It should not embed full source documents. Evidence should be compact refs and short summaries/snippets only.

Unreadable or metadata-only sources must not produce semantic skill candidates. They should appear as limitations or required actions, e.g.:

```text
source abc requires specialized reader before skill extraction
```

## Candidate generation rules
A source-derived skill candidate may be created when a digest has reusable engineering guidance, patterns, practices, workflows, design rules, testing rules, safety rules, framework usage guidance, or project conventions.

Candidate fields:

- `candidateId`: stable slug derived from source/topic/purpose.
- `title`: short human-readable title.
- `suggestedSkillName`: safe skill folder/name slug.
- `purpose`: what the skill helps with.
- `triggers`: when the orquestador should consider it.
- `sourceIds`: sources used.
- `chunkIds`: supporting chunks/recommended reads.
- `evidenceRefs`: source/chunk refs.
- `draftTargetPath`: metadata-only suggested future path.
- `draftPreview`: optional SKILL.md-shaped preview stored inside the report only.
- `limitations`: missing context or weak evidence.
- `duplicateHints`: optional advisory list of likely similar candidates/skills.
- `requiresHumanApproval: true`.
- `contractPromotionAllowed: false`.
- `tokensCostMeasured: false`.
- `efficiencyEvidence: "no medido"`.

Do not overclaim that the candidate improves quality, reduces cost, or saves tokens. Those claims require future AgentLab or structured evidence.

## Reports and stateRoot policy
All generated artifacts must stay under:

```text
<stateRoot>/reports/source-skill-candidates-YYYYMMDD-HHMMSS.json
```

Optional draft preview content stays inside that JSON report. No `SKILL.md` file is written in this slice.

The report must include:

- `version: 1`
- `projectId`
- `createdAt`
- `source`: `source_library`
- `warning`: reports-only / no skills modified
- `contractPromotionAllowed: false`
- `requiresHumanApproval: true`
- `tokensCostMeasured: false`
- `efficiencyEvidence: "no medido"`
- `candidates`
- `limitations`
- `requiredActions`

## CLI and MCP surfaces
Add small advisory surfaces:

```text
idu-pi idu-source-skill-candidates-create [all|latest|sourceId]
idu-pi idu-source-skill-candidates-review latest
```

MCP tools:

```text
idu_source_skill_candidates_create
idu_source_skill_candidates_review
```

MCP output must remain advisory:

- no skill installation;
- no AgentLab execution;
- no contract promotion;
- no repo writes outside stateRoot reports;
- `orchestratorDecisionRequired: true` when candidates exist.

## AgentLab relationship
This slice only prepares candidates. Later AgentLab flows can audit:

- whether a model understands the skill;
- whether two candidates duplicate each other;
- whether a merge improves quality;
- whether a skill reduces context injection size;
- whether small models can use it reliably.

AgentLabs remain audit-only and must not install, edit, commit, push, or promote skills/contracts.

## Master Plan relationship
The Master Plan should describe the policy, not store every candidate.

Policy-level statement:

```text
Documentation can produce source-derived skill candidates. Candidates require evidence, AgentLab/human review before installation, and remain reports-only until approved.
```

Detailed candidate reports live in stateRoot reports and Source Library artifacts.

## Duplicate and merge policy
First slice may detect possible duplicate names/topics and report `duplicateHints`, but it must not merge or delete anything.

Future duplicate flow:

```text
candidate A vs candidate B
→ AgentLab comprehension/quality test
→ merge/archive proposal
→ human approval
→ reports-only draft
→ future installation path
```

## Error handling
- Missing source library index: return no candidates and a limitation.
- Missing digest file: skip source and report limitation.
- Digest requiring specialized reader: skip semantic candidate and report required action.
- No reusable patterns found: create an empty report with limitations.
- Invalid review file: return validation errors, do not throw.
- Path outside reports/stateRoot: reject.

## Testing
Add tests for:

- missing source index produces no candidates and clear limitation;
- readable digest creates reports-only candidate JSON under `reports`;
- candidate includes source/chunk evidence refs and no measured token/cost claims;
- draft preview is SKILL.md-shaped but no `.agents/skills` files are created;
- unreadable/specialized-reader digest is skipped with required action/limitation;
- review latest/path validates schema and rejects unsafe paths;
- CLI wiring calls runtime methods and prints reports-only warning;
- MCP tools exist and return advisory envelope with no-install safe notes.

## Implementation scope
Expected files:

- create `src/source-skill-candidates.ts`
- update `src/cli.ts`
- update `src/mcp-server.ts`
- update `src/command-catalog.ts`
- add `test/source-skill-candidates.test.ts`
- update CLI/MCP/command catalog tests
- update docs command references if command docs are maintained in this repo

Keep this slice small and deterministic. Do not build duplicate merging or AgentLab skill comprehension tests yet.
# External Source Registry v1 Design

## Goal
Give Bibliotecario a governed source-quality catalog for external evidence and programming-structure guidance without fetching, crawling, importing raw docs, or promoting contracts automatically.

## Scope
Add a static/versioned registry and recommendation report for external source descriptors. The registry answers which source categories are appropriate for a task/domain/language/framework and how much trust/automation is allowed.

## Categories
- `official_docs`
- `academic_discovery`
- `community_signal`
- `blocked_or_manual`

## Transversal Domains
- `programming_structure`
- `code_architecture`
- `language_conventions`
- `separation_of_concerns`
- `security`
- `civil_works`
- `web`
- `database`
- `cloud`
- `ai_agents`
- `project_similarity`
- `standards`
- `academic`

## Required Source Descriptors
- ISO OBP
- AENOR search
- IBM Cloud Docs
- OpenAlex
- Crossref
- Semantic Scholar
- arXiv
- PubMed
- DOAJ
- BASE Search
- GitHub similar projects
- GitHub issues
- GitHub releases
- Reddit
- X public posts/accounts
- Google Scholar
- Academia.edu

## Safety
- Registry-only: no fetch.
- No arbitrary URL browsing.
- No raw docs/prompts stored.
- No Source Library import.
- No dependency update.
- No AgentLab auto-run.
- No contract/source promotion.
- Community/social signals require human verification.
- Google Scholar, Academia.edu, X home/feed and login/paywall sources are manual/blocked for automation.

## Programming Structure Guidance
`programming_structure` is a domain, not a category. It must support recommendations for questions like:
- HTML must keep structure/semantics and avoid embedded JS/inline handlers.
- JavaScript/TypeScript should separate modules, services, validation, config, and tests.
- Framework projects should keep routing, UI, data, services, and persistence boundaries explicit.
- Folders should be created intentionally by domain/feature/layer, not as uncontrolled accumulation.

## MCP Surface
Add a read-only tool such as `idu_external_source_recommend` with:
- required `request`;
- optional `domains`, `language`, `framework`, `maxMatches`;
- advisory decision envelope and safe notes.

## Non-goals
- Do not replace `idu_external_intelligence_report`.
- Do not fetch live sources.
- Do not wire Master Plan consumption yet beyond docs saying future use.

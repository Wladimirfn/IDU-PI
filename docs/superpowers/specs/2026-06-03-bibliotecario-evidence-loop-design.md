# Bibliotecario Evidence Loop Design

## Goal
Make `external-source-intelligence` AgentLab requests use concrete local Source Library digest/chunk evidence instead of shallow generic external-source prompts.

## Scope
This slice improves request planning only. It passes compact local evidence references from Source Library recommendations into librarian AgentLab requests. It does not fetch the web, read full source documents, execute AgentLabs, promote contracts, or modify runner behavior.

## Architecture
The loop is local and advisory:

```text
Source Library digests/index in stateRoot
→ recommendSourcesForTask(request)
→ compact source/chunk references
→ idu_agentlab_request_create(source: external-source-intelligence)
→ librarian AgentLab request with concrete evidence refs
→ optional explicit idu_agentlab_review_run later
```

The request includes source IDs, chunk IDs, reasons, confidence, missing knowledge, and limitations. It does not include raw huge source text. Source Library evidence remains `contractPromotionAllowed:false`.

## Requirements
- `external_source_intelligence` request creation accepts compact Source Library evidence.
- When evidence exists, the librarian request uses local digest/chunk refs as primary evidence.
- When no digest/index/matches exist, the request surfaces missing knowledge and limitations rather than pretending live knowledge exists.
- MCP/CLI request creation for `external-source-intelligence` should try local Source Library recommendations using objective/context/request text.
- Safe notes must remain explicit: no web/live fetch, no AgentLab execution, no contract promotion.
- AgentLabs remain audit-only and explicit-run only.

## Non-goals
- Do not add web search or live fetching.
- Do not read full source documents or include raw chunks in request JSON.
- Do not auto-run AgentLabs.
- Do not change Source Library digest generation.
- Do not change AgentLab runner concurrency.
- Do not promote contracts, skills, or rules from source evidence.

## Evidence Shape
Use a compact shape:

```ts
type AgentLabSourceLibraryEvidence = {
  request: string;
  generatedAt: string;
  matches: Array<{
    sourceId: string;
    title: string;
    chunkIds: string[];
    whyRelevant: string;
    confidence: "low" | "medium" | "high";
  }>;
  missingKnowledge: string[];
  limitations: string[];
  contractPromotionAllowed: false;
};
```

## Tests
- Request builder includes source IDs, chunk IDs, reasons, and limitations in external-source-intelligence requests.
- Request builder does not include raw huge source text.
- MCP request-create for external-source-intelligence passes local recommendation evidence and keeps no-run safe notes.
- Missing local evidence produces missingKnowledge/limitations, not generic live-source claims.

## Risks
- Extending formal AgentLab contract too deeply could churn validators. If needed, keep evidence compact and bounded.
- Source Library paths are stateRoot artifacts, not repo files; do not place them in `filesToInspect` as repo paths.
- The word “external” can mislead; docs must clarify this slice uses local Source Library/digest evidence only unless a human/orchestrator separately runs a web-capable librarian.

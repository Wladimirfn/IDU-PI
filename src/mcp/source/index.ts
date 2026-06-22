// src/mcp/source/index.ts
//
// PR 19 (Item 4, mcp-server god-file breakup): barrel for cluster R
// (source). Re-exports the public surface — the 15 wrappers used
// by dispatchTool in mcp-server.ts.
export {
	handleSourceAdd,
	handleSourceChunkRead,
	handleSourceDigest,
	handleSourceDigestStatus,
	handleSourceExtract,
	handleSourceRead,
	handleSourceRecommendForTask,
	handleSourceRefresh,
	handleSourceRemove,
	handleSourceReport,
	handleSourceRequiredActions,
	handleSourceResearchReport,
	handleSourceSkillCandidatesCreate,
	handleSourceSkillCandidatesReview,
	handleSourceStatus,
} from "./handlers.js";

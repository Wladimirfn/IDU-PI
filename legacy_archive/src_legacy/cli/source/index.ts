/**
 * index.ts — barrel for the source cluster (F).
 *
 * PR 7d of 7 (Item 4). Move + re-export PURO.
 *
 * Re-exports the 15 case wrappers from handlers.ts. No internal
 * helpers — the source cluster has no logic to extract, only
 * dispatch calls to runtime methods.
 */

export {
	handleSourceStatus,
	handleSourceAdd,
	handleSourceRemove,
	handleSourceRead,
	handleSourceExtract,
	handleSourceReport,
	handleSourceResearch,
	handleSourceDigest,
	handleSourceDigestStatus,
	handleSourceChunkRead,
	handleSourceRecommend,
	handleSourceRequiredActions,
	handleSourceSkillCandidatesCreate,
	handleSourceSkillCandidatesReview,
	handleSourceRefresh,
} from "./handlers.js";
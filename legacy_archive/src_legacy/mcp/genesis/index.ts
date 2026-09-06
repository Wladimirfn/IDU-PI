// src/mcp/genesis/index.ts
//
// PR 15 (Item 4, mcp-server god-file breakup): barrel for cluster L
// (genesis-skill). Re-exports the public surface — the 4 wrappers used
// by dispatchTool in mcp-server.ts.
export {
	handleGenesisMissionConfirm,
	handleGenesisMissionDraft,
	handleSkillDraftFromLessons,
	handleSkillForTask,
} from "./handlers.js";

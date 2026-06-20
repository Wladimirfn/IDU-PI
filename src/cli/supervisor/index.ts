/**
 * index.ts — barrel for the supervisor cluster (G).
 *
 * PR 7e of 7 (Item 4). Move + re-export PURO.
 *
 * Re-exports the 16 case wrappers from handlers.ts. No internal
 * helpers — the supervisor cluster is pure dispatch (calls runtime
 * methods and a few external helpers from supervisor-learning-rules.js
 * and supervisor-trigger.js, both already exported).
 */

export {
	handleRunCronPreflight,
	handleCheckUserEscalation,
	handleSupervisorTick,
	handleSupervisorImprovementsReview,
	handleSupervisorImprovementsCreate,
	handleSupervisorImprovementsStatus,
	handleSupervisorImprovementsApprove,
	handleSupervisorImprovementsReject,
	handleSupervisorImprovementsDefer,
	handleSupervisorImprovementsApply,
	handleSupervisorLearningRulesStatus,
	handleSupervisorLearningRulesTest,
	handleSupervisorLearningRulesDisable,
	handleSupervisorLearningRulesEnable,
	handleSupervisorLearningRulesRollback,
	handleSupervisorTrigger,
} from "./handlers.js";
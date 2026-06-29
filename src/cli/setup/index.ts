/**
 * index.ts — barrel for the setup cluster (O).
 *
 * PR 3 of 7 (Item 4). Move + re-export PURO. Internal-only (no public
 * surface exports). The internal helpers are re-exported so `src/cli.ts`
 * can keep calling them without rewriting call sites.
 */

export {
	loadConfirmedProjectConstitution,
} from "../../project-constitution.js";
export {
	handleSetupCommand,
	parseMcpTarget,
	handleProjectCommand,
	inspectConnection,
	formatCliSupervisorStartupSection,
	formatDashboard,
	buildPreflightReport,
	buildPostflightReport,
	runPrepare,
} from "./helpers.js";

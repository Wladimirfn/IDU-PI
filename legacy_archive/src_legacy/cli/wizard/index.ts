/**
 * index.ts — barrel for the wizard cluster (N).
 *
 * PR 3 of 7 (Item 4). Move + re-export PURO. Internal-only (no public
 * surface exports). The internal helpers are re-exported so `src/cli.ts`
 * can keep calling them without rewriting call sites.
 */

export {
	runWizardActivateSupervisor,
	registeredProjectForPath,
	requiredEnvForWizard,
	parseAllowedRootsForWizard,
	wizardActivationDiagnostic,
} from "./helpers.js";

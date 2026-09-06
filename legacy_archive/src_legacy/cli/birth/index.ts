/**
 * index.ts — barrel for the birth cluster (D).
 *
 * PR 2 of 7 (Item 4). Move + re-export PURO. No exports in the public
 * surface (cluster D is internal-only). The internal helpers are
 * re-exported so `src/cli.ts` can keep calling them without rewriting
 * call sites.
 */

export {
	parseBirthGeneralSpecCliInput,
	parseGeneralSpecSections,
	requiredStringArray,
	isObjectRecord,
	formatBirthGeneralSpec,
	parseUiFiles,
	formatBirthGeneralSpecDerivation,
	formatBirthStatus,
	formatBirthExistingScan,
	formatBirthBibliotecario,
	formatBirthValidate,
	formatBirthRepoPlan,
	formatBirthPrototype,
} from "./helpers.js";

export {
	handleBirthStatus,
	handleBirthExistingScan,
	handleBirthBibliotecarioDiscovery,
	handleBirthValidate,
	handleBirthGeneralSpec,
	handleBirthGeneralSpecDerive,
	handleBirthPrototypeMaster,
	handleBirthRepoPlan,
} from "./handlers.js";

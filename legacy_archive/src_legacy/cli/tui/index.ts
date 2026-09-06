/**
 * index.ts — barrel for the TUI cluster (L).
 *
 * PR 6 of 7 (Item 4). Move + re-export PURO.
 *
 * 46 functions + 7 types + 12 constants.
 * 4 functions are in the 20-function public surface (snapshot test
 * pins them): `runInteractiveHome`, `runTaskQueuePanelTui`,
 * `__testSelectSearchableMenu`, `runInteractiveHomeWithQuestion`.
 *
 * The inline cases (e.g., `case "idu-..."` inside `runCliCommand`)
 * stay in cli.ts (cluster A, extracted in a separate phase).
 */

export {
	buildHomeTaskQueueRuntime,
	shouldRunInteractiveHome,
	runInteractiveHome,
	tareasViewOptions,
	runTareasViewTui,
	colaDeAccionesViewOptions,
	runColaDeAccionesViewTui,
	runProjectStatusPanelTui,
	projectStatusPanelOptions,
	mainMenuOptions,
	installationMenuOptions,
	supervisorTriggerMenuOptions,
	formatSupervisorTriggerTui,
	runSupervisorTriggerMenuTui,
	runInstallationMenuTui,
	resolveSupervisorTriggerStateRootForTui,
	telegramRemoteMenuOptions,
	runTelegramRemoteMenuTui,
	modelProfilesMenuOptions,
	runModelProfilesMenuTui,
	runTaskQueuePanelTui,
	selectMenu,
	selectSearchableMenu,
	__testSelectSearchableMenu,
	showTextView,
	topBorder,
	midBorder,
	bottomBorder,
	panelLine,
	contentLines,
	runInteractiveHomeWithQuestion,
	handleModelProfilesChoice,
	editAgentProfilesTui,
	editAgentProfiles,
	proposeAgentLabModelAssignments,
	assignModelRoleTui,
	selectModelAssignmentTui,
	promptModelAssignment,
	assignModelRole,
	runTelegramRemoteMenu,
	handleTelegramRemoteChoice,
	runBridgeLifecycleChoice,
	runModelProfilesMenu,
	runInstallationMenu,
	handleInstallationChoice,
	confirmAction,
} from "./helpers.js";

export type {
	CliQuestion,
	CliPrint,
	CliHomeActionOptions,
	MenuOption,
	InteractiveHomeSelectMenu,
	TareasViewDispatchRuntime,
	SelectSearchableMenuSettings,
	SelectSearchableMenuInput,
	SelectSearchableMenuOutput,
	SelectSearchableMenuDeps,
} from "./helpers.js";
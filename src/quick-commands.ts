export type QuickCommand = "review" | "fix_tests" | "audit" | "safe_push";

export type DashboardState = {
	bridgePid: number;
	projectLabel: string;
	currentCwd: string;
	agentLabel: string;
	agentId: string;
	workspace: string;
	workspaceKind: "direct" | "clone";
	rpcRunning: boolean;
	busy: boolean;
	modePrefix: string;
	lastSessionCount: number;
};

export function buildDashboardText(state: DashboardState): string {
	return `📊 Dashboard Idu-pi

Bridge PID: ${state.bridgePid}
Estado: ${state.busy ? "ocupado" : "libre"}
RPC: ${state.rpcRunning ? "iniciado" : "en espera"}
Proyecto: ${state.projectLabel}
CWD target: ${state.currentCwd}
Agente: ${state.agentLabel} (${state.agentId})
Workspace: ${state.workspace}
Modo workspace: ${state.workspaceKind}
Modo orquestador: ${state.modePrefix || "default"}
Trabajos recientes: ${state.lastSessionCount}

Sugeridos:
/server status
/trabajos
/review
/fix_tests
/audit
/safe_push`;
}

export function buildQuickCommandPrompt(command: string): string | undefined {
	switch (command) {
		case "review":
			return "Review the current project changes. Inspect git status/diff, identify correctness/security/test issues, do not commit or push, and return prioritized findings with file references.";
		case "fix_tests":
			return "Fix failing tests in this project using strict TDD discipline. First run the test command, identify failures, make minimal fixes, rerun tests, and report evidence.";
		case "audit":
			return "Audit this codebase for public-repo readiness: secrets, ignored files, build artifacts, README accuracy, tests, security risks, and dead files. Fix only safe cleanup issues and report evidence.";
		case "safe_push":
			return "Run a safe push checklist for this public repository. Check git status, ignored/private files, secrets, tests, and remote state. Ask before committing or pushing anything. Return a concise go/no-go report.";
		default:
			return undefined;
	}
}

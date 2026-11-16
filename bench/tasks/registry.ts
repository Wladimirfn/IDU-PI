import type { BenchmarkTaskDef } from "../types.js";
import { tbLogForensicsTask } from "./tb-log-forensics.js";
import { tbGitReleaseTask } from "./tb-git-release.js";
import { sweStreamRollupTask } from "./swe-stream-rollup.js";
import { sweDagSchedulerTask } from "./swe-dag-scheduler.js";
import { auditSecurityRaceTask } from "./audit-security-race.js";
import { consultArchTradeoffTask } from "./consult-arch-tradeoff.js";
import { exploreCallflowMapTask } from "./explore-callflow-map.js";
import { design3dExplainerTask } from "./design-3d-explainer.js";

export const BENCHMARK_TASKS: BenchmarkTaskDef[] = [
	tbLogForensicsTask,
	tbGitReleaseTask,
	sweStreamRollupTask,
	sweDagSchedulerTask,
	auditSecurityRaceTask,
	consultArchTradeoffTask,
	exploreCallflowMapTask,
	design3dExplainerTask,
];

export function getBenchmarkTask(id: string): BenchmarkTaskDef | undefined {
	return BENCHMARK_TASKS.find((t) => t.id === id);
}

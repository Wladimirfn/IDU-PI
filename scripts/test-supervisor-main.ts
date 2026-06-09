/**
 * E2E smoke: invoke the supervisor-main role against a synthetic
 * orchestrator_turn event. The role calls the configured opencode-go
 * model (B5 wiring), persists the invocation to lab.db model_invocation_log,
 * and emits a RoleAdvisory. We print the result so a human can judge
 * the quality.
 *
 * Run: node dist/scripts/test-supervisor-main.js
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
// Ensure the user-local npm bin (where `pi` lives on Windows) is on
// PATH so PiRpcSession can spawn the pi binary. Node's PATH does
// not always include it when run from this script.
const USER_NPM_BIN = "C:\Users\elmas\AppData\Roaming\npm";
if (!process.env.PATH?.includes(USER_NPM_BIN)) {
	process.env.PATH = `${USER_NPM_BIN}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`;
}
import { AgentRouter } from "../src/agent-router.js";
import { LabDbRepository } from "../src/lab-db-repository.js";
import { computeEventHash, type Event } from "../src/event-bus.js";
import type { RoleAdvisory } from "../src/roles/index.js";
import { RoleEngine } from "../src/role-engine.js";
import { loadRoleEngineConfig } from "../src/role-engine-config.js";

const stateRoot =
	process.env.IDU_PI_STATE_ROOT ??
	"C:/Users/elmas/Documents/bridge-agents/projects/idu-pi";

if (!existsSync(join(stateRoot, "role-engine.json"))) {
	console.error(`role-engine.json not found at ${stateRoot}/role-engine.json`);
	console.error("create it with roleEnabled: { 'supervisor-main': true, ... }");
	process.exit(1);
}

const config = loadRoleEngineConfig(stateRoot);
console.log("=== Role engine config ===");
console.log(`maxRoleInvocationsPerTurn: ${config.maxRoleInvocationsPerTurn}`);
console.log(
	`supervisor-main enabled: ${Boolean(config.roleEnabled["supervisor-main"])}`,
);
if (!config.roleEnabled["supervisor-main"]) {
	console.error("supervisor-main is NOT enabled. Aborting.");
	process.exit(1);
}

const labDbPath = join(stateRoot, "projects", "idu-pi", "lab.db");
const repository = new LabDbRepository(labDbPath, {
	modelInvocationLogProjectId: "idu-pi",
});

const router = new AgentRouter({
	piBin: "pi",
	basePiArgs: [],
	profiles: [
		{ id: "default", label: "Default", provider: "pi", piArgs: [] },
		{
			id: "supervisor-main",
			label: "Supervisor Main",
			provider: "pi",
			piArgs: [],
		},
	],
	defaultProjectId: "idu-pi",
	defaultCwd: "C:/Users/elmas/pi-telegram-bridge",
	workspaceMode: "direct",
	workspaceRoot: stateRoot,
});

const advisories: RoleAdvisory[] = [];

const engine = new RoleEngine({
	stateRoot,
	projectId: "idu-pi",
	router,
	repository,
	config,
	appendAdvisory: (advisory: RoleAdvisory) => {
		advisories.push(advisory);
		const meta = (advisory.meta ?? {}) as {
			provider?: string;
			model?: string;
			status?: string;
			promptChars?: number;
			responseChars?: number;
		};
		repository.appendInvocation({
			role: advisory.roleId,
			provider: meta.provider ?? "?",
			model: meta.model ?? "?",
			status: (meta.status as "success" | "failure" | "skipped") ?? "success",
			promptChars: meta.promptChars ?? 0,
			responseChars: meta.responseChars ?? 0,
			ts: advisory.ts,
		});
	},
	emitEvent: (event: Event) => {
		console.log(
			`[event] ${event.kind} roleId=${(event.payload as { roleId?: string }).roleId ?? "?"} priority=${(event.payload as { priority?: number }).priority ?? "?"}`,
		);
	},
});

const event: Event = {
	ts: new Date().toISOString(),
	kind: "orchestrator_turn",
	projectId: "idu-pi",
	payload: {
		turnId: `smoke-${Date.now()}`,
		userText:
			"Smoke test: confirm supervisor-main emits an advisory. Status: B5 E2E.",
		recentAdvisories: [],
	},
	sourceRef: "smoke-test",
	evidenceRefs: [],
};
const eventHash = computeEventHash(event);
console.log("\n=== Dispatch event ===");
console.log(`kind: ${event.kind}`);
console.log(`hash: ${eventHash.substring(0, 12)}...`);

const t0 = Date.now();
const result = await engine.onEvent(event);
const t1 = Date.now();
console.log(`\n=== Engine result (${t1 - t0}ms) ===`);
console.log(JSON.stringify(result, null, 2));

console.log("\n=== Advisories emitted ===");
for (const adv of advisories) {
	const meta = (adv.meta ?? {}) as Record<string, unknown>;
	console.log(`role: ${adv.roleId}`);
	console.log(`priority: ${adv.priority}`);
	console.log(`ts: ${adv.ts}`);
	console.log(
		`provider: ${String(meta.provider ?? "?")}  model: ${String(meta.model ?? "?")}`,
	);
	console.log(`status: ${String(meta.status ?? "?")}`);
	console.log(
		`promptChars: ${String(meta.promptChars ?? 0)}  responseChars: ${String(meta.responseChars ?? 0)}`,
	);
	console.log(`advisory: ${adv.advisory}`);
	if (adv.evidenceRefs && adv.evidenceRefs.length) {
		console.log(`evidenceRefs: ${adv.evidenceRefs.join(", ")}`);
	}
}

console.log("\n=== Invocations in lab.db (last 5) ===");
const invocations = repository.listRecentInvocations(5);
for (const inv of invocations) {
	console.log(
		`  ${inv.ts}  ${inv.role}  ${inv.provider}/${inv.model}  status=${inv.status}  prompt=${inv.promptChars}  response=${inv.responseChars}`,
	);
}

console.log("\n=== Smoke complete ===");
console.log(
	`Open your opencode-go TUI dashboard to see consumption on the supervisor-main model (opencode-go/deepseek-v4-pro).`,
);

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkTaskDef, EvalCheckResult, TaskEvalResult } from "../types.js";
import { runIsolatedNodeCommand, runIsolatedNodeModuleCheck } from "./eval-subprocess.js";

const GRAPH_BUGGY = `export function topoOrder(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set();
  const order = [];

  for (const n of nodes) {
    if (visited.has(n.id)) continue;
    const active = new Set();
    function visit(id) {
      if (active.has(id)) {
        throw new Error("Cycle detected at " + id);
      }
      if (visited.has(id)) return;
      active.add(id);
      const node = byId.get(id);
      if (!node) throw new Error("Unknown dependency: " + id);
      for (const dep of node.deps || []) {
        visit(dep);
      }
      // Bug: never deletes id from active, causing false cycles on diamond graphs
      visited.add(id);
      order.push(id);
    }
    visit(n.id);
  }
  return order;
}
`;

const BACKOFF_BUGGY = `export function computeBackoffDelay({ attempt, baseDelayMs = 100, maxDelayMs = 2000, jitterRatio = 0.2, randomFn = Math.random }) {
  const raw = baseDelayMs * Math.pow(2, attempt);
  const delta = raw * jitterRatio * (randomFn() * 2 - 1);
  return Math.round(raw + delta);
}
`;

const STORE_BUGGY = `export class MemoryStateStore {
  constructor() {
    this.states = new Map();
  }

  getAll() {
    return Object.fromEntries(this.states.entries());
  }

  setStatus(id, patch) {
    const prev = this.states.get(id) ?? { id, status: "pending", attempts: 0 };
    const next = { ...prev, ...patch };
    this.states.set(id, next);
    return next;
  }
}
`;

const SCHEDULER_BUGGY = `import { topoOrder } from "./graph.mjs";
import { computeBackoffDelay } from "./backoff.mjs";

export async function runDag({
  tasks,
  executor,
  store,
  maxConcurrency = 2,
  maxRetries = 1,
  baseDelayMs = 10,
  maxDelayMs = 100,
  jitterRatio = 0,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  randomFn = Math.random,
}) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const t of tasks) {
    store.setStatus(t.id, { status: "pending", attempts: 0, error: null });
  }
  // Bug: topoOrder runs AFTER mutating store and throws inside diamond graphs
  topoOrder(tasks);

  const inFlight = new Set();

  function isReady(task) {
    const st = store.getAll()[task.id];
    if (!st || st.status !== "pending") return false;
    const deps = task.deps || [];
    if (deps.length === 0) return true;
    // Bug: uses .some() instead of waiting for ALL parents!
    return deps.some((d) => store.getAll()[d]?.status === "completed");
  }

  async function runOne(task) {
    let attempt = 0;
    while (true) {
      attempt += 1;
      store.setStatus(task.id, { status: "running", attempts: attempt });
      try {
        const result = await executor(task);
        store.setStatus(task.id, { status: "completed", result, error: null });
        return;
      } catch (err) {
        if (attempt > maxRetries) {
          store.setStatus(task.id, {
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        const delay = computeBackoffDelay({
          attempt,
          baseDelayMs,
          maxDelayMs,
          jitterRatio,
          randomFn,
        });
        await sleepFn(delay);
      }
    }
  }

  while (true) {
    const snap = store.getAll();
    const activeStates = Object.values(snap).filter((s) => s.status === "pending" || s.status === "running");
    if (activeStates.length === 0 && inFlight.size === 0) break;

    const ready = tasks.filter((t) => !inFlight.has(t.id) && isReady(t));
    for (const t of ready) {
      if (inFlight.size >= maxConcurrency) break;
      const p = runOne(t).finally(() => inFlight.delete(t.id));
      inFlight.add(t.id);
      void p;
    }

    if (inFlight.size > 0) {
      await sleepFn(1);
    }
  }

  return store.getAll();
}
`;

const BASELINE_TEST = `import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStateStore } from "../src/store.mjs";
import { runDag } from "../src/scheduler.mjs";

test("runDag executes a simple linear chain A -> B", async () => {
  const store = new MemoryStateStore();
  const seen = [];
  const res = await runDag({
    tasks: [{ id: "A", deps: [] }, { id: "B", deps: ["A"] }],
    executor: async (t) => {
      seen.push(t.id);
      return t.id + "_ok";
    },
    store,
    sleepFn: async () => {},
  });
  assert.deepEqual(seen, ["A", "B"]);
  assert.equal(res.B.status, "completed");
});
`;

const GRAPH_ORACLE = `export function topoOrder(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map(); // 0=unvisited, 1=visiting, 2=visited
  const order = [];

  function visit(id) {
    const st = state.get(id) ?? 0;
    if (st === 1) {
      throw new Error("Cycle detected at " + id);
    }
    if (st === 2) return;
    const node = byId.get(id);
    if (!node) throw new Error("Unknown dependency: " + id);
    state.set(id, 1);
    for (const dep of node.deps || []) {
      visit(dep);
    }
    state.set(id, 2);
    order.push(id);
  }

  for (const n of nodes) {
    if ((state.get(n.id) ?? 0) === 0) visit(n.id);
  }
  return order;
}
`;

const BACKOFF_ORACLE = `export function computeBackoffDelay({
  attempt,
  baseDelayMs = 100,
  maxDelayMs = 2000,
  jitterRatio = 0.2,
  randomFn = Math.random,
}) {
  const exp = Math.max(0, attempt - 1);
  const clampedBase = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, exp));
  const clampedRandom = Math.max(0, Math.min(1, randomFn()));
  const delta = clampedBase * jitterRatio * (clampedRandom * 2 - 1);
  return Math.max(0, Math.min(maxDelayMs, Math.round(clampedBase + delta)));
}
`;

const STORE_ORACLE = `export class MemoryStateStore {
  constructor() {
    this.states = new Map();
  }

  getAll() {
    const out = {};
    for (const [k, v] of this.states.entries()) {
      out[k] = structuredClone(v);
    }
    return out;
  }

  setStatus(id, patch) {
    const prev = this.states.get(id) ?? { id, status: "pending", attempts: 0 };
    const next = structuredClone({ ...prev, ...patch });
    this.states.set(id, next);
    return structuredClone(next);
  }
}
`;

const SCHEDULER_ORACLE = `import { topoOrder } from "./graph.mjs";
import { computeBackoffDelay } from "./backoff.mjs";

export async function runDag({
  tasks,
  executor,
  store,
  maxConcurrency = 2,
  maxRetries = 1,
  baseDelayMs = 10,
  maxDelayMs = 100,
  jitterRatio = 0,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)),
  randomFn = Math.random,
}) {
  // Validate DAG BEFORE touching store so invalid graphs never leave partial state
  topoOrder(tasks);

  for (const t of tasks) {
    store.setStatus(t.id, { status: "pending", attempts: 0, error: null });
  }

  const inFlightPromises = new Map();

  function markBlockedDescendants() {
    let changed = true;
    while (changed) {
      changed = false;
      const snap = store.getAll();
      for (const t of tasks) {
        const st = snap[t.id];
        if (!st || st.status !== "pending") continue;
        const badDep = (t.deps || []).find((d) => {
          const ds = snap[d]?.status;
          return ds === "failed" || ds === "blocked_failed";
        });
        if (badDep) {
          store.setStatus(t.id, {
            status: "blocked_failed",
            error: "Blocked by failed dependency: " + badDep,
          });
          changed = true;
        }
      }
    }
  }

  async function runOne(task) {
    let attempt = 0;
    while (true) {
      attempt += 1;
      store.setStatus(task.id, { status: "running", attempts: attempt });
      try {
        const result = await executor(task);
        store.setStatus(task.id, { status: "completed", result, error: null });
        return;
      } catch (err) {
        if (attempt > maxRetries) {
          store.setStatus(task.id, {
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        const delay = computeBackoffDelay({
          attempt,
          baseDelayMs,
          maxDelayMs,
          jitterRatio,
          randomFn,
        });
        await sleepFn(delay);
      }
    }
  }

  while (true) {
    markBlockedDescendants();
    const snap = store.getAll();
    const ready = tasks.filter((t) => {
      if (inFlightPromises.has(t.id)) return false;
      if (snap[t.id]?.status !== "pending") return false;
      return (t.deps || []).every((d) => snap[d]?.status === "completed");
    });

    for (const t of ready) {
      if (inFlightPromises.size >= maxConcurrency) break;
      const p = runOne(t).finally(() => inFlightPromises.delete(t.id));
      inFlightPromises.set(t.id, p);
    }

    const afterLaunch = store.getAll();
    const stillActive = Object.values(afterLaunch).some(
      (s) => s.status === "pending" || s.status === "running",
    );
    if (!stillActive && inFlightPromises.size === 0) break;

    if (inFlightPromises.size > 0) {
      await Promise.race(inFlightPromises.values());
    } else {
      throw new Error("Scheduler stalled with unresolved pending tasks");
    }
  }

  return store.getAll();
}
`;

export const sweDagSchedulerTask: BenchmarkTaskDef = {
	id: "swe-02-dag-scheduler",
	category: "swe-bench",
	title: "Diamond DAG Scheduler, Backoff & Store Rollback Bugfix",
	description:
		"Fix diamond false-cycle detection, all-deps gating, upstream failure cascading to blocked_failed, pre-mutation cycle validation, backoff clamping, and store isolation.",
	timeoutMs: 180_000,
	protectedPaths: ["test/scheduler.test.mjs"],
	fixtureFiles: {
		"package.json": JSON.stringify(
			{
				name: "swe-02-dag-scheduler",
				type: "module",
				private: true,
				scripts: { test: "node --test test/scheduler.test.mjs" },
			},
			null,
			2,
		) + "\n",
		"src/graph.mjs": GRAPH_BUGGY,
		"src/backoff.mjs": BACKOFF_BUGGY,
		"src/store.mjs": STORE_BUGGY,
		"src/scheduler.mjs": SCHEDULER_BUGGY,
		"test/scheduler.test.mjs": BASELINE_TEST,
	},
	oraclePatchFiles: {
		"src/graph.mjs": GRAPH_ORACLE,
		"src/backoff.mjs": BACKOFF_ORACLE,
		"src/store.mjs": STORE_ORACLE,
		"src/scheduler.mjs": SCHEDULER_ORACLE,
	},
	prompt: [
		"You are working in the `swe-02-dag-scheduler` repository.",
		"Inspect `src/graph.mjs`, `src/backoff.mjs`, `src/store.mjs`, `src/scheduler.mjs`, and `test/scheduler.test.mjs`.",
		"",
		"Requirements:",
		"1. Do NOT modify `test/scheduler.test.mjs`.",
		"2. Fix all 4 modules so the scheduler satisfies:",
		"   - `topoOrder(nodes)` (`src/graph.mjs`): support diamond DAGs without false cycle errors; only throw on real directed cycles or unknown dependencies.",
		"   - `runDag` (`src/scheduler.mjs`): validate the graph BEFORE mutating `store` so cycles/unknown deps leave `store` unchanged; wait for ALL `deps` to reach `'completed'` (not just one); enforce `maxConcurrency`; when a dependency reaches `'failed'` or `'blocked_failed'`, mark pending downstream dependents `'blocked_failed'` instead of hanging.",
		"   - `computeBackoffDelay` (`src/backoff.mjs`): first retry (`attempt = 1`) uses `baseDelayMs` (`baseDelayMs * 2^(attempt - 1)`), clamped to `[0, maxDelayMs]` after applying jitter (`+- jitterRatio`, using `randomFn`).",
		"   - `MemoryStateStore` (`src/store.mjs`): return defensive clones in `getAll()` and `setStatus()` so mutating caller objects cannot corrupt internal state.",
		"3. Confirm `node --test test/scheduler.test.mjs` passes cleanly.",
	].join("\n"),
	async evaluate(sandboxDir: string): Promise<TaskEvalResult> {
		const checks: EvalCheckResult[] = [];
		const forbiddenTouches: string[] = [];

		for (const rel of sweDagSchedulerTask.protectedPaths ?? []) {
			const expected = sweDagSchedulerTask.fixtureFiles[rel];
			const actual = existsSync(join(sandboxDir, rel)) ? readFileSync(join(sandboxDir, rel), "utf8") : null;
			const ok = actual === expected;
			if (!ok) forbiddenTouches.push(rel);
			checks.push({ name: `protected:${rel}`, kind: "hygiene", passed: ok });
		}

		// PASS_TO_PASS
		const passRes = await runIsolatedNodeCommand({
			cwd: sandboxDir,
			args: ["--test", "test/scheduler.test.mjs"],
			timeoutMs: 15_000,
		});
		checks.push({
			name: "pass_to_pass:linear_chain",
			kind: "pass_to_pass",
			passed: passRes.passed,
			detail: passRes.detail,
		});

		// FAIL_TO_PASS 1: diamond DAG, all-deps gating, concurrency limit, defensive store cloning
		const diamondRes = await runIsolatedNodeModuleCheck({
			sandboxDir,
			timeoutMs: 15_000,
			scriptBody: `
				const { topoOrder } = await import(pathToFileURL(join(sandboxDir, "src/graph.mjs")).href);
				const { MemoryStateStore } = await import(pathToFileURL(join(sandboxDir, "src/store.mjs")).href);
				const { runDag } = await import(pathToFileURL(join(sandboxDir, "src/scheduler.mjs")).href);
				const { computeBackoffDelay } = await import(pathToFileURL(join(sandboxDir, "src/backoff.mjs")).href);

				const diamondOrder = topoOrder([
					{ id: "D", deps: ["B", "C"] },
					{ id: "B", deps: ["A"] },
					{ id: "C", deps: ["A"] },
					{ id: "A", deps: [] },
				]);
				assert.equal(diamondOrder[0], "A");
				assert.equal(diamondOrder[diamondOrder.length - 1], "D");

				assert.equal(
					computeBackoffDelay({ attempt: 1, baseDelayMs: 100, maxDelayMs: 500, jitterRatio: 0.2, randomFn: () => 0.5 }),
					100,
				);
				const hi = computeBackoffDelay({ attempt: 10, baseDelayMs: 100, maxDelayMs: 500, jitterRatio: 0.2, randomFn: () => 1 });
				assert.ok(hi <= 500 && hi >= 0, "backoff must be clamped by maxDelayMs");

				const store = new MemoryStateStore();
				const finished = [];
				let active = 0;
				let maxObserved = 0;

				const res = await runDag({
					tasks: [
						{ id: "A", deps: [] },
						{ id: "B", deps: ["A"] },
						{ id: "C", deps: ["A"] },
						{ id: "D", deps: ["B", "C"] },
					],
					executor: async (t) => {
						active += 1;
						maxObserved = Math.max(maxObserved, active);
						await new Promise((r) => setTimeout(r, t.id === "C" ? 25 : 5));
						active -= 1;
						finished.push(t.id);
						return t.id;
					},
					store,
					maxConcurrency: 2,
					sleepFn: async () => {},
				});

				assert.ok(maxObserved <= 2, \`concurrency exceeded maxConcurrency=2 (\${maxObserved})\`);
				assert.equal(res.D.status, "completed");
				assert.ok(finished.indexOf("D") > finished.indexOf("B"), "D must finish after B");
				assert.ok(finished.indexOf("D") > finished.indexOf("C"), "D must finish after C");

				res.D.status = "hacked";
				assert.equal(store.getAll().D.status, "completed");
			`,
		});
		checks.push({
			name: "fail_to_pass:diamond_backoff_store",
			kind: "fail_to_pass",
			passed: diamondRes.passed,
			detail: diamondRes.detail,
		});

		// FAIL_TO_PASS 2: upstream failure cascades to blocked_failed without hang + cycle keeps store untouched
		const failureRes = await runIsolatedNodeModuleCheck({
			sandboxDir,
			timeoutMs: 15_000,
			scriptBody: `
				const { MemoryStateStore } = await import(pathToFileURL(join(sandboxDir, "src/store.mjs")).href);
				const { runDag } = await import(pathToFileURL(join(sandboxDir, "src/scheduler.mjs")).href);

				const cycleStore = new MemoryStateStore();
				await assert.rejects(
					() =>
						runDag({
							tasks: [
								{ id: "X", deps: ["Y"] },
								{ id: "Y", deps: ["X"] },
							],
							executor: async () => "never",
							store: cycleStore,
							sleepFn: async () => {},
						}),
					/Cycle/i,
				);
				assert.deepEqual(cycleStore.getAll(), {}, "Cycle detection must happen before store mutation");

				const failStore = new MemoryStateStore();
				const delays = [];
				const res = await runDag({
					tasks: [
						{ id: "root", deps: [] },
						{ id: "bad", deps: ["root"] },
						{ id: "good", deps: ["root"] },
						{ id: "join", deps: ["bad", "good"] },
					],
					executor: async (t) => {
						if (t.id === "bad") throw new Error("boom");
						return "ok";
					},
					store: failStore,
					maxRetries: 2,
					baseDelayMs: 5,
					sleepFn: async (ms) => {
						delays.push(ms);
					},
				});

				assert.equal(res.root.status, "completed");
				assert.equal(res.good.status, "completed");
				assert.equal(res.bad.status, "failed");
				assert.equal(res.bad.attempts, 3, "initial + 2 retries = 3 attempts");
				assert.equal(res.join.status, "blocked_failed", "downstream task must become blocked_failed instead of hanging");
				assert.equal(delays.length, 2);
			`,
		});
		checks.push({
			name: "fail_to_pass:cycle_atomicity_and_failure_cascade",
			kind: "fail_to_pass",
			passed: failureRes.passed,
			detail: failureRes.detail,
		});

		const failChecks = checks.filter((c) => c.kind === "fail_to_pass");
		const passChecks = checks.filter((c) => c.kind === "pass_to_pass");
		const failPassed = failChecks.filter((c) => c.passed).length;
		const passPassed = passChecks.filter((c) => c.passed).length;
		const broken = passChecks.length - passPassed;
		const hygiene = forbiddenTouches.length === 0;

		return {
			resolved: failPassed === failChecks.length && hygiene,
			failToPassPassed: failPassed,
			failToPassTotal: failChecks.length,
			regressionsClean: broken === 0 && hygiene,
			passToPassPassed: passPassed,
			passToPassTotal: passChecks.length,
			brokenPreExistingCount: broken,
			forbiddenTouches,
			checks,
		};
	},
};

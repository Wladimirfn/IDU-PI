/**
 * cli-runtelegram-config-not-required.test.ts — regression test for the
 * pre-existing bug in `runCliCommand`'s local runtime construction.
 *
 * BUG (pre-PR-7a): `runCliCommand(args)` builds the runtime locally via
 * `runtime ?? createCliRuntime({ createRegistryIfMissing: command !== "status" })`.
 * `createCliRuntime` defaults `requireTelegramConfig: true` (line 1086).
 * `loadConfig({ requireTelegram: true })` requires `TELEGRAM_BOT_TOKEN`
 * (and `ALLOWED_USER_ID`). When the env vars are absent, `loadConfig`
 * throws, the dispatcher's try/catch catches it, and returns
 * `fail(error.message)` — the dispatcher never reaches the switch, so
 * EVERY CLI command returns the help text plus a stderr message about
 * missing telegram env vars. The `default:` case never fires.
 *
 * FIX (this PR): `runCliCommand` passes `requireTelegramConfig: false`
 * to `createCliRuntime` (mirroring `runBootstrapIduCommand` line 3429
 * which already does this).
 *
 * REGRESSION TEST: this test calls `runCliCommand(["idu-role-engine"])`
 * with a temporary `DEFAULT_CWD` and NO telegram env vars. Without the
 * fix, the call throws "Missing required env var: TELEGRAM_BOT_TOKEN".
 * With the fix, the call returns the role-engine status output.
 *
 * RED: Without the fix, this test fails (stdout contains the error,
 * not the role-engine status).
 * GREEN: With the fix, the test passes.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runCliCommand } from "../src/cli.js";

test(
	"runCliCommand does not require TELEGRAM_BOT_TOKEN (regression: pre-existing bug)",
	async () => {
		// Create a tempdir with a registered project so that
		// createCliRuntime() doesn't throw "No hay proyecto activo"
		// before reaching the switch. The registry must contain an
		// active project pointing to the tempdir itself.
		const tmpDir = mkdtempSync(join(tmpdir(), "cli-fix-runtelegram-"));
		try {
			const registryDir = join(tmpDir, ".idu");
			mkdirSync(registryDir, { recursive: true });
			const registryPath = join(registryDir, "registry.json");
			// Create minimal registry with one active project pointing
			// at the tempdir.
			writeFileSync(
				registryPath,
				JSON.stringify(
					{
						activeProjectId: "default",
						projects: [
							{
								id: "default",
								name: "default",
								path: tmpDir,
								lastSessionFile: null,
							},
						],
					},
					null,
					2,
				),
			);

			// Set up env: DEFAULT_CWD points to tempdir; ALLOWED_ROOTS
			// allows the tempdir; IDU_PI_REGISTRY_PATH points to our
			// pre-built registry. NO telegram env vars.
			const previousEnv = {
				DEFAULT_CWD: process.env.DEFAULT_CWD,
				ALLOWED_ROOTS: process.env.ALLOWED_ROOTS,
				IDU_PI_REGISTRY_PATH: process.env.IDU_PI_REGISTRY_PATH,
				TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
				ALLOWED_USER_ID: process.env.ALLOWED_USER_ID,
				REQUIRE_TELEGRAM_CONFIG: process.env.REQUIRE_TELEGRAM_CONFIG,
			};
			process.env.DEFAULT_CWD = tmpDir;
			process.env.ALLOWED_ROOTS = tmpDir;
			process.env.IDU_PI_REGISTRY_PATH = registryPath;
			delete process.env.TELEGRAM_BOT_TOKEN;
			delete process.env.ALLOWED_USER_ID;
			delete process.env.REQUIRE_TELEGRAM_CONFIG;
			try {
				const result = await runCliCommand(["idu-role-engine"]);

				// Core assertion: stdout + stderr must NOT contain the
				// telegram-env-var error. Without the fix, the dispatcher
				// throws on createCliRuntime → loadConfig before the
				// switch even runs.
				assert.doesNotMatch(
					result.stdout,
					/Missing required env var/u,
					`stdout contains the regression error: ${JSON.stringify(result.stdout)}`,
				);
				assert.doesNotMatch(
					result.stderr,
					/Missing required env var/u,
					`stderr contains the regression error: ${JSON.stringify(result.stderr)}`,
				);
				assert.doesNotMatch(
					result.stdout,
					/TELEGRAM_BOT_TOKEN/u,
					`stdout references TELEGRAM_BOT_TOKEN: ${JSON.stringify(result.stdout)}`,
				);
				assert.doesNotMatch(
					result.stderr,
					/TELEGRAM_BOT_TOKEN/u,
					`stderr references TELEGRAM_BOT_TOKEN: ${JSON.stringify(result.stderr)}`,
				);
				assert.doesNotMatch(
					result.stdout,
					/ALLOWED_USER_ID/u,
					`stdout references ALLOWED_USER_ID: ${JSON.stringify(result.stdout)}`,
				);
				assert.doesNotMatch(
					result.stderr,
					/ALLOWED_USER_ID/u,
					`stderr references ALLOWED_USER_ID: ${JSON.stringify(result.stderr)}`,
				);

				// Positive assertion: stdout is either the role-engine
				// status (when there's a registered project) or some
				// unrelated message about a missing project. The key is
				// that we DID reach the switch (i.e., the dispatcher
				// didn't bail out early with the telegram-env error).
				//
				// Strong positive: assert that stdout starts with
				// "Role Engine Status:" — this is the canonical header
				// emitted by `formatRoleEngineStatus`. If we reach
				// the case (after the fix), this header MUST be present.
				// If the dispatcher still throws (regression), it
				// won't be. This makes the test catch future
				// regressions where some other code path bails out
				// before reaching the case.
				assert.match(
					result.stdout,
					/Role Engine Status:/u,
					`Dispatcher did not reach the role-engine case ` +
						`(regression): stdout=${JSON.stringify(result.stdout.slice(0, 300))}`,
				);

				// Additionally, verify that the dispatcher did NOT
				// hit the default case ("Comando desconocido") for our
				// command. The role-engine case should match (or some
				// other pre-switch logic should produce a clear message).
				if (/Comando desconocido/u.test(result.stderr)) {
					throw new Error(
						`Dispatcher hit default-case for idu-role-engine (regression): ` +
							`stdout=${JSON.stringify(result.stdout.slice(0, 200))} ` +
							`stderr=${JSON.stringify(result.stderr.slice(0, 200))}`,
					);
				}
			} finally {
				// Restore env.
				for (const [k, v] of Object.entries(previousEnv)) {
					if (v === undefined) delete process.env[k];
					else process.env[k] = v;
				}
			}
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	},
);
/**
 * install-deploy-verify.test.ts — static checks (issue #487).
 *
 * install-deploy-tick.ps1 and update-deploy-tick.ps1 must run the deploy
 * verification BEFORE printing "ready"/"updated", and stop hard (non-zero
 * exit) when the deployed CLI cannot boot its config. A green message for
 * a compile that fails on boot — the "install without .env -> GREEN"
 * failure mode — is the exact bug this issue removes.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const INSTALL_PATH = resolve("scripts/install-deploy-tick.ps1");
const UPDATE_PATH = resolve("scripts/update-deploy-tick.ps1");

test("install and update run verify-deploy BEFORE printing success (issue #487)", () => {
	for (const [path, successMessage] of [
		[INSTALL_PATH, "Deployment directory ready"],
		[UPDATE_PATH, "Deployment directory updated"],
	] as const) {
		assert.ok(
			existsSync(path),
			`expected ${path} to exist for the static check`,
		);
		const source = readFileSync(path, "utf8");
		const verifyIndex = source.indexOf("verify-deploy.ps1");
		const successIndex = source.indexOf(successMessage);
		assert.ok(
			verifyIndex !== -1,
			`regression: ${path} must invoke the deployed verification script. Source: ${source}`,
		);
		assert.ok(
			successIndex !== -1,
			`test setup error: success message not found in ${path}`,
		);
		assert.ok(
			verifyIndex < successIndex,
			`regression: ${path} must run verify-deploy.ps1 BEFORE printing "${successMessage}" — a green message for a compile that cannot boot is the bug. Source: ${source}`,
		);
	}
});

test("install and update stop hard when verification fails", () => {
	for (const path of [INSTALL_PATH, UPDATE_PATH]) {
		const source = readFileSync(path, "utf8");
		assert.match(
			source,
			/\$LASTEXITCODE\s*-\s*ne\s*0/u,
			`regression: ${path} must check the verification exit code. Source: ${source}`,
		);
		assert.match(
			source,
			/\bexit\s+\$LASTEXITCODE/u,
			`regression: ${path} must exit non-zero on verification failure (stop hard). Source: ${source}`,
		);
	}
});
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	formatBridgeEnvStatus,
	maskSecret,
	readEnvDraft,
	validateBridgeEnvDraft,
	writeEnvDraftWithBackup,
} from "../src/env-config.js";

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "idu-env-config-"));
}

test("env draft preserves unknown keys and creates backup when writing", () => {
	const root = tempDir();
	try {
		const envPath = join(root, ".env");
		const tokenKey = `TELEGRAM_BOT_${"TOKEN"}`;
		writeFileSync(
			envPath,
			[
				`${tokenKey}=old-token`,
				"ALLOWED_USER_ID=123",
				"CUSTOM_KEEP=yes",
				"",
			].join("\n"),
			"utf8",
		);
		const draft = readEnvDraft(envPath);
		draft.values[tokenKey] = "new-secret-token";
		draft.values.ALLOWED_USER_ID = "456";
		const result = writeEnvDraftWithBackup(envPath, draft, {
			[tokenKey]: draft.values[tokenKey],
			ALLOWED_USER_ID: draft.values.ALLOWED_USER_ID,
		});

		const written = readFileSync(envPath, "utf8");
		assert.match(written, new RegExp(`${tokenKey}=new-secret-token`, "u"));
		assert.match(written, /ALLOWED_USER_ID=456/u);
		assert.match(written, /CUSTOM_KEEP=yes/u);
		assert.ok(result.backupPath);
		assert.match(readFileSync(result.backupPath ?? "", "utf8"), /old-token/u);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("env helpers mask token and validate required values", () => {
	assert.equal(maskSecret("abcdef123456"), "abcd****3456");
	assert.equal(maskSecret(""), "(missing)");
	const tokenKey = `TELEGRAM_BOT_${"TOKEN"}`;
	assert.deepEqual(
		validateBridgeEnvDraft({
			[tokenKey]: "abc",
			ALLOWED_USER_ID: "42",
		}),
		[],
	);
	assert.deepEqual(
		validateBridgeEnvDraft({ [tokenKey]: "", ALLOWED_USER_ID: "x" }),
		[`${tokenKey} requerido`, "ALLOWED_USER_ID debe ser entero positivo"],
	);
});

test("bridge env status never prints full token", () => {
	const tokenKey = `TELEGRAM_BOT_${"TOKEN"}`;
	const text = formatBridgeEnvStatus({
		envPath: "C:/repo/.env",
		exists: true,
		values: {
			[tokenKey]: "super-secret-token",
			ALLOWED_USER_ID: "123",
		},
		packageRoot: "C:/repo",
		startScriptExists: true,
		stopScriptExists: true,
		logPath: "C:/repo/logs/bridge.log",
		logExists: false,
	});
	assert.doesNotMatch(text, /super-secret-token/u);
	assert.match(text, /supe\*+oken/u);
	assert.match(text, /ALLOWED_USER_ID: presente/u);
});

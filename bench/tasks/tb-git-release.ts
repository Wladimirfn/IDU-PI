import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BenchmarkTaskDef, EvalCheckResult, TaskEvalResult } from "../types.js";
import { runIsolatedNodeCommand, runIsolatedNodeModuleCheck } from "./eval-subprocess.js";

function sha256Text(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

const DOT_ENV = [
	"# Base deployment config",
	"APP_PORT=3000",
	'DB_URL="postgresql://user:pass@localhost:5432/app?sslmode=disable#main"',
	"API_ENDPOINT=https://api.example.com/v1?mode=live&retry=2 # inline comment",
	"FEATURE_FLAG=false",
	"",
].join("\n");

const DOT_ENV_LOCAL = [
	"APP_PORT=4100",
	"FEATURE_FLAG=true",
	"",
].join("\r\n");

const BUGGY_CONFIG_MJS = `import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function parseEnvContent(text) {
  const out = {};
  for (const raw of text.split("\\n")) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    out[key] = val;
  }
  return out;
}

/**
 * Resolves effective config.
 * Precedence requirement (highest -> lowest):
 * cliFlags > processEnv > .env.local > .env > defaults
 */
export function resolveConfig({ cwd, processEnv = {}, cliFlags = {} }) {
  const defaults = {
    APP_PORT: "8080",
    DB_URL: "sqlite://memory",
    API_ENDPOINT: "http://localhost:3000",
    FEATURE_FLAG: "false",
  };
  const baseEnv = existsSync(join(cwd, ".env")) ? parseEnvContent(readFileSync(join(cwd, ".env"), "utf8")) : {};
  const localEnv = existsSync(join(cwd, ".env.local")) ? parseEnvContent(readFileSync(join(cwd, ".env.local"), "utf8")) : {};

  // Bug: precedence reversed! .env overwrites processEnv and cliFlags
  return {
    ...defaults,
    ...cliFlags,
    ...processEnv,
    ...localEnv,
    ...baseEnv,
  };
}
`;

const VERIFY_RELEASE_MJS = `import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function buildChecksums(cwd) {
  const srcDir = join(cwd, "src");
  const files = readdirSync(srcDir).filter((f) => f.endsWith(".mjs")).sort((a, b) => a.localeCompare(b));
  const checksums = {};
  for (const f of files) {
    const content = readFileSync(join(srcDir, f), "utf8");
    checksums["src/" + f] = createHash("sha256").update(content, "utf8").digest("hex");
  }
  return checksums;
}

const cwd = process.cwd();
const manifestPath = join(cwd, "build", "manifest.json");
const checksums = buildChecksums(cwd);

if (process.argv.includes("--write")) {
  mkdirSync(join(cwd, "build"), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify({ algorithm: "sha256", files: checksums }, null, 2) + "\\n", "utf8");
  console.log("WROTE manifest");
  process.exit(0);
}

const current = JSON.parse(readFileSync(manifestPath, "utf8"));
const expectedKeys = Object.keys(checksums);
const actualKeys = Object.keys(current.files || {}).sort((a, b) => a.localeCompare(b));
if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
  console.error("Manifest file list mismatch");
  process.exit(1);
}
for (const k of expectedKeys) {
  if (current.files[k] !== checksums[k]) {
    console.error("Checksum mismatch for", k);
    process.exit(1);
  }
}
console.log("MANIFEST_OK");
`;

const SMOKE_TEST_MJS = `import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../src/config.mjs";

test("resolveConfig falls back to defaults in an empty workspace", () => {
  const dir = mkdtempSync(join(tmpdir(), "tb-git-smoke-"));
  try {
    const cfg = resolveConfig({ cwd: dir, processEnv: {}, cliFlags: {} });
    assert.equal(cfg.APP_PORT, "8080");
    assert.equal(cfg.FEATURE_FLAG, "false");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
`;

const ORACLE_CONFIG_MJS = `import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function stripInlineComment(rawVal) {
  let out = "";
  for (let i = 0; i < rawVal.length; i++) {
    const ch = rawVal[i];
    if (ch === "#" && (i === 0 || /\\s/.test(rawVal[i - 1]))) {
      break;
    }
    out += ch;
  }
  return out.trim();
}

export function parseEnvContent(text) {
  const out = {};
  const clean = text.replace(/^\\uFEFF/, "").replace(/\\r\\n?/g, "\\n");
  for (const raw of clean.split("\\n")) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    let rest = trimmed.slice(eq + 1).trim();
    if ((rest.startsWith('"') && rest.includes('"', 1)) || (rest.startsWith("'") && rest.includes("'", 1))) {
      const quote = rest[0];
      const endIdx = rest.indexOf(quote, 1);
      out[key] = rest.slice(1, endIdx);
    } else {
      out[key] = stripInlineComment(rest);
    }
  }
  return out;
}

/**
 * Precedence order (highest -> lowest):
 * cliFlags > processEnv > .env.local > .env > defaults
 */
export function resolveConfig({ cwd, processEnv = {}, cliFlags = {} }) {
  const defaults = {
    APP_PORT: "8080",
    DB_URL: "sqlite://memory",
    API_ENDPOINT: "http://localhost:3000",
    FEATURE_FLAG: "false",
  };
  const baseEnv = existsSync(join(cwd, ".env")) ? parseEnvContent(readFileSync(join(cwd, ".env"), "utf8")) : {};
  const localEnv = existsSync(join(cwd, ".env.local")) ? parseEnvContent(readFileSync(join(cwd, ".env.local"), "utf8")) : {};

  const definedOnly = (obj) => {
    const cleaned = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined && v !== null) cleaned[k] = String(v);
    }
    return cleaned;
  };

  return {
    ...defaults,
    ...baseEnv,
    ...localEnv,
    ...definedOnly(processEnv),
    ...definedOnly(cliFlags),
  };
}
`;

export const tbGitReleaseTask: BenchmarkTaskDef = {
	id: "tb-02-git-release",
	category: "terminal-bench",
	title: "Config Precedence & Release Checksum Repair",
	description:
		"Fix env parser quoting/comment/CRLF bugs and reversed precedence in src/config.mjs, regenerate build/manifest.json checksums, and verify via CLI.",
	timeoutMs: 180_000,
	protectedPaths: [".env", ".env.local", "scripts/verify-release.mjs", "test/smoke.test.mjs"],
	fixtureFiles: {
		"package.json": JSON.stringify(
			{
				name: "tb-git-release",
				type: "module",
				private: true,
				scripts: {
					test: "node --test test/smoke.test.mjs",
					"verify:release": "node scripts/verify-release.mjs --check",
				},
			},
			null,
			2,
		) + "\n",
		".env": DOT_ENV,
		".env.local": DOT_ENV_LOCAL,
		"src/config.mjs": BUGGY_CONFIG_MJS,
		"scripts/verify-release.mjs": VERIFY_RELEASE_MJS,
		"build/manifest.json":
			JSON.stringify(
				{
					algorithm: "sha256",
					files: { "src/config.mjs": "0000000000000000000000000000000000000000000000000000000000000000" },
				},
				null,
				2,
			) + "\n",
		"test/smoke.test.mjs": SMOKE_TEST_MJS,
	},
	oraclePatchFiles: {
		"src/config.mjs": ORACLE_CONFIG_MJS,
		"build/manifest.json":
			JSON.stringify(
				{
					algorithm: "sha256",
					files: { "src/config.mjs": sha256Text(ORACLE_CONFIG_MJS) },
				},
				null,
				2,
			) + "\n",
	},
	prompt: [
		"You are working in the `tb-git-release` repository.",
		"Inspect `src/config.mjs`, `.env`, `.env.local`, `scripts/verify-release.mjs`, `build/manifest.json`, and `test/smoke.test.mjs`.",
		"",
		"Requirements:",
		"1. Do NOT modify `.env`, `.env.local`, `scripts/verify-release.mjs`, or `test/smoke.test.mjs`.",
		"2. Fix `parseEnvContent(text)` and `resolveConfig({ cwd, processEnv, cliFlags })` in `src/config.mjs`:",
		"   - Handle UTF-8 BOM, CRLF/LF line endings, `=` signs inside values (e.g. query params or URLs).",
		'   - Preserve `#` inside quoted values (`"..."` or `\'...\'`) while stripping quotes and unquoted `#` inline comments (`VALUE # comment`).',
		"   - Enforce precedence (highest -> lowest): `cliFlags > processEnv > .env.local > .env > defaults`.",
		"   - Ignore `undefined`/`null` values in `processEnv` and `cliFlags` so they do not overwrite lower-precedence settings.",
		"3. After updating `src/config.mjs`, update `build/manifest.json` by running `node scripts/verify-release.mjs --write` and confirm `node scripts/verify-release.mjs --check` exits 0.",
		"4. Run `node --test test/smoke.test.mjs` and confirm it passes.",
	].join("\n"),
	async evaluate(sandboxDir: string): Promise<TaskEvalResult> {
		const checks: EvalCheckResult[] = [];
		const forbiddenTouches: string[] = [];

		for (const rel of tbGitReleaseTask.protectedPaths ?? []) {
			const expected = tbGitReleaseTask.fixtureFiles[rel];
			const actual = existsSync(join(sandboxDir, rel)) ? readFileSync(join(sandboxDir, rel), "utf8") : null;
			const ok = actual === expected;
			if (!ok) forbiddenTouches.push(rel);
			checks.push({
				name: `protected:${rel}`,
				kind: "hygiene",
				passed: ok,
				detail: ok ? undefined : "Protected config/script/test file was modified",
			});
		}

		// PASS_TO_PASS
		const passRes = await runIsolatedNodeCommand({
			cwd: sandboxDir,
			args: ["--test", "test/smoke.test.mjs"],
			timeoutMs: 15_000,
		});
		checks.push({
			name: "pass_to_pass:smoke_test",
			kind: "pass_to_pass",
			passed: passRes.passed,
			detail: passRes.detail,
		});

		// FAIL_TO_PASS (1): verify-release --check exits 0
		const manifestRun = await runIsolatedNodeCommand({
			cwd: sandboxDir,
			args: ["scripts/verify-release.mjs", "--check"],
			timeoutMs: 15_000,
		});
		const manifestOk = manifestRun.passed && /MANIFEST_OK/.test(manifestRun.stdout);
		const manifestDetail = manifestOk
			? undefined
			: manifestRun.detail || `Expected MANIFEST_OK in output, got: ${manifestRun.stdout.trim()}`;
		checks.push({
			name: "fail_to_pass:release_manifest_checksum",
			kind: "fail_to_pass",
			passed: manifestOk,
			detail: manifestDetail,
		});

		// FAIL_TO_PASS (2): hidden runtime tests against sandbox src/config.mjs
		const configRes = await runIsolatedNodeModuleCheck({
			sandboxDir,
			timeoutMs: 15_000,
			scriptBody: `
				const modUrl = pathToFileURL(join(sandboxDir, "src/config.mjs")).href;
				const { resolveConfig, parseEnvContent } = await import(modUrl);

				const resolved = resolveConfig({
					cwd: sandboxDir,
					processEnv: { APP_PORT: "5500", FEATURE_FLAG: undefined },
					cliFlags: { APP_PORT: "9090" },
				});
				assert.equal(resolved.APP_PORT, "9090", "cliFlags must beat processEnv and .env.local");
				assert.equal(resolved.FEATURE_FLAG, "true", ".env.local must beat .env and ignore undefined processEnv");
				assert.equal(
					resolved.DB_URL,
					"postgresql://user:pass@localhost:5432/app?sslmode=disable#main",
					"quoted # must be preserved and quotes stripped",
				);
				assert.equal(
					resolved.API_ENDPOINT,
					"https://api.example.com/v1?mode=live&retry=2",
					"= in values preserved and inline # comment stripped",
				);

				const adv = parseEnvContent("\\uFEFFKEY_A='hello # world'\\r\\nKEY_B=val=1&x=2 # note\\r\\n");
				assert.equal(adv.KEY_A, "hello # world");
				assert.equal(adv.KEY_B, "val=1&x=2");

				const tmp = mkdtempSync(join(tmpdir(), "tb-release-eval-"));
				try {
					writeFileSync(join(tmp, ".env"), "APP_PORT=7000\\n", "utf8");
					const isolated = resolveConfig({
						cwd: tmp,
						processEnv: { APP_PORT: "7500" },
						cliFlags: { DB_URL: undefined },
					});
					assert.equal(isolated.APP_PORT, "7500", "processEnv must beat .env");
					assert.equal(isolated.DB_URL, "sqlite://memory", "undefined cliFlag must not clobber default");
				} finally {
					rmSync(tmp, { recursive: true, force: true });
				}
			`,
		});
		checks.push({
			name: "fail_to_pass:config_precedence_and_quoting",
			kind: "fail_to_pass",
			passed: configRes.passed,
			detail: configRes.detail,
		});

		const failToPassChecks = checks.filter((c) => c.kind === "fail_to_pass");
		const passToPassChecks = checks.filter((c) => c.kind === "pass_to_pass");
		const failToPassPassed = failToPassChecks.filter((c) => c.passed).length;
		const passToPassPassed = passToPassChecks.filter((c) => c.passed).length;
		const brokenPreExistingCount = passToPassChecks.length - passToPassPassed;
		const hygieneClean = forbiddenTouches.length === 0;

		return {
			resolved: failToPassPassed === failToPassChecks.length && hygieneClean,
			failToPassPassed,
			failToPassTotal: failToPassChecks.length,
			regressionsClean: brokenPreExistingCount === 0 && hygieneClean,
			passToPassPassed,
			passToPassTotal: passToPassChecks.length,
			brokenPreExistingCount,
			forbiddenTouches,
			checks,
		};
	},
};

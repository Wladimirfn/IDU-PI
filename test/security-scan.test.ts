import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
	formatSecurityScanPrompt,
	parseAstGrepJson,
	parseGitleaksJson,
	parseSemgrepJson,
	redactSecretValue,
	runSecurityScan,
	scanFileContent,
	type CommandRunner,
} from "../src/security-scan.js";

// Assemble synthetic credential fixtures dynamically so static secret scanners
// (and push protection) do not flag the test suite itself.
const SYNTH_AWS = "AKIA" + "9876543210QWER78";
const SYNTH_GH = "ghp_" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const SYNTH_PEM = "-----BEGIN " + "RSA PRIVATE KEY-----";
const SYNTH_DB = "postgres://" + "appuser:Sup3rS3cretProdPass@prod-db.internal:5432/app";

test("redactSecretValue hides secret material across formats", () => {
	const awsRedacted = redactSecretValue(SYNTH_AWS);
	assert.equal(awsRedacted, "AKIA****ER78");
	assert.ok(!awsRedacted.includes("9876543210"));

	assert.equal(redactSecretValue(SYNTH_PEM), "[REDACTED_PRIVATE_KEY]");
	assert.equal(redactSecretValue("short"), "[REDACTED]");

	const dbRedacted = redactSecretValue(SYNTH_DB);
	assert.equal(dbRedacted, "postgres://appuser:[REDACTED]@prod-db.internal:5432/app");
	assert.ok(!dbRedacted.includes("Sup3rS3cretProdPass"));
});

test("scanFileContent detects secrets and never leaks raw values", () => {
	const sample = [
		`const awsKey = "${SYNTH_AWS}";`,
		`const ghToken = "${SYNTH_GH}";`,
		`const pem = "${SYNTH_PEM}";`,
		`const dbUrl = "${SYNTH_DB}";`,
	].join("\n");

	const findings = scanFileContent("src/config.ts", sample);
	assert.equal(findings.length, 4);
	assert.deepEqual(
		findings.map((f) => f.ruleId),
		[
			"secret/aws-access-key",
			"secret/github-token",
			"secret/private-key",
			"secret/db-url-credentials",
		],
	);

	for (const f of findings) {
		assert.equal(f.category, "secret");
		assert.equal(f.severity, "high");
		assert.ok(!f.message.includes(SYNTH_AWS));
		assert.ok(!f.message.includes(SYNTH_GH));
		assert.ok(!f.message.includes("Sup3rS3cretProdPass"));
		assert.ok(!(f.snippet ?? "").includes(SYNTH_AWS));
		assert.ok(!(f.snippet ?? "").includes(SYNTH_GH));
		assert.ok(!(f.snippet ?? "").includes("Sup3rS3cretProdPass"));
	}
});

test("scanFileContent ignores placeholder secrets and inline ignore directives", () => {
	const placeholderAws = "AKIA" + "IOSFODNN7EXAMPLE";
	const sample = [
		`const docKey = "${placeholderAws}";`,
		`const localDb = "postgres://admin:password@localhost:5432/dev";`,
		`const envDb = "postgres://user:\${DB_PASS}@prod.internal/app";`,
		`const suppressed = "${SYNTH_AWS}"; // idu-scan:ignore`,
	].join("\n");

	const findings = scanFileContent("src/example.ts", sample);
	assert.equal(findings.length, 0);
});

test("scanFileContent detects high-signal JS/TS and Python SAST sinks while ignoring safe forms", () => {
	const jsSample = [
		"// comment mentioning eval(userInput) and shell: true",
		'execSync("git status --porcelain");',
		'spawn("git", [arg], { shell: true });',
		"execSync(`rm -rf ${userDir}`);",
		"const fn = new Function('return ' + expr);",
		"const tlsOpts = { rejectUnauthorized: false };",
		'db.query(`SELECT * FROM users WHERE id = ${userId}`);',
		"el.innerHTML = untrustedHtml;",
	].join("\n");

	const jsFindings = scanFileContent("src/handler.ts", jsSample);
	assert.deepEqual(
		jsFindings.map((f) => f.ruleId),
		[
			"sast/shell-true-spawn",
			"sast/js-exec-interpolation",
			"sast/js-dynamic-code",
			"sast/tls-verify-disabled",
			"sast/sql-string-interpolation",
			"sast/dom-xss-sink",
		],
	);

	// Test files skip SAST sinks by default unless includeTests is enabled.
	assert.equal(scanFileContent("test/handler.test.ts", jsSample).length, 0);
	assert.equal(
		scanFileContent("test/handler.test.ts", jsSample, { includeTests: true }).length,
		6,
	);

	const pySample = [
		"import subprocess, yaml, pickle",
		"data = yaml.load(raw, Loader=yaml.SafeLoader)",
		"bad_yaml = yaml.load(raw)",
		"subprocess.run(cmd, shell=True)",
		"obj = pickle.loads(payload)",
	].join("\n");

	const pyFindings = scanFileContent("scripts/job.py", pySample);
	assert.deepEqual(
		pyFindings.map((f) => f.ruleId),
		[
			"sast/py-unsafe-deserialize",
			"sast/py-shell-true",
			"sast/py-unsafe-deserialize",
		],
	);
});

test("external scanner parsers normalize paths, severities, and redact secrets", () => {
	const cwd = resolve(tmpdir(), "scan-root");

	const gitleaksRaw = JSON.stringify([
		{
			File: join(cwd, "src", "auth.ts"),
			StartLine: 12,
			RuleID: "generic-api-key",
			Description: "Generic API Key",
			Secret: SYNTH_GH,
		},
	]);
	const glFindings = parseGitleaksJson(gitleaksRaw, cwd);
	assert.equal(glFindings.length, 1);
	assert.equal(glFindings[0].file, "src/auth.ts");
	assert.equal(glFindings[0].line, 12);
	assert.equal(glFindings[0].tool, "gitleaks");
	assert.ok(!glFindings[0].message.includes(SYNTH_GH));
	assert.ok(glFindings[0].message.includes("ghp_****6789"));

	const semgrepRaw = JSON.stringify({
		results: [
			{
				check_id: "javascript.lang.security.audit.spawn-shell-true",
				path: "src\\runner.ts",
				start: { line: 44 },
				extra: { severity: "ERROR", message: "Avoid shell: true" },
			},
		],
	});
	const sgFindings = parseSemgrepJson(semgrepRaw, cwd);
	assert.equal(sgFindings.length, 1);
	assert.equal(sgFindings[0].file, "src/runner.ts");
	assert.equal(sgFindings[0].severity, "high");
	assert.equal(sgFindings[0].category, "sast");

	const astGrepStream = [
		JSON.stringify({
			file: "src/web.tsx",
			ruleId: "no-inner-html",
			severity: "warning",
			message: "Avoid raw innerHTML assignment",
			range: { start: { line: 9, column: 2 } },
		}),
	].join("\n");
	const agFindings = parseAstGrepJson(astGrepStream, cwd);
	assert.equal(agFindings.length, 1);
	assert.equal(agFindings[0].file, "src/web.tsx");
	assert.equal(agFindings[0].line, 10);
	assert.equal(agFindings[0].severity, "medium");
});

test("runSecurityScan merges external scanners, deduplicates against builtin, and formats bounded prompts", () => {
	const dir = mkdtempSync(join(tmpdir(), "idu-sec-merge-"));
	try {
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(join(dir, "sgconfig.yml"), "ruleDirs: [rules]\n", "utf8");
		writeFileSync(
			join(dir, "src", "app.ts"),
			`const key = "${SYNTH_AWS}";\nspawn("sh", ["-c", x], { shell: true });\n`,
			"utf8",
		);

		const fakeRunner: CommandRunner = (cmd, args) => {
			if (args[0] === "--version") {
				if (cmd === "gitleaks" || cmd === "semgrep" || cmd === "ast-grep") {
					return { status: 0, stdout: "1.0.0\n", stderr: "" };
				}
				return { status: null, stdout: "", stderr: "", errorCode: "ENOENT" };
			}
			if (cmd === "gitleaks") {
				const reportIdx = args.indexOf("--report-path");
				if (reportIdx !== -1) {
					writeFileSync(
						args[reportIdx + 1],
						JSON.stringify([
							{
								File: join(dir, "src", "app.ts"),
								StartLine: 1,
								RuleID: "aws-access-token",
								Description: "AWS Access Token",
								Secret: SYNTH_AWS,
							},
						]),
						"utf8",
					);
				}
				return { status: 1, stdout: "", stderr: "" };
			}
			if (cmd === "semgrep") {
				return {
					status: 0,
					stdout: JSON.stringify({
						results: [
							{
								check_id: "ts.security.spawn-shell",
								path: join(dir, "src", "app.ts"),
								start: { line: 2 },
								extra: { severity: "ERROR", message: "shell: true detected" },
							},
						],
					}),
					stderr: "",
				};
			}
			if (cmd === "ast-grep") {
				return {
					status: 0,
					stdout: JSON.stringify({
						file: "src/app.ts",
						ruleId: "custom-rule",
						severity: "warning",
						message: "Custom AST pattern",
						range: { start: { line: 5 } },
					}),
					stderr: "",
				};
			}
			return { status: 1, stdout: "", stderr: "" };
		};

		const report = runSecurityScan({
			cwd: dir,
			mode: "full",
			externalTools: true,
			commandRunner: fakeRunner,
		});

		// Builtin hits on lines 1 and 2 should be superseded by gitleaks and semgrep.
		assert.equal(report.findings.length, 3);
		assert.equal(report.findings[0].tool, "gitleaks");
		assert.equal(report.findings[1].tool, "semgrep");
		assert.equal(report.findings[2].tool, "ast-grep");
		assert.equal(report.summary.secrets, 1);
		assert.equal(report.summary.sast, 2);
		assert.equal(report.summary.high, 2);
		assert.equal(report.summary.medium, 1);

		const prompt = formatSecurityScanPrompt(report, 2);
		assert.ok(prompt.includes("Deterministic pre-scan (full,"));
		assert.ok(prompt.includes("(+1 more lead(s) omitted;"));
		assert.ok(!prompt.includes(SYNTH_AWS));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("runSecurityScan diff mode scans only modified/untracked files in a git repo", () => {
	const dir = mkdtempSync(join(tmpdir(), "idu-sec-git-"));
	try {
		const git = (args: string[]) =>
			spawnSync("git", args, { cwd: dir, encoding: "utf8", shell: false });
		assert.equal(git(["init"]).status, 0);
		assert.equal(git(["config", "user.email", "test@example.com"]).status, 0);
		assert.equal(git(["config", "user.name", "Test"]).status, 0);

		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(join(dir, "src", "clean.ts"), "export const ok = 1;\n", "utf8");
		writeFileSync(
			join(dir, "src", "old.ts"),
			"export const x = eval('1+1');\n",
			"utf8",
		);
		assert.equal(git(["add", "."]).status, 0);
		assert.equal(git(["commit", "-m", "init"]).status, 0);

		// Add a new untracked file with a sink; old.ts stays committed and untouched.
		writeFileSync(
			join(dir, "src", "new.ts"),
			"export const tls = { rejectUnauthorized: false };\n",
			"utf8",
		);

		const diffReport = runSecurityScan({
			cwd: dir,
			mode: "diff",
			externalTools: false,
		});
		assert.equal(diffReport.mode, "diff");
		assert.equal(diffReport.filesScanned, 1);
		assert.equal(diffReport.findings.length, 1);
		assert.equal(diffReport.findings[0].file, "src/new.ts");
		assert.equal(diffReport.findings[0].ruleId, "sast/tls-verify-disabled");

		assert.throws(
			() => runSecurityScan({ cwd: dir, mode: "diff", baseRef: "--output=pwn", externalTools: false }),
			/Invalid baseRef/,
		);
		assert.throws(
			() => runSecurityScan({ cwd: dir, mode: "full", target: "does-not-exist", externalTools: false }),
			/Scan target does not exist/,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("CLI security-scan outputs valid JSON and honors --fail-on-high exit code", () => {
	const dir = mkdtempSync(join(tmpdir(), "idu-sec-cli-"));
	try {
		writeFileSync(join(dir, "leak.ts"), `export const k = "${SYNTH_AWS}";\n`, "utf8");
		const cliEntry = resolve("dist/src/cli.js");
		const run = spawnSync(
			process.execPath,
			[cliEntry, "security-scan", "--full", "--no-external", "--cwd", dir, "--format", "json", "--fail-on-high"],
			{ encoding: "utf8", shell: false },
		);
		assert.equal(run.status, 2);
		const parsed = JSON.parse(run.stdout);
		assert.equal(parsed.summary.high, 1);
		assert.equal(parsed.summary.secrets, 1);
		assert.ok(!run.stdout.includes(SYNTH_AWS));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

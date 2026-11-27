import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

export type SecuritySeverity = "high" | "medium" | "low";
export type SecurityCategory = "secret" | "sast";
export type ScannerName = "builtin" | "gitleaks" | "semgrep" | "ast-grep";
export type ScanMode = "diff" | "full";

export interface SecurityFinding {
	tool: ScannerName;
	ruleId: string;
	category: SecurityCategory;
	severity: SecuritySeverity;
	file: string;
	line: number;
	message: string;
	snippet?: string;
}

export interface ScannerStatus {
	name: ScannerName;
	available: boolean;
	executed: boolean;
	findingsCount: number;
	note?: string;
}

export interface SecurityScanSummary {
	total: number;
	secrets: number;
	sast: number;
	high: number;
	medium: number;
	low: number;
}

export interface SecurityScanReport {
	cwd: string;
	mode: ScanMode;
	filesScanned: number;
	truncatedFiles: boolean;
	scanners: ScannerStatus[];
	findings: SecurityFinding[];
	summary: SecurityScanSummary;
}

export interface CommandResult {
	status: number | null;
	stdout: string;
	stderr: string;
	errorCode?: string;
}

export type CommandRunner = (
	command: string,
	args: string[],
	options: { cwd: string; timeoutMs: number },
) => CommandResult;

export interface SecurityScanOptions {
	cwd: string;
	mode?: ScanMode;
	baseRef?: string;
	target?: string;
	maxFiles?: number;
	maxFindings?: number;
	externalTools?: boolean;
	includeTests?: boolean;
	commandRunner?: CommandRunner;
}

const DEFAULT_MAX_FILES = 2000;
const DEFAULT_MAX_FINDINGS = 100;
const MAX_FILE_BYTES = 512 * 1024;
const EXTERNAL_TIMEOUT_MS = 45_000;
const PROBE_TIMEOUT_MS = 5_000;

const IGNORED_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	".next",
	".nuxt",
	"coverage",
	"__pycache__",
	".venv",
	"venv",
	".codegraph",
	".idu",
	"vendor",
	"target",
]);

const IGNORED_BASENAMES = new Set([
	"pnpm-lock.yaml",
	"package-lock.json",
	"yarn.lock",
	"bun.lockb",
	"cargo.lock",
	"poetry.lock",
]);

const PLACEHOLDER_TOKENS = [
	"example",
	"placeholder",
	"your_",
	"your-",
	"dummy",
	"fake",
	"changeme",
	"replace_me",
	"replace-me",
	"redacted",
	"xxxx",
	"00000000",
	"11111111",
];

const DB_PLACEHOLDER_PASSWORDS = new Set([
	"pass",
	"password",
	"secret",
	"changeme",
	"example",
	"postgres",
	"mysql",
	"mongodb",
	"redis",
	"root",
	"admin",
	"123456",
	"12345678",
	"testpass",
]);

const DB_LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "example.com", "db"]);

interface BuiltinSecretRule {
	ruleId: string;
	severity: SecuritySeverity;
	message: string;
	pattern: RegExp;
	isDbUrl?: boolean;
}

interface BuiltinSastRule {
	ruleId: string;
	severity: SecuritySeverity;
	message: string;
	extensions: Set<string>;
	pattern: RegExp;
	extraCheck?: (line: string) => boolean;
}

const JS_TS_EXTS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx"]);
const PY_EXTS = new Set([".py"]);
const WEB_EXTS = new Set([".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx", ".html", ".htm"]);
const TLS_EXTS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx", ".py", ".sh", ".ps1"]);
const SQL_CALL_EXTS = new Set([".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".py"]);

const BUILTIN_SECRET_RULES: BuiltinSecretRule[] = [
	{
		ruleId: "secret/aws-access-key",
		severity: "high",
		message: "Potential AWS access key ID",
		pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
	},
	{
		ruleId: "secret/github-token",
		severity: "high",
		message: "Potential GitHub personal or OAuth access token",
		pattern: /\b(?:ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|ghu_[A-Za-z0-9]{36}|ghs_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,82})\b/g,
	},
	{
		ruleId: "secret/private-key",
		severity: "high",
		message: "Private key block header detected",
		pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
	},
	{
		ruleId: "secret/ai-api-key",
		severity: "high",
		message: "Potential OpenAI or Anthropic API key",
		pattern: /\b(?:sk-ant-api03-[A-Za-z0-9_-]{20,120}|sk-proj-[A-Za-z0-9_-]{20,160}|sk-[A-Za-z0-9]{32,64})\b/g,
	},
	{
		ruleId: "secret/google-api-key",
		severity: "high",
		message: "Potential Google API key",
		pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
	},
	{
		ruleId: "secret/slack-token",
		severity: "high",
		message: "Potential Slack API token",
		pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,64}\b/g,
	},
	{
		ruleId: "secret/stripe-live-key",
		severity: "high",
		message: "Potential Stripe live secret or restricted key",
		pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,64}\b/g,
	},
	{
		ruleId: "secret/db-url-credentials",
		severity: "high",
		message: "Connection string with embedded credentials",
		pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/([^/\s:@'"]+):([^/\s@'"]{6,128})@([^\s'"`]+)/g,
		isDbUrl: true,
	},
];

const BUILTIN_SAST_RULES: BuiltinSastRule[] = [
	{
		ruleId: "sast/shell-true-spawn",
		severity: "high",
		message: "Child process invocation with shell: true (command injection risk if arguments are untrusted)",
		extensions: JS_TS_EXTS,
		pattern: /\b(?:spawn|spawnSync|execFile|execFileSync)\s*\([^;\n]{0,200}\bshell\s*:\s*true\b/,
	},
	{
		ruleId: "sast/js-exec-interpolation",
		severity: "high",
		message: "exec/execSync called with interpolated or concatenated command string",
		extensions: JS_TS_EXTS,
		pattern: /\b(?:exec|execSync)\s*\(\s*(?:`[^`\n]{0,200}\$\{|['"][^'"\n]{0,120}['"]\s*\+)/,
	},
	{
		ruleId: "sast/js-dynamic-code",
		severity: "high",
		message: "Dynamic code execution sink (eval / new Function)",
		extensions: JS_TS_EXTS,
		pattern: /\b(?:eval\s*\(|new\s+Function\s*\()/,
	},
	{
		ruleId: "sast/tls-verify-disabled",
		severity: "high",
		message: "TLS certificate verification disabled",
		extensions: TLS_EXTS,
		pattern: /NODE_TLS_REJECT_UNAUTHORIZED\s*[:=]\s*['"]?0['"]?|rejectUnauthorized\s*:\s*false\b|\bverify\s*=\s*False\b/,
	},
	{
		ruleId: "sast/sql-string-interpolation",
		severity: "high",
		message: "SQL query built via string interpolation inside query/execute sink",
		extensions: SQL_CALL_EXTS,
		pattern: /\.(?:query|execute|raw)\s*\(\s*(?:`[^`\n]{0,200}\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`\n]{0,200}\$\{|f['"][^'"\n]{0,200}\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^'"\n]{0,200}\{)/i,
	},
	{
		ruleId: "sast/dom-xss-sink",
		severity: "medium",
		message: "Direct HTML injection sink (innerHTML / dangerouslySetInnerHTML / document.write)",
		extensions: WEB_EXTS,
		pattern: /\bdangerouslySetInnerHTML\s*[:=]|\.\s*innerHTML\s*=|\bdocument\.write\s*\(/,
	},
	{
		ruleId: "sast/py-shell-true",
		severity: "high",
		message: "Python shell execution sink (subprocess shell=True / os.system)",
		extensions: PY_EXTS,
		pattern: /\bsubprocess\.(?:run|Popen|call|check_call|check_output)\s*\([^#\n]{0,200}\bshell\s*=\s*True\b|\bos\.system\s*\(/,
	},
	{
		ruleId: "sast/py-unsafe-deserialize",
		severity: "high",
		message: "Unsafe Python deserialization (pickle/marshal or yaml.load without SafeLoader)",
		extensions: PY_EXTS,
		pattern: /\b(?:pickle|marshal)\.(?:loads|load)\s*\(|\byaml\.load\s*\(/,
		extraCheck: (line) =>
			!/\byaml\.load\s*\(/.test(line) || !/\b(?:yaml\.)?SafeLoader\b/.test(line),
	},
];

const SEVERITY_RANK: Record<SecuritySeverity, number> = {
	high: 0,
	medium: 1,
	low: 2,
};

const CATEGORY_RANK: Record<SecurityCategory, number> = {
	secret: 0,
	sast: 1,
};

const TOOL_PRIORITY: Record<ScannerName, number> = {
	gitleaks: 0,
	semgrep: 1,
	"ast-grep": 2,
	builtin: 3,
};

export function defaultCommandRunner(
	command: string,
	args: string[],
	options: { cwd: string; timeoutMs: number },
): CommandResult {
	const res = spawnSync(command, args, {
		cwd: options.cwd,
		encoding: "utf8",
		shell: false,
		timeout: options.timeoutMs,
		maxBuffer: 10 * 1024 * 1024,
	});
	const errorCode = (res.error as NodeJS.ErrnoException | undefined)?.code;
	return {
		status: res.status,
		stdout: res.stdout ?? "",
		stderr: res.stderr ?? "",
		errorCode,
	};
}

export function normalizeRepoPath(rootDir: string, filePath: string): string {
	const abs = isAbsolute(filePath) ? filePath : resolve(rootDir, filePath);
	const rel = relative(rootDir, abs);
	return rel.replace(/\\/g, "/");
}

export function redactSecretValue(raw: string): string {
	if (!raw) return "[REDACTED]";
	if (raw.startsWith("-----BEGIN")) return "[REDACTED_PRIVATE_KEY]";
	const urlMatch = raw.match(
		/^([a-z0-9+.-]+:\/\/)([^/\s:@'"]+):([^/\s@'"]+)@(.+)$/i,
	);
	if (urlMatch) {
		return `${urlMatch[1]}${urlMatch[2]}:[REDACTED]@${urlMatch[4]}`;
	}
	if (raw.length <= 10) return "[REDACTED]";
	return `${raw.slice(0, 4)}****${raw.slice(-4)}`;
}

export function sanitizeSnippet(line: string, maxLen = 120): string {
	let sanitized = line.trim();
	for (const rule of BUILTIN_SECRET_RULES) {
		const re = new RegExp(rule.pattern.source, rule.pattern.flags);
		sanitized = sanitized.replace(re, (match) => redactSecretValue(match));
	}
	if (sanitized.length > maxLen) {
		return `${sanitized.slice(0, maxLen - 3)}...`;
	}
	return sanitized;
}

function isPlaceholderSecret(match: string, isDbUrl?: boolean): boolean {
	const lower = match.toLowerCase();
	if (lower.includes("${") || lower.includes("<token>") || lower.includes("<secret>")) {
		return true;
	}
	for (const token of PLACEHOLDER_TOKENS) {
		if (lower.includes(token)) return true;
	}
	if (isDbUrl) {
		const m = match.match(/:\/\/([^/\s:@'"]+):([^/\s@'"]+)@([^\s'"`:\/]+)/);
		if (m) {
			const password = m[2].toLowerCase();
			const host = m[3].toLowerCase();
			if (DB_PLACEHOLDER_PASSWORDS.has(password)) return true;
			if (DB_LOCAL_HOSTS.has(host)) return true;
		}
	}
	return false;
}

function isCommentLine(line: string): boolean {
	const trimmed = line.trim();
	return (
		trimmed.startsWith("//") ||
		trimmed.startsWith("#") ||
		trimmed.startsWith("/*") ||
		trimmed.startsWith("*") ||
		trimmed.startsWith("<!--")
	);
}

function isTestFilePath(relPath: string): boolean {
	const lower = relPath.toLowerCase();
	return (
		lower.startsWith("test/") ||
		lower.startsWith("tests/") ||
		lower.includes("/test/") ||
		lower.includes("/tests/") ||
		lower.includes("/__tests__/") ||
		/\.(?:test|spec)\.[a-z0-9]+$/i.test(lower)
	);
}

function isBinaryBuffer(buf: Buffer): boolean {
	const limit = Math.min(buf.length, 4096);
	for (let i = 0; i < limit; i++) {
		if (buf[i] === 0) return true;
	}
	return false;
}

function walkFiles(
	rootDir: string,
	currentDir: string,
	maxFiles: number,
	out: string[],
): boolean {
	let truncated = false;
	let entries;
	try {
		entries = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) =>
			a.name.localeCompare(b.name),
		);
	} catch {
		return false;
	}

	for (const entry of entries) {
		if (out.length >= maxFiles) {
			return true;
		}
		if (entry.isSymbolicLink()) continue;
		const fullPath = join(currentDir, entry.name);
		if (entry.isDirectory()) {
			if (IGNORED_DIRS.has(entry.name)) continue;
			if (walkFiles(rootDir, fullPath, maxFiles, out)) {
				truncated = true;
			}
			continue;
		}
		if (!entry.isFile()) continue;
		if (IGNORED_BASENAMES.has(entry.name.toLowerCase())) continue;
		out.push(normalizeRepoPath(rootDir, fullPath));
	}
	return truncated;
}

function collectGitDiffFiles(
	cwd: string,
	baseRef: string | undefined,
	runner: CommandRunner,
): { isGitRepo: boolean; files: string[] } {
	const inside = runner("git", ["rev-parse", "--is-inside-work-tree"], {
		cwd,
		timeoutMs: PROBE_TIMEOUT_MS,
	});
	if (inside.status !== 0 || inside.stdout.trim() !== "true") {
		return { isGitRepo: false, files: [] };
	}

	const collected = new Set<string>();
	const gitCommands: string[][] = [
		["diff", "--name-only", "--diff-filter=ACMR"],
		["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
		["ls-files", "--others", "--exclude-standard"],
	];
	if (baseRef) {
		if (baseRef.startsWith("-")) {
			throw new Error(`Invalid baseRef "${baseRef}": must not start with '-'`);
		}
		gitCommands.push(["diff", "--name-only", "--diff-filter=ACMR", `${baseRef}...HEAD`, "--"]);
	}

	for (const args of gitCommands) {
		const res = runner("git", args, { cwd, timeoutMs: PROBE_TIMEOUT_MS });
		if (res.status !== 0) continue;
		for (const rawLine of res.stdout.split(/\r?\n/)) {
			const rel = rawLine.trim().replace(/\\/g, "/");
			if (!rel) continue;
			const parts = rel.split("/");
			if (parts.some((p) => IGNORED_DIRS.has(p))) continue;
			const base = parts[parts.length - 1]?.toLowerCase() ?? "";
			if (IGNORED_BASENAMES.has(base)) continue;
			const abs = resolve(cwd, rel);
			if (!existsSync(abs)) continue;
			try {
				if (statSync(abs).isFile()) collected.add(rel);
			} catch {
				// ignore unreadable entries
			}
		}
	}

	return { isGitRepo: true, files: [...collected].sort() };
}

export function scanFileContent(
	relPath: string,
	content: string,
	options?: { includeTests?: boolean },
): SecurityFinding[] {
	const findings: SecurityFinding[] = [];
	const ext = extname(relPath).toLowerCase();
	const skipSast = !options?.includeTests && isTestFilePath(relPath);
	const lines = content.split(/\r?\n/);

	for (let idx = 0; idx < lines.length; idx++) {
		const line = lines[idx];
		if (!line || line.includes("idu-scan:ignore")) continue;
		const lineNum = idx + 1;

		for (const rule of BUILTIN_SECRET_RULES) {
			const re = new RegExp(rule.pattern.source, rule.pattern.flags);
			let match: RegExpExecArray | null;
			while ((match = re.exec(line)) !== null) {
				const raw = match[0];
				if (isPlaceholderSecret(raw, rule.isDbUrl)) continue;
				findings.push({
					tool: "builtin",
					ruleId: rule.ruleId,
					category: "secret",
					severity: rule.severity,
					file: relPath,
					line: lineNum,
					message: `${rule.message} (${redactSecretValue(raw)})`,
					snippet: sanitizeSnippet(line),
				});
				break;
			}
		}

		if (skipSast || isCommentLine(line)) continue;

		for (const rule of BUILTIN_SAST_RULES) {
			if (!rule.extensions.has(ext)) continue;
			if (!rule.pattern.test(line)) continue;
			if (rule.extraCheck && !rule.extraCheck(line)) continue;
			findings.push({
				tool: "builtin",
				ruleId: rule.ruleId,
				category: "sast",
				severity: rule.severity,
				file: relPath,
				line: lineNum,
				message: rule.message,
				snippet: sanitizeSnippet(line),
			});
		}
	}

	return findings;
}

export function parseGitleaksJson(rawJson: string, cwd: string): SecurityFinding[] {
	const trimmed = rawJson.trim();
	if (!trimmed) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];

	const findings: SecurityFinding[] = [];
	for (const entry of parsed) {
		if (!entry || typeof entry !== "object") continue;
		const rec = entry as Record<string, unknown>;
		const rawFile = typeof rec.File === "string" ? rec.File : "";
		if (!rawFile) continue;
		const line = typeof rec.StartLine === "number" && rec.StartLine > 0 ? rec.StartLine : 1;
		const ruleId = typeof rec.RuleID === "string" && rec.RuleID ? `gitleaks/${rec.RuleID}` : "gitleaks/secret";
		const description = typeof rec.Description === "string" && rec.Description ? rec.Description : "Secret detected by gitleaks";
		const secretRaw = typeof rec.Secret === "string" ? rec.Secret : typeof rec.Match === "string" ? rec.Match : "";
		const redacted = secretRaw ? ` (${redactSecretValue(secretRaw)})` : "";
		findings.push({
			tool: "gitleaks",
			ruleId,
			category: "secret",
			severity: "high",
			file: normalizeRepoPath(cwd, rawFile),
			line,
			message: `${description}${redacted}`,
		});
	}
	return findings;
}

function mapSemgrepSeverity(raw: unknown): SecuritySeverity {
	const upper = typeof raw === "string" ? raw.toUpperCase() : "";
	if (upper === "ERROR" || upper === "CRITICAL" || upper === "HIGH") return "high";
	if (upper === "WARNING" || upper === "MEDIUM") return "medium";
	return "low";
}

export function parseSemgrepJson(rawJson: string, cwd: string): SecurityFinding[] {
	const trimmed = rawJson.trim();
	if (!trimmed) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch {
		return [];
	}
	const results = (parsed as { results?: unknown } | null)?.results;
	if (!Array.isArray(results)) return [];

	const findings: SecurityFinding[] = [];
	for (const entry of results) {
		if (!entry || typeof entry !== "object") continue;
		const rec = entry as Record<string, unknown>;
		const rawFile = typeof rec.path === "string" ? rec.path : "";
		if (!rawFile) continue;
		const start = rec.start as { line?: unknown } | undefined;
		const line = typeof start?.line === "number" && start.line > 0 ? start.line : 1;
		const checkId = typeof rec.check_id === "string" && rec.check_id ? rec.check_id : "semgrep/finding";
		const extra = rec.extra as { severity?: unknown; message?: unknown } | undefined;
		const message =
			typeof extra?.message === "string" && extra.message
				? extra.message.replace(/\s+/g, " ").trim().slice(0, 160)
				: checkId;
		const category: SecurityCategory = /secret|token|key|password|credential/i.test(checkId)
			? "secret"
			: "sast";
		findings.push({
			tool: "semgrep",
			ruleId: checkId,
			category,
			severity: mapSemgrepSeverity(extra?.severity),
			file: normalizeRepoPath(cwd, rawFile),
			line,
			message,
		});
	}
	return findings;
}

function mapAstGrepSeverity(raw: unknown): SecuritySeverity {
	const lower = typeof raw === "string" ? raw.toLowerCase() : "";
	if (lower === "error" || lower === "high") return "high";
	if (lower === "warning" || lower === "medium") return "medium";
	return "low";
}

export function parseAstGrepJson(rawOutput: string, cwd: string): SecurityFinding[] {
	const trimmed = rawOutput.trim();
	if (!trimmed) return [];

	const items: unknown[] = [];
	if (trimmed.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) items.push(...parsed);
		} catch {
			return [];
		}
	} else {
		for (const line of trimmed.split(/\r?\n/)) {
			if (!line.trim()) continue;
			try {
				items.push(JSON.parse(line));
			} catch {
				// skip non-JSON diagnostic lines
			}
		}
	}

	const findings: SecurityFinding[] = [];
	for (const entry of items) {
		if (!entry || typeof entry !== "object") continue;
		const rec = entry as Record<string, unknown>;
		const rawFile = typeof rec.file === "string" ? rec.file : "";
		if (!rawFile) continue;
		const range = rec.range as { start?: { line?: unknown } } | undefined;
		const zeroBasedLine = typeof range?.start?.line === "number" ? range.start.line : 0;
		const line = zeroBasedLine >= 0 ? zeroBasedLine + 1 : 1;
		const ruleId = typeof rec.ruleId === "string" && rec.ruleId ? `ast-grep/${rec.ruleId}` : "ast-grep/finding";
		const message =
			typeof rec.message === "string" && rec.message
				? rec.message.replace(/\s+/g, " ").trim().slice(0, 160)
				: ruleId;
		findings.push({
			tool: "ast-grep",
			ruleId,
			category: "sast",
			severity: mapAstGrepSeverity(rec.severity),
			file: normalizeRepoPath(cwd, rawFile),
			line,
			message,
		});
	}
	return findings;
}

function probeBinary(command: string, cwd: string, runner: CommandRunner): boolean {
	const res = runner(command, ["--version"], { cwd, timeoutMs: PROBE_TIMEOUT_MS });
	return res.errorCode !== "ENOENT" && res.status === 0;
}

function runGitleaks(
	cwd: string,
	scanRoot: string,
	allowedFiles: Set<string> | null,
	runner: CommandRunner,
): { status: ScannerStatus; findings: SecurityFinding[] } {
	if (!probeBinary("gitleaks", cwd, runner)) {
		return {
			status: { name: "gitleaks", available: false, executed: false, findingsCount: 0, note: "not installed" },
			findings: [],
		};
	}

	const tempDir = mkdtempSync(join(tmpdir(), "idu-gitleaks-"));
	const reportPath = join(tempDir, "report.json");
	try {
		const res = runner(
			"gitleaks",
			["dir", scanRoot, "--no-banner", "--redact", "--report-format", "json", "--report-path", reportPath],
			{ cwd, timeoutMs: EXTERNAL_TIMEOUT_MS },
		);
		// gitleaks exits 0 (no leaks) or 1 (leaks found).
		if (res.status !== 0 && res.status !== 1) {
			return {
				status: {
					name: "gitleaks",
					available: true,
					executed: true,
					findingsCount: 0,
					note: `exited with code ${res.status ?? "unknown"}`,
				},
				findings: [],
			};
		}
		const raw = existsSync(reportPath) ? readFileSync(reportPath, "utf8") : res.stdout;
		let findings = parseGitleaksJson(raw, cwd);
		if (allowedFiles) {
			findings = findings.filter((f) => allowedFiles.has(f.file));
		}
		return {
			status: { name: "gitleaks", available: true, executed: true, findingsCount: findings.length },
			findings,
		};
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

function runSemgrep(
	cwd: string,
	scanRoot: string,
	mode: ScanMode,
	files: string[],
	allowedFiles: Set<string> | null,
	runner: CommandRunner,
): { status: ScannerStatus; findings: SecurityFinding[] } {
	if (!probeBinary("semgrep", cwd, runner)) {
		return {
			status: { name: "semgrep", available: false, executed: false, findingsCount: 0, note: "not installed" },
			findings: [],
		};
	}
	if (mode === "diff" && files.length === 0) {
		return {
			status: { name: "semgrep", available: true, executed: false, findingsCount: 0, note: "no changed files" },
			findings: [],
		};
	}

	const targets = mode === "diff" && files.length <= 200 ? files : [scanRoot];
	const res = runner(
		"semgrep",
		["scan", "--config", "auto", "--json", "--quiet", "--metrics=off", ...targets],
		{ cwd, timeoutMs: EXTERNAL_TIMEOUT_MS },
	);
	let findings = parseSemgrepJson(res.stdout, cwd);
	if (allowedFiles) {
		findings = findings.filter((f) => allowedFiles.has(f.file));
	}
	const failedWithoutOutput = res.status !== 0 && res.status !== 1 && findings.length === 0;
	return {
		status: {
			name: "semgrep",
			available: true,
			executed: true,
			findingsCount: findings.length,
			...(failedWithoutOutput ? { note: `exited with code ${res.status ?? "unknown"}` } : {}),
		},
		findings,
	};
}

function runAstGrep(
	cwd: string,
	mode: ScanMode,
	files: string[],
	allowedFiles: Set<string> | null,
	runner: CommandRunner,
): { status: ScannerStatus; findings: SecurityFinding[] } {
	const bin = probeBinary("ast-grep", cwd, runner)
		? "ast-grep"
		: probeBinary("sg", cwd, runner)
			? "sg"
			: null;
	if (!bin) {
		return {
			status: { name: "ast-grep", available: false, executed: false, findingsCount: 0, note: "not installed" },
			findings: [],
		};
	}
	const hasConfig = existsSync(join(cwd, "sgconfig.yml")) || existsSync(join(cwd, "sgconfig.yaml"));
	if (!hasConfig) {
		return {
			status: {
				name: "ast-grep",
				available: true,
				executed: false,
				findingsCount: 0,
				note: "no sgconfig.yml in workspace",
			},
			findings: [],
		};
	}
	if (mode === "diff" && files.length === 0) {
		return {
			status: { name: "ast-grep", available: true, executed: false, findingsCount: 0, note: "no changed files" },
			findings: [],
		};
	}

	const targets = mode === "diff" && files.length <= 200 ? files : [];
	const res = runner(bin, ["scan", "--json=stream", ...targets], {
		cwd,
		timeoutMs: EXTERNAL_TIMEOUT_MS,
	});
	let findings = parseAstGrepJson(res.stdout, cwd);
	if (allowedFiles) {
		findings = findings.filter((f) => allowedFiles.has(f.file));
	}
	return {
		status: { name: "ast-grep", available: true, executed: true, findingsCount: findings.length },
		findings,
	};
}

function deduplicateAndSort(findings: SecurityFinding[], maxFindings: number): SecurityFinding[] {
	const bySlot = new Map<string, SecurityFinding>();
	for (const finding of findings) {
		const key = `${finding.file}:${finding.line}:${finding.category}`;
		const existing = bySlot.get(key);
		if (!existing) {
			bySlot.set(key, finding);
			continue;
		}
		// Prefer dedicated external scanner over built-in heuristic on the same file:line:category,
		// or higher severity if same tool priority.
		const betterTool = TOOL_PRIORITY[finding.tool] < TOOL_PRIORITY[existing.tool];
		const sameToolHigherSev =
			TOOL_PRIORITY[finding.tool] === TOOL_PRIORITY[existing.tool] &&
			SEVERITY_RANK[finding.severity] < SEVERITY_RANK[existing.severity];
		if (betterTool || sameToolHigherSev) {
			bySlot.set(key, finding);
		}
	}

	return [...bySlot.values()]
		.sort((a, b) => {
			if (SEVERITY_RANK[a.severity] !== SEVERITY_RANK[b.severity]) {
				return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
			}
			if (CATEGORY_RANK[a.category] !== CATEGORY_RANK[b.category]) {
				return CATEGORY_RANK[a.category] - CATEGORY_RANK[b.category];
			}
			if (a.file !== b.file) return a.file.localeCompare(b.file);
			if (a.line !== b.line) return a.line - b.line;
			return a.ruleId.localeCompare(b.ruleId);
		})
		.slice(0, maxFindings);
}

export function runSecurityScan(options: SecurityScanOptions): SecurityScanReport {
	const cwd = resolve(options.cwd);
	const runner = options.commandRunner ?? defaultCommandRunner;
	const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
	const maxFindings = options.maxFindings ?? DEFAULT_MAX_FINDINGS;
	const externalTools = options.externalTools ?? true;
	const scanRoot = options.target ? resolve(cwd, options.target) : cwd;
	if (options.target && !existsSync(scanRoot)) {
		throw new Error(`Scan target does not exist: ${options.target}`);
	}
	const targetPrefix = options.target ? `${normalizeRepoPath(cwd, scanRoot).replace(/\/$/, "")}/` : null;

	let mode: ScanMode = options.mode ?? "diff";
	let files: string[] = [];
	let truncatedFiles = false;

	if (mode === "diff") {
		const gitDiff = collectGitDiffFiles(cwd, options.baseRef, runner);
		if (!gitDiff.isGitRepo) {
			mode = "full";
		} else {
			files = gitDiff.files;
			if (targetPrefix) {
				const exactTarget = targetPrefix.slice(0, -1);
				files = files.filter((f) => f === exactTarget || f.startsWith(targetPrefix));
			}
			if (files.length > maxFiles) {
				files = files.slice(0, maxFiles);
				truncatedFiles = true;
			}
		}
	}

	if (mode === "full" && existsSync(scanRoot)) {
		const stat = statSync(scanRoot);
		if (stat.isFile()) {
			files = [normalizeRepoPath(cwd, scanRoot)];
		} else {
			truncatedFiles = walkFiles(cwd, scanRoot, maxFiles, files);
		}
	}

	const builtinFindings: SecurityFinding[] = [];
	let filesScanned = 0;
	for (const relPath of files) {
		const abs = resolve(cwd, relPath);
		try {
			const stat = statSync(abs);
			if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;
			const buf = readFileSync(abs);
			if (isBinaryBuffer(buf)) continue;
			filesScanned++;
			const hits = scanFileContent(relPath, buf.toString("utf8"), {
				includeTests: options.includeTests,
			});
			builtinFindings.push(...hits);
		} catch {
			// skip unreadable files
		}
	}

	const scanners: ScannerStatus[] = [
		{
			name: "builtin",
			available: true,
			executed: true,
			findingsCount: builtinFindings.length,
		},
	];
	const allFindings: SecurityFinding[] = [...builtinFindings];

	if (externalTools) {
		const allowedFiles = mode === "diff" ? new Set(files) : null;
		const gl = runGitleaks(cwd, scanRoot, allowedFiles, runner);
		scanners.push(gl.status);
		allFindings.push(...gl.findings);

		const sg = runSemgrep(cwd, scanRoot, mode, files, allowedFiles, runner);
		scanners.push(sg.status);
		allFindings.push(...sg.findings);

		const ag = runAstGrep(cwd, mode, files, allowedFiles, runner);
		scanners.push(ag.status);
		allFindings.push(...ag.findings);
	}

	const findings = deduplicateAndSort(allFindings, maxFindings);
	const summary: SecurityScanSummary = {
		total: findings.length,
		secrets: findings.filter((f) => f.category === "secret").length,
		sast: findings.filter((f) => f.category === "sast").length,
		high: findings.filter((f) => f.severity === "high").length,
		medium: findings.filter((f) => f.severity === "medium").length,
		low: findings.filter((f) => f.severity === "low").length,
	};

	return {
		cwd,
		mode,
		filesScanned,
		truncatedFiles,
		scanners,
		findings,
		summary,
	};
}

export function formatSecurityScanPrompt(report: SecurityScanReport, maxFindingsInPrompt = 20): string {
	const executedTools = report.scanners.filter((s) => s.executed).map((s) => s.name);
	const missingTools = report.scanners.filter((s) => !s.available).map((s) => s.name);
	const header = `Deterministic pre-scan (${report.mode}, ${report.filesScanned} file${report.filesScanned === 1 ? "" : "s"}; ran: ${executedTools.join(", ") || "builtin"}):`;

	const lines: string[] = [header];

	if (report.findings.length === 0) {
		lines.push(
			"0 mechanical secret or SAST sink leads. Focus depth budget on auth, trust boundaries, tenant isolation, and business logic.",
		);
	} else {
		lines.push(
			"Unverified starting leads — confirm reachability and controls in source before reporting; spend remaining depth on auth, isolation, and business logic.",
		);
		const shown = report.findings.slice(0, maxFindingsInPrompt);
		for (const f of shown) {
			lines.push(
				`- [${f.severity.toUpperCase()} ${f.ruleId}] ${f.file}:${f.line} — ${f.message} (${f.tool})`,
			);
		}
		if (report.findings.length > shown.length) {
			lines.push(
				`(+${report.findings.length - shown.length} more lead(s) omitted; run \`idu-pi security-scan --format json\` for full list)`,
			);
		}
	}

	if (missingTools.length > 0) {
		lines.push(`Optional local scanners not on PATH: ${missingTools.join(", ")}.`);
	}

	return lines.join("\n");
}

/**
 * sensors.ts — file-pattern → AgentLab role mapping.
 *
 * The "sensor" pattern from the impulse architecture: when a
 * code change touches a file matching a sensor's pattern, an
 * impulse is fired to the corresponding AgentLab role for audit.
 *
 * Examples:
 *   - src/components/Button.tsx       → agentlab-ui-ux
 *   - src/auth/login.ts               → agentlab-security
 *   - src/lab-db/migrations/0001.sql  → agentlab-database
 *   - src/cli.ts                      → agentlab-architecture
 *   - test/foo.test.ts                → agentlab-code-quality
 *   - package.json                    → agentlab-general
 *   - README.md                       → agentlab-docs
 *
 * Order matters: the first matching sensor wins per file. More
 * specific patterns (UI/UX, security) should come before generic
 * ones (architecture) so that a .tsx file goes to UI/UX, not
 * architecture.
 */

import type { IduModelRoleId } from "./model-assignments.js";

export type SensorPattern = {
	pattern: RegExp;
	role: IduModelRoleId;
	description: string;
};

export const SENSORS: readonly SensorPattern[] = [
	// Order matters: more specific patterns first.
	// Test files (with .test./.spec./in tests/ dir) → code-quality, NOT architecture
	{
		pattern: /(\.test\.|\.spec\.|__tests__\/|^tests?\/.*\.(ts|js|tsx|jsx)$)/u,
		role: "agentlab-code-quality",
		description: "Test file change",
	},
	// UI/UX surfaces (html, tsx, jsx, css, etc.)
	{
		pattern:
			/\.(html|tsx|jsx|vue|php|erb|jinja|hbs|handlebars|css|scss|sass|less)$/u,
		role: "agentlab-ui-ux",
		description: "UI/UX surface file change",
	},
	// Security/auth-sensitive paths
	{
		pattern:
			/(auth|token|login|session|jwt|oauth|credential|password|secret)/iu,
		role: "agentlab-security",
		description: "Auth/security surface file change",
	},
	// Database/schema migrations
	{
		pattern: /(migration|\.sql$|lab\.db$|schema|\.db$|postgres|mysql|sqlite)/iu,
		role: "agentlab-database",
		description: "Database/schema/migration file change",
	},
	// Dependency manifests
	{
		pattern:
			/(package\.json|pnpm-lock\.yaml|requirements\.txt|Pipfile$|Cargo\.toml$|go\.mod$)/u,
		role: "agentlab-general",
		description: "Dependency file change",
	},
	// Documentation
	{
		pattern: /(README\.md$|CHANGELOG\.md$|^docs?\/|\.mdx$)/u,
		role: "agentlab-docs",
		description: "Documentation file change",
	},
	// Generic code architecture (catch-all for .ts/.js/.mjs/.cjs)
	{
		pattern: /\.(ts|js|mjs|cjs)$/u,
		role: "agentlab-architecture",
		description: "Code architecture file change",
	},
];

export type SensorMatch = {
	file: string;
	role: IduModelRoleId;
	description: string;
};

export function matchSensors(changedFiles: readonly string[]): SensorMatch[] {
	const out: SensorMatch[] = [];
	for (const file of changedFiles) {
		for (const sensor of SENSORS) {
			if (sensor.pattern.test(file)) {
				out.push({ file, role: sensor.role, description: sensor.description });
				break; // first match wins
			}
		}
	}
	return out;
}

export function groupMatchesByRole(
	matches: SensorMatch[],
): Map<IduModelRoleId, SensorMatch[]> {
	const out = new Map<IduModelRoleId, SensorMatch[]>();
	for (const match of matches) {
		const list = out.get(match.role) ?? [];
		list.push(match);
		out.set(match.role, list);
	}
	return out;
}

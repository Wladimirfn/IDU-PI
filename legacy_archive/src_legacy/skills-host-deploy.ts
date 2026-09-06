/**
 * skills-host-deploy.ts — outbound skill deployment.
 *
 * Mirrors idu-pi-owned skills from the project's source directory
 * (`<repo>/.idu/skills/`, populated upstream by `syncNecessarySkills` from
 * the internal `skills-bundle/`) INTO the directory that the host CLI
 * reads skills from (e.g. `<repo>/.agents/skills/` for OpenCode).
 *
 * Contract (Etapa 3a of the idu-pi skills-deploy fix):
 *   1. Source of truth: `<repo>/.idu/skills/<name>/SKILL.md` for each
 *      `<name>` that has a SKILL.md inside `<name>/` (idu-pi-owned).
 *   2. Destination: `<hostDir>/<name>/` — created/refreshed with
 *      `cpSync` from source. cpSync IS additive at the file level: it
 *      overwrites stale contents but never deletes anything. The
 *      destination subdir either is created (if absent) or has its
 *      files refreshed (if present). The subdir itself is never
 *      removed.
 *   3. Subdirs under `<hostDir>` that DO NOT contain a SKILL.md
 *      belong to the user/host and are PRESERVED untouched. This is
 *      the same territory rule applied by hygiene-migrate.ts to
 *      `.agents/skills/`.
 *   4. The function is IDEMPOTENT: calling it twice yields the same
 *      observable state, no errors, and `overwritten` reflects what
 *      happened on each call.
 *   5. After deploy, `<hostDir>/INDEX.md` is regenerated with the
 *      idu-pi-owned skills listed. If the host dir had a previous
 *      INDEX.md from another tool, the previous INDEX is overwrit-
 *      ten because INDEX.md is a generated artifact (idu-pi-owned).
 *
 * Skill target map (Etapa 3b): the `getSkillHostDir` helper resolves
 * `<repo>/.hosts/<name>/<skills>` for known hosts (opencode → .agents,
 * pi → .pi, claude → .claude). Default targets are PROJECT-LOCAL only.
 * Global targets (~/.pi/agent/skills, ~/.claude/skills) require
 * opt-in via `targetScope: 'global'` — see `SKILL_TARGETS` below.
 *
 * Safety:
 *   - Does NOT modify `.gitignore`. The model is to commit the host
 *     dir so a fresh clone has skills available before idu-pi runs
 *     (otherwise chicken-and-egg on first boot).
 *   - Only operates under paths the caller passes. The CLI handler
 *     decides which host dir to target via `--target` flag + the
 *     skill-target-map. Without a target flag, default is opencode
 *     project-local (Etapa 3a behavior preserved).
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	writeFileSync,
	cpSync,
} from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";

/**
 * Skill target: which directory to deploy idu-pi-owned skills into
 * for a given host. Project-local by default; global opt-in
 * explicit (NOT auto) for hosts that have a meaningful global skills
 * dir we know about.
 *
 * This is the Etapa 3b answer to the brief's "skill-target-map": one
 * host → one project-local dir, with a strictly opt-in global
 * counterpart. New entries here are test-covered; see tests
 * `getSkillHostDir (project-local)` and the global-opt-in test.
 */
export type SkillTargetId = "opencode" | "pi" | "claude";

export type SkillTargetScope = "project" | "global";

export type SkillTarget = {
	id: SkillTargetId;
	scope: SkillTargetScope;
	/** Resolved absolute path of the skills dir for this target. */
	dir: string;
};

export type SkillsHostError = { kind: "unknown_host"; target: string };

/**
 * The single source of truth for "which directory should idu-pi
 * mirror skills into, for which host, in which scope".
 *
 * Add a new host here ONLY when:
 *   - the host reads skills from a stable path,
 *   - that path is documented (skill format, owner, etc.),
 *   - and the deploy is verified to be safe (idempotent, no
 *     collisions with user content on that host).
 *
 * Currently registered:
 *   - opencode: project-local <repo>/.agents/skills (default)
 *   - pi:       project-local <repo>/.pi/skills
 *   - claude:   project-local <repo>/.claude/skills
 *
 * Global scope is registered as a separate path (NOT default) via
 * the resolveSkillTarget() helper when the caller passes
 * scope: 'global'.
 */
export function resolveSkillTarget(input: {
	target: SkillTargetId;
	scope: SkillTargetScope;
	repoRoot: string;
}): SkillTarget {
	const projectLocal: Record<SkillTargetId, string> = {
		opencode: ".agents/skills",
		pi: ".pi/skills",
		claude: ".claude/skills",
	};
	if (input.scope === "global") {
		const globalPath: Record<SkillTargetId, string> = {
			opencode: join(homedir(), ".config", "opencode", "skills"),
			pi: join(homedir(), ".pi", "agent", "skills"),
			claude: join(homedir(), ".claude", "skills"),
		};
		return {
			id: input.target,
			scope: "global",
			dir: globalPath[input.target],
		};
	}
	return {
		id: input.target,
		scope: "project",
		dir: join(input.repoRoot, projectLocal[input.target]),
	};
}

/**
 * Parse `--target` flag from CLI args. Returns `{ target, scope }`
 * for known combinations: "opencode", "pi", "claude"
 * (project-local, default), or prefixed with "global:" for the
 * global counterpart (opt-in). Unknown tokens throw — caller
 * receives the error and surfaces it via `fail()`.
 */
export function parseSkillTarget(
	rest: string[],
): { target: SkillTargetId; scope: SkillTargetScope } {
	let targetFlag: string | undefined;
	let scopeFlag: string | undefined;
	for (let i = 0; i < rest.length; i++) {
		const tok = rest[i];
		if (tok === "--target" && i + 1 < rest.length) {
			targetFlag = rest[i + 1];
			i++;
			continue;
		}
		if (tok?.startsWith("--target=")) {
			targetFlag = tok.slice("--target=".length);
			continue;
		}
		if (tok === "--scope" && i + 1 < rest.length) {
			scopeFlag = rest[i + 1];
			i++;
			continue;
		}
		if (tok?.startsWith("--scope=")) {
			scopeFlag = tok.slice("--scope=".length);
		}
	}
	if (targetFlag === undefined) {
		// No --target flag → default = opencode project-local
		// (preserves Etapa 3a behavior for callers that don't pass
		// the flag at all).
		return { target: "opencode", scope: "project" };
	}
	if (targetFlag === "opencode" || targetFlag === "pi" || targetFlag === "claude") {
		const scope: SkillTargetScope = scopeFlag === "global" ? "global" : "project";
		return { target: targetFlag, scope };
	}
	throw new Error(
		`--target debe ser opencode|pi|claude (recibido: ${targetFlag})`,
	);
}

/**
 * Resolve the host dir from a parsed target. Convenience wrapper
 * around `resolveSkillTarget` for the CLI handler.
 */
export function getSkillHostDir(input: {
	target: SkillTargetId;
	scope: SkillTargetScope;
	repoRoot: string;
}): string {
	return resolveSkillTarget(input).dir;
}

export type SkillsHostDeployInput = {
	/** Absolute path to the source skills dir. Default: `<repo>/.idu/skills`. */
	sourceDir: string;
	/** Absolute path to the host target dir. Default: `<repo>/.agents/skills`. */
	hostDir: string;
	/** Used in INDEX.md paths and for diagnostics. */
	projectPath: string;
	/** Repo root used to derive the host-relative prefix in INDEX.md.
	 *  Optional: when omitted, the host-dir basename is used as the
	 *  prefix (sensible fallback for tests/ad-hoc scripts). */
	repoRoot?: string;
	/** Optional label for the host (e.g. "opencode" | "pi" | "claude").
	 *  Used in the INDEX intro line and the formatter banner so the
	 *  output reflects which target was deployed. Not used for
	 *  routing — the caller must already have resolved hostDir. */
	hostLabel?: string;
};

export type SkillsHostDeployResult = {
	projectPath: string;
	sourceDir: string;
	hostDir: string;
	/** Optional label for the host (e.g. "opencode" | "pi" | "claude"). */
	hostLabel?: string;
	/** Source skills that were NOT in source (no SKILL.md) — skipped. */
	missingInSource: string[];
	/** Skills newly created at the host (subdir did not exist before). */
	copied: string[];
	/** Skills whose host subdir existed and was overwritten by cpSync. */
	overwritten: string[];
	/** Host subdirs without SKILL.md that the deploy preserved (user skills). */
	preservedUser: string[];
	/** Path to the regenerated INDEX.md inside hostDir. */
	indexPath: string;
};

export function listIduPiOwnedSkills(sourceDir: string): string[] {
	if (!existsSync(sourceDir)) return [];
	return readdirSync(sourceDir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.filter((name) => existsSync(join(sourceDir, name, "SKILL.md")))
		.sort();
}

export function listHostUserSkills(hostDir: string): string[] {
	if (!existsSync(hostDir)) return [];
	return readdirSync(hostDir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.filter((name) => !existsSync(join(hostDir, name, "SKILL.md")))
		.sort();
}

export function writeHostSkillIndex(
	hostDir: string,
	repoRoot?: string,
): string {
	mkdirSync(hostDir, { recursive: true });
	const iduSkills = listIduPiOwnedSkills(hostDir).filter((name) =>
		existsSync(join(hostDir, name, "SKILL.md")),
	);
	const userSkills = listHostUserSkills(hostDir);
	// Derive the host-relative prefix from hostDir (and an optional
	// repoRoot). Example:
	//   hostDir = "<repo>/.pi/skills", repoRoot = "<repo>"
	//   → hostRel = ".pi/skills"
	//   → INDEX line: "| name | .pi/skills/name/SKILL.md |"
	// Fallback for callers that don't pass repoRoot (tests, ad-hoc
	// scripts): use the basename of hostDir so a /tmp/skills dir still
	// gets a sensible "skills/name" prefix. We never hardcode the
	// host name anymore — that was the Etapa 3a bug.
	const hostRel =
		repoRoot !== undefined && repoRoot !== ""
			? relative(repoRoot, hostDir).replace(/\\/gu, "/") ||
				relative("", hostDir).replace(/\\/gu, "/").replace(/^\.\//u, "")
			: hostDir
					.split(/[\\/]/u)
					.filter(Boolean)
					.pop() ?? "skills";
	const iduLines = iduSkills.map(
		(name) =>
			`| ${name} | ${join(hostRel, name, "SKILL.md").replace(/\\/gu, "/")} |`,
	);
	const userLines = userSkills.map(
		(name) =>
			`| ${name} | ${join(hostRel, name).replace(/\\/gu, "/")} |`,
	);
	const content =
		`# Host Skill Index\n\n` +
		`idu-pi-owned skills are listed first (managed by idu-pi; refresh via \`idu-pi idu-skills-deploy --target <host>\`). ` +
		`Anything not below comes from you or another tool; idu-pi does not modify those.\n\n` +
		`| Skill | Path |\n| --- | --- |\n` +
		iduLines.concat(userLines).join("\n") +
		"\n";
	const indexPath = join(hostDir, "INDEX.md");
	writeFileSync(indexPath, content, "utf8");
	return indexPath;
}

export function deploySkillsToHost(
	input: SkillsHostDeployInput,
): SkillsHostDeployResult {
	const { sourceDir, hostDir, projectPath } = input;
	const repoRoot = input.repoRoot ?? projectPath;
	const hostLabel = input.hostLabel;

	const iduSkills = listIduPiOwnedSkills(sourceDir);
	const result: SkillsHostDeployResult = {
		projectPath,
		sourceDir,
		hostDir,
		hostLabel,
		missingInSource: [],
		copied: [],
		overwritten: [],
		preservedUser: listHostUserSkills(hostDir),
		indexPath: "",
	};

	mkdirSync(hostDir, { recursive: true });

	for (const name of iduSkills) {
		const src = join(sourceDir, name);
		const dst = join(hostDir, name);
		const existed = existsSync(dst);
		// cpSync is recursive: it overwrites file contents in dst
		// without removing the destination dir. Subdirs not owned by
		// idu-pi (no SKILL.md) are not enumerated here, so they
		// stay untouched in the host dir.
		cpSync(src, dst, { recursive: true });
		if (existed) {
			result.overwritten.push(name);
		} else {
			result.copied.push(name);
		}
	}

	// Write INDEX after deploy so it reflects the final host state.
	result.indexPath = writeHostSkillIndex(hostDir, repoRoot);

	return result;
}

export function formatSkillsHostDeployResult(
	r: SkillsHostDeployResult,
): string {
	const lines: string[] = [
		`Skills deploy (host mirror${r.hostLabel ? `: ${r.hostLabel}` : ""})`,
		``,
		`Source:  ${r.sourceDir}`,
		`Host:    ${r.hostDir}`,
		`Index:   ${r.indexPath}`,
		``,
		`Copied (new on host):`,
		...r.copied.map((s) => `  - ${s}`),
		``,
		`Overwritten (stale refreshed):`,
		...r.overwritten.map((s) => `  - ${s}`),
		``,
		`User skills preserved (no SKILL.md — not touched):`,
		...r.preservedUser.map((s) => `  - ${s}`),
		``,
		`Missing in source (declared NECESSARY but absent upstream):`,
		...r.missingInSource.map((s) => `  - ${s}`),
		``,
		`Note: idu-pi deploy only touches subdirs with SKILL.md. ` +
			`Anything else under ${r.hostDir} is yours.`,
	];
	return lines.join("\n");
}

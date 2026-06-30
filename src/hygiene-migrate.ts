/**
 * hygiene-migrate.ts — one-time migration from legacy <repo>/config/ to
 * <repo>/.idu/config/ (and <repo>/skills/ to <repo>/.idu/skills/).
 *
 * The migration is governed by the territory model: idu-pi only moves what
 * its own manifest says it owns. For config files, that's a fixed list of
 * 4 governance files. For skills, the migration is by manifest — read
 * skills.json, enumerate only the skills it lists, move each one
 * recursively. Anything else in <repo>/skills/ is the user's and is
 * left alone.
 *
 * Atomic on the same filesystem (renameSync). Cross-device fallback uses
 * cpSync recursive + rmSync recursive (NOT copyFileSync, which is
 * file-only and would break for dirs).
 *
 * The migration is idempotent. Running it twice does not double-move.
 * If <repo>/.idu/ already exists, the legacy is left untouched and the
 * user is told to reconcile manually.
 */

import {
	appendFileSync,
	cpSync,
	readdirSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	rmSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** Exact 4 governance files (auditor-approved, no more, no less). */
const LEGACY_CONFIG_FILES = [
	"project-core.json",
	"project-constitution.json",
	"project-blueprint.json",
	"project-flows.json",
] as const;

export type MovedEntry = { from: string; to: string };
export type SkippedEntry = { from: string; reason: string };
export type ErrorEntry = { from: string; message: string };

export type MigrationResult = {
	moved: MovedEntry[];
	skipped: SkippedEntry[];
	errors: ErrorEntry[];
};

export function migrateHygieneLayout(input: {
	repoRoot: string;
	stateRoot: string;
	now?: Date;
}): MigrationResult {
	const iduConfigDir = join(input.repoRoot, ".idu", "config");
	const iduSkillsDir = join(input.repoRoot, ".idu", "skills");
	const legacyConfigDir = join(input.repoRoot, "config");
	// FORMERLY: config-wizard used <repo>/.agents/skills/ (SKILLS_DIR =
	// ".agents/skills" in src/config-wizard.ts) for project skills. The
	// idu-pi-owned signal was the presence of SKILL.md inside each
	// subdir. This migration moves that legacy layout to
	// <repo>/.idu/skills/ (the new territory).
	const legacySkillsDir = join(input.repoRoot, ".agents", "skills");

	const result: MigrationResult = { moved: [], skipped: [], errors: [] };

	// 1. Config: fixed list (exact 4 governance files, no more, no less).
	if (existsSync(iduConfigDir)) {
		result.skipped.push({
			from: legacyConfigDir,
			reason: ".idu/config/ already exists; manual reconciliation required",
		});
	} else {
		for (const file of LEGACY_CONFIG_FILES) {
			const from = join(legacyConfigDir, file);
			const to = join(iduConfigDir, file);
			if (!existsSync(from)) continue;
			try {
				safeMove(from, to);
				result.moved.push({ from, to });
			} catch (err) {
				result.errors.push({ from, message: (err as Error).message });
			}
		}
		// If the legacy config dir is now empty, remove it. If the user has
		// other files in there, we leave it alone (those are the user's).
		tryRmdirIfEmpty(legacyConfigDir);
	}

	// 2. Skills: by directory enumeration + SKILL.md presence.
	// Any subdir of <repo>/.agents/skills/ that contains SKILL.md is an
	// idu-pi skill (idu-pi's format). Subdirs without SKILL.md are the
	// user's; we leave them alone.
	//
	// Skills use safeCopy (NOT safeMove). Rationale: .agents/skills/,
	// .pi/skills/, .claude/skills/ are where the host CLI reads skills
	// from — they are NOT "legacy to remove" but deployments the host
	// requires. Cutting (safeMove) destroyed the host's view of skills
	// across the project boundary. The new model is additive: idu-pi
	// mirrors idu-pi-owned skills into <repo>/.idu/skills/ while
	// preserving the source directory so the host (and any other
	// consumer) keeps reading from its expected location.
	if (existsSync(iduSkillsDir)) {
		result.skipped.push({
			from: legacySkillsDir,
			reason: ".idu/skills/ already exists; manual reconciliation required",
		});
	} else {
		if (existsSync(legacySkillsDir)) {
			let entries: string[] = [];
			try {
				entries = readdirSync(legacySkillsDir, { withFileTypes: true })
					.filter((e) => e.isDirectory())
					.map((e) => e.name);
			} catch (err) {
				result.errors.push({
					from: legacySkillsDir,
					message: `failed to enumerate legacy skills dir: ${(err as Error).message}`,
				});
			}
			// Copy each subdir that has SKILL.md (idu-pi-owned)
			for (const name of entries) {
				const from = join(legacySkillsDir, name);
				const to = join(iduSkillsDir, name);
				if (!existsSync(join(from, "SKILL.md"))) continue; // not idu-pi-owned
				try {
					safeCopy(from, to);
					result.moved.push({ from, to });
				} catch (err) {
					result.errors.push({ from, message: (err as Error).message });
				}
			}
			// Copy INDEX.md (idu-pi's auto-generated index)
			const indexMd = join(legacySkillsDir, "INDEX.md");
			if (existsSync(indexMd)) {
				try {
					const indexMdTo = join(iduSkillsDir, "INDEX.md");
					safeCopy(indexMd, indexMdTo);
					result.moved.push({ from: indexMd, to: indexMdTo });
				} catch (err) {
					result.errors.push({
						from: indexMd,
						message: (err as Error).message,
					});
				}
			}
			// Copy .gitkeep (idu-pi-owned, created by initProjectAssets)
			const gitkeep = join(legacySkillsDir, ".gitkeep");
			if (existsSync(gitkeep)) {
				try {
					const gitkeepTo = join(iduSkillsDir, ".gitkeep");
					safeCopy(gitkeep, gitkeepTo);
					result.moved.push({ from: gitkeep, to: gitkeepTo });
				} catch (err) {
					result.errors.push({
						from: gitkeep,
						message: (err as Error).message,
					});
				}
			}
		}
		// Note (skill branch): do NOT remove the legacy skills directory.
		// .agents/skills/ is the host's read-path; idu-pi mirrors the
		// idu-pi-owned subset into <repo>/.idu/skills/ but leaves the
		// source intact. The previous tryRmdirIfEmpty(legacySkillsDir)
		// call is intentionally removed.
	}

	// 3. Log to events
	appendToEventsLog(input.stateRoot, {
		kind: "hygiene_migration",
		ts: (input.now ?? new Date()).toISOString(),
		moved: result.moved,
		skipped: result.skipped,
		errors: result.errors,
	});

	return result;
}

/**
 * Safe move that handles both files and dirs. Atomic rename on the same
 * filesystem; cpSync recursive + rmSync recursive on cross-device (EXDEV).
 * NOT copyFileSync — that is file-only and breaks for dirs.
 */
function safeMove(from: string, to: string): void {
	mkdirSync(dirname(to), { recursive: true });
	try {
		renameSync(from, to);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "EXDEV") {
			// Cross-device. cpSync handles both files and dirs (recursive).
			cpSync(from, to, { recursive: true });
			rmSync(from, { recursive: true, force: true });
			return;
		}
		throw err;
	}
}

/**
 * Safe additive copy. Mirror of safeMove WITHOUT the rmSync step.
 * Used by the Skills branch of migrateHygieneLayout because
 * .agents/skills/ is the host CLI's read-path (not a legacy dir to
 * retire). cpSync handles both files and dirs (recursive); not
 * copyFileSync (file-only). Same EXDEV semantics as safeMove: a single
 * filesystem uses cpSync too — the difference is strictly the absence
 * of rmSync at the end.
 */
function safeCopy(from: string, to: string): void {
	mkdirSync(dirname(to), { recursive: true });
	cpSync(from, to, { recursive: true });
}

function appendToEventsLog(
	stateRoot: string,
	event: Record<string, unknown>,
): void {
	const eventsPath = join(stateRoot, "events.jsonl");
	mkdirSync(stateRoot, { recursive: true });
	appendFileSync(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
}

/** Remove a directory if it is empty. If it has other content, leave it. */
function tryRmdirIfEmpty(dir: string): void {
	if (!existsSync(dir)) return;
	try {
		rmdirSync(dir);
	} catch {
		// Not empty, or not a dir, or no permission. Leave it.
	}
}

/**
 * Read a governance file from <repo>/.idu/config/<name> with an automatic
 * one-time migration from the legacy location <repo>/config/<name>.
 *
 * Territory model: idu-pi only writes under stateRoot/** or <repo>/.idu/**.
 * Readers should prefer the .idu/ path. If the file is found at the legacy
 * location instead, this helper moves it atomically to .idu/ before reading.
 *
 * Returns:
 *   - `{ content, migrated: false }` if the file was already in .idu/
 *   - `{ content, migrated: true  }` if the file was migrated from legacy
 *   - `{ content: null, migrated: false }` if neither path has the file
 *
 * Safe to call multiple times: after the first migration, subsequent calls
 * hit the .idu/ path directly and return `migrated: false`.
 */
export function readIdPathWithMigration(
	repoRoot: string,
	name: string,
): { content: string | null; migrated: boolean } {
	const newPath = join(repoRoot, ".idu", "config", name);
	if (existsSync(newPath)) {
		return { content: readFileSync(newPath, "utf8"), migrated: false };
	}
	const legacyPath = join(repoRoot, "config", name);
	if (existsSync(legacyPath)) {
		mkdirSync(dirname(newPath), { recursive: true });
		renameSync(legacyPath, newPath);
		return { content: readFileSync(newPath, "utf8"), migrated: true };
	}
	return { content: null, migrated: false };
}

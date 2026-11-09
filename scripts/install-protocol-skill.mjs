#!/usr/bin/env node
/**
 * Installs idu-pi's bundled skills into every orchestrator harness on this
 * machine, and keeps the in-repo copies byte-identical.
 *
 * Why this exists: the protocol used to live only in the repo. Pi had it
 * installed; OpenCode, Claude, Gemini and Codex did not. So a rule that said
 * "call idu_capabilities with include_quota before delegating" was documented,
 * tested, and never executed by the harnesses the user actually runs. A
 * protocol nobody loads is a comment. Nothing in the code can detect that, so
 * it has to be a step that runs.
 *
 * The same failure mode applies to any bundled skill, so this walks a list of
 * skills rather than one hardcoded name. A skill's file list must cover every
 * file a harness needs to load it; a file missing from that list is a file that
 * silently stays behind on each machine.
 *
 * Run it with:  node scripts/install-protocol-skill.mjs [--check]
 *
 * --check verifies without writing, for CI and preflight.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Each bundled skill and every file a harness needs in order to load it.
 * Paths are relative to `skills-bundle/<name>/`.
 */
const skills = [
	{
		name: "idu-pi-parent-protocol",
		files: ["SKILL.md"],
	},
	{
		name: "security-audit-practice",
		files: ["SKILL.md", "fragments/hunter.md", "fragments/verifier.md"],
	},
	{
		name: "video-production",
		files: [
			"SKILL.md",
			"validar_motion.py",
			"render_frames.mjs",
			"references/video-lanes.json",
			"references/style-brief.md",
			"references/art-direction.md",
			"references/visual-qa.md",
		],
	},
	{
		name: "story-continuity",
		files: [
			"SKILL.md",
			"references/artifact-chain.md",
			"references/continuity-locks.md",
			"references/character-continuity.md",
			"references/review-checklist.md",
			"references/attribution.md",
		],
	},
	{
		name: "shader-fx",
		files: [
			"SKILL.md",
			"references/glsl-patterns.md",
			"references/hyperframes-integration.md",
			"references/attribution.md",
		],
	},
];

/** In-repo mirrors that must stay byte-identical to the bundle. */
const inRepoMirrors = [join(".agents", "skills"), join(".pi", "skills")];

/**
 * Where each harness loads skills from.
 *
 * A harness missing from this list is a harness that silently does not get the
 * skill. Adding one is the whole point of this file existing.
 */
const targets = [
	{ harness: "opencode", dir: join(homedir(), ".config", "opencode", "skills") },
	{ harness: "claude", dir: join(homedir(), ".claude", "skills") },
	{ harness: "pi", dir: join(homedir(), ".pi", "agent", "skills") },
	{ harness: "gemini", dir: join(homedir(), ".gemini", "skills") },
	{ harness: "antigravity", dir: join(homedir(), ".gemini", "antigravity-cli", "skills") },
	{ harness: "codex", dir: join(homedir(), ".codex", "skills") },
];

const check = process.argv.includes("--check");
let drift = 0;
let installed = 0;
let alreadyCurrent = 0;
let skipped = 0;

function sameBytes(path, canonical) {
	if (!existsSync(path)) return false;
	try {
		return readFileSync(path).equals(canonical);
	} catch {
		return false;
	}
}

function write(path, canonical) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, canonical);
}

for (const skill of skills) {
	const sourceDir = join(repoRoot, "skills-bundle", skill.name);
	const missing = skill.files.filter((file) => !existsSync(join(sourceDir, file)));
	if (missing.length > 0) {
		console.error(`No existe ${join(sourceDir, missing[0])}`);
		process.exit(1);
	}

	const skillHash = createHash("sha256")
		.update(readFileSync(join(sourceDir, "SKILL.md")))
		.digest("hex")
		.slice(0, 16);

	for (const file of skill.files) {
		const canonical = readFileSync(join(sourceDir, file));

		for (const mirrorBase of inRepoMirrors) {
			const copy = join(repoRoot, mirrorBase, skill.name, file);
			if (sameBytes(copy, canonical)) continue;
			drift++;
			if (!check) write(copy, canonical);
			console.log(`${check ? "DRIFT" : "synced"}  ${copy.slice(repoRoot.length + 1)}`);
		}

		for (const { harness, dir } of targets) {
			if (!existsSync(dir)) {
				skipped++;
				console.log(`skip      ${harness}: ${dir} no existe en esta maquina`);
				continue;
			}
			const dest = join(dir, skill.name, file);
			if (sameBytes(dest, canonical)) {
				alreadyCurrent++;
				continue;
			}
			installed++;
			if (!check) write(dest, canonical);
			console.log(`${check ? "STALE" : "installed"}  ${harness} -> ${dest}`);
		}
	}

	console.log("");
	console.log(`fuente: skills-bundle/${skill.name}  sha256:${skillHash}`);
}

console.log("");
console.log(`skills declarados: ${skills.length}`);
console.log(`copias en el repo desalineadas: ${drift}`);
console.log(`harnesses instalados o actualizados: ${installed} | ya al dia: ${alreadyCurrent} | omitidos: ${skipped}`);

if (check && (drift > 0 || installed > 0)) {
	console.log("");
	console.log("Para alinear: node scripts/install-protocol-skill.mjs");
	process.exit(1);
}

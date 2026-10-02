#!/usr/bin/env node
/**
 * Installs the idu-pi parent protocol skill into every orchestrator harness on
 * this machine, and keeps the three in-repo copies byte-identical.
 *
 * Why this exists: the protocol used to live only in the repo. Pi had it
 * installed; OpenCode, Claude, Gemini and Codex did not. So a rule that said
 * "call idu_capabilities with include_quota before delegating" was documented,
 * tested, and never executed by the harnesses the user actually runs. A
 * protocol nobody loads is a comment. Nothing in the code can detect that, so
 * it has to be a step that runs.
 *
 * Run it with:  node scripts/install-protocol-skill.mjs [--check]
 *
 * --check verifies without writing, for CI and preflight.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(repoRoot, "skills-bundle", "idu-pi-parent-protocol", "SKILL.md");

/** The three in-repo copies that must stay byte-identical. */
const inRepoCopies = [
	join(repoRoot, "skills-bundle", "idu-pi-parent-protocol", "SKILL.md"),
	join(repoRoot, ".agents", "skills", "idu-pi-parent-protocol", "SKILL.md"),
	join(repoRoot, ".pi", "skills", "idu-pi-parent-protocol", "SKILL.md"),
];

/**
 * Where each harness loads skills from.
 *
 * A harness missing from this list is a harness that silently does not get the
 * protocol. Adding one is the whole point of this file existing.
 */
const targets = [
	{ harness: "opencode", dir: join(homedir(), ".config", "opencode", "skills") },
	{ harness: "claude", dir: join(homedir(), ".claude", "skills") },
	{ harness: "pi", dir: join(homedir(), ".pi", "agent", "skills") },
	{ harness: "gemini", dir: join(homedir(), ".gemini", "skills") },
	{ harness: "codex", dir: join(homedir(), ".codex", "skills") },
];

const check = process.argv.includes("--check");
const skillName = "idu-pi-parent-protocol";

if (!existsSync(source)) {
	console.error(`No source skill at ${source}`);
	process.exit(1);
}

const canonical = readFileSync(source);
const canonicalHash = createHash("sha256").update(canonical).digest("hex").slice(0, 16);
let drift = 0;
let installed = 0;
let alreadyCurrent = 0;
let skipped = 0;

for (const copy of inRepoCopies) {
	if (copy === source) continue;
	try {
		const current = existsSync(copy) ? readFileSync(copy) : null;
		if (current && current.equals(canonical)) continue;
		drift++;
		if (!check) {
			mkdirSync(dirname(copy), { recursive: true });
			writeFileSync(copy, canonical, "utf8");
		}
		console.log(`${check ? "DRIFT" : "synced"}  ${copy.slice(repoRoot.length + 1)}`);
	} catch (err) {
		console.error(`  no se pudo sincronizar ${copy}: ${err.message}`);
		drift++;
	}
}

for (const { harness, dir } of targets) {
	if (!existsSync(dir)) {
		skipped++;
		console.log(`skip      ${harness}: ${dir} no existe en esta maquina`);
		continue;
	}
	const dest = join(dir, skillName, "SKILL.md");
	try {
		const current = existsSync(dest) ? readFileSync(dest) : null;
		if (current && current.equals(canonical)) {
			alreadyCurrent++;
			continue;
		}
		installed++;
		if (!check) {
			mkdirSync(join(dir, skillName), { recursive: true });
			writeFileSync(dest, canonical, "utf8");
		}
		console.log(`${check ? "STALE" : "installed"}  ${harness} -> ${dest}`);
	} catch (err) {
		console.error(`  no se pudo instalar en ${harness}: ${err.message}`);
	}
}

console.log("");
console.log(`fuente: skills-bundle/${skillName}/SKILL.md  sha256:${canonicalHash}`);
console.log(`copias en el repo desalineadas: ${drift}`);
console.log(`harnesses instalados o actualizados: ${installed} | ya al dia: ${alreadyCurrent} | omitidos: ${skipped}`);

if (check && (drift > 0 || installed > 0)) {
	console.log("");
	console.log("Para alinear: node scripts/install-protocol-skill.mjs");
	process.exit(1);
}

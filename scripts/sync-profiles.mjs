#!/usr/bin/env node
/**
 * scripts/sync-profiles.mjs — keep `config/profiles/*.md` in sync
 * with the upstream `Perfil ia/skill-*.md` files.
 *
 * Usage:
 *   node scripts/sync-profiles.mjs [--source <path>] [--dry-run]
 *
 * Default source:
 *   C:/Users/elmas/Downloads/Documento proyecto/Perfil ia/
 *
 * Default target:
 *   <repo-root>/config/profiles/
 *
 * What it does:
 *   1. Walk the source directory, find skill-*.md files.
 *   2. For each, parse the frontmatter; resolve the target rol-id.
 *   3. Read both the source and target. If they differ (or target
 *      missing), copy source → target.
 *   4. Print a one-line summary per file.
 *   5. Exit 0 always; the script does not commit. The user reviews
 *      the diff with `git diff config/profiles/` and commits.
 */

import {
	readFileSync,
	writeFileSync,
	existsSync,
	readdirSync,
	statSync,
	mkdirSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEFAULT_SOURCE = "C:/Users/elmas/Downloads/Documento proyecto/Perfil ia";
const TARGET_DIR = join(REPO_ROOT, "config", "profiles");

// Filename fallback when the upstream file lacks a rol-id
// frontmatter (should not happen in practice; upstream is well-formed).
const FILENAME_FALLBACK = {
	"skill-orquestador.md": "orchestrator.md",
	"skill-supervisor-principal.md": "supervisor-main.md",
	"skill-supervisor-semantico.md": "supervisor-semantic.md",
	"skill-supervisor-compactacion.md": "supervisor-compaction.md",
	"skill-agentlab-general.md": "agentlab-general.md",
	"skill-agentlab-entendimiento.md": "agentlab-project-understanding.md",
	"skill-agentlab-ui-ux.md": "agentlab-ui-ux.md",
	"skill-agentlab-base-de-datos.md": "agentlab-database.md",
	"skill-agentlab-arquitectura.md": "agentlab-architecture.md",
	"skill-agentlab-documentacion.md": "agentlab-documentation.md",
	"skill-agentlab-calidad-codigo.md": "agentlab-code-quality.md",
	"skill-agentlab-performance.md": "agentlab-performance.md",
	"skill-agentlab-seguridad.md": "agentlab-security.md",
	"skill-agentlab-bibliotecario.md": "agentlab-bibliotecario.md",
};

function parseArgs(argv) {
	let source = DEFAULT_SOURCE;
	let dryRun = false;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--source") {
			const next = argv[i + 1];
			if (!next) throw new Error("--source requires a path");
			source = next;
			i++;
		} else if (a === "--dry-run") {
			dryRun = true;
		} else if (a === "--help" || a === "-h") {
			console.log(
				"Usage: node scripts/sync-profiles.mjs [--source <path>] [--dry-run]",
			);
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${a}`);
		}
	}
	return { source, dryRun };
}

function extractRolId(content, fallbackFile) {
	const match = /^---\r?\n[\s\S]*?rol-id:\s*([a-z0-9_-]+)/u.exec(content);
	if (match && match[1]) return match[1];
	const fallback = FILENAME_FALLBACK[fallbackFile];
	if (!fallback) {
		throw new Error(
			`Cannot resolve rol-id for ${fallbackFile}: frontmatter missing and no filename fallback.`,
		);
	}
	return fallback.replace(/\.md$/u, "");
}

function listSkillFiles(dir) {
	if (!existsSync(dir)) return [];
	const entries = readdirSync(dir);
	return entries.filter((name) => /^skill-.*\.md$/u.test(name));
}

function readSafe(path) {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return "";
	}
}

function same(a, b) {
	return a.replace(/\r\n/gu, "\n") === b.replace(/\r\n/gu, "\n");
}

function main() {
	const { source, dryRun } = parseArgs(process.argv.slice(2));
	const sourceDir = resolve(source);
	if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
		throw new Error(`Source directory not found: ${sourceDir}`);
	}
	const files = listSkillFiles(sourceDir);
	if (files.length === 0) {
		console.log(`No skill-*.md files in ${sourceDir}`);
		process.exit(0);
	}
	let copied = 0;
	let unchanged = 0;
	let wouldCopy = 0;
	for (const file of files) {
		const sourcePath = join(sourceDir, file);
		const content = readFileSync(sourcePath, "utf8");
		const rolId = extractRolId(content, file);
		const targetFile = `${rolId}.md`;
		const targetPath = join(TARGET_DIR, targetFile);
		const existing = readSafe(targetPath);
		if (same(content, existing)) {
			unchanged += 1;
			continue;
		}
		if (dryRun) {
			wouldCopy += 1;
			console.log(`differs  ${file}  →  ${targetFile}`);
		} else {
			mkdirSync(TARGET_DIR, { recursive: true });
			writeFileSync(targetPath, content, "utf8");
			copied += 1;
			console.log(`copied    ${file}  →  ${targetFile}`);
		}
	}
	console.log("");
	console.log(
		`summary: ${copied} copied, ${unchanged} unchanged, ${wouldCopy} would-copy`,
	);
	if (dryRun && wouldCopy > 0) {
		console.log("Re-run without --dry-run to apply the changes.");
	}
}

try {
	main();
} catch (error) {
	console.error(`error: ${error.message}`);
	process.exit(1);
}

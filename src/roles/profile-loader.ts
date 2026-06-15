/**
 * role-profile-loader — T1.6+PR-3.
 *
 * Reads role profile markdown files from `config/profiles/<role-id>.md`
 * and exposes a typed `RoleProfile` to the rest of the role machinery.
 *
 * Each profile file has YAML-ish frontmatter (no third-party deps):
 *
 *   ---
 *   nombre: orchestrator
 *   rol-id: orchestrator
 *   tipo: orquestador
 *   modelo-defecto: (variable)
 *   ---
 *
 *   # Skill — Orquestador
 *
 *   ## Quién soy
 *   ...
 *
 *   ## Qué tengo prohibido
 *   - ...
 *   - ...
 *
 * The loader returns the full body, the frontmatter, and a parsed list
 * of prohibitions (bullet lines under the "Qué tengo prohibido"
 * section). Sections not needed by the loader (Qué leo, Qué produzco,
 * Cómo trabajo, Quién me despierta, Modelo) are returned in the raw
 * body for the caller to interpret.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type RoleType = "supervisor" | "agentlab" | "orquestador";

export type RoleProfileFrontmatter = {
	nombre: string;
	rolId: string;
	tipo: RoleType;
	modeloDefecto: string;
};

export type RoleProfile = RoleProfileFrontmatter & {
	body: string;
	prohibitions: string[];
	path: string;
};

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u;
const PROHIBICIONES_HEADING_RE =
	/^#{2,}\s*Qué tengo prohibido\s*$/gmu;
const LIST_ITEM_RE = /^\s*-\s+(.+?)\s*$/u;

function parseFrontmatter(raw: string): {
	frontmatter: Record<string, string>;
	body: string;
} {
	const match = FRONTMATTER_RE.exec(raw);
	if (!match) {
		return { frontmatter: {}, body: raw };
	}
	const [, fmBlock, body] = match;
	if (!fmBlock || body === undefined) {
		return { frontmatter: {}, body: raw };
	}
	const frontmatter: Record<string, string> = {};
	for (const line of fmBlock.split(/\r?\n/u)) {
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const key = line.slice(0, colon).trim();
		const value = line.slice(colon + 1).trim();
		if (key.length > 0) {
			frontmatter[key] = value;
		}
	}
	return { frontmatter, body };
}

function parseProhibitions(body: string): string[] {
	const headingMatches: number[] = [];
	PROHIBICIONES_HEADING_RE.lastIndex = -1;
	let m: RegExpExecArray | null;
	while ((m = PROHIBICIONES_HEADING_RE.exec(body)) !== null) {
		headingMatches.push(m.index);
	}
	if (headingMatches.length === 0) return [];
	// Take the last "Qué tengo prohibido" heading (most specific)
	const start = headingMatches[headingMatches.length - 1] ?? 0;
	// Find next heading of same or higher level
	const tail = body.slice(start);
	const endMatch = /\r?\n#{1,2}\s+/u.exec(tail);
	const section = endMatch ? tail.slice(0, endMatch.index) : tail;
	const items: string[] = [];
	for (const line of section.split(/\r?\n/u)) {
		const itemMatch = LIST_ITEM_RE.exec(line);
		if (itemMatch && itemMatch[1]) {
			items.push(itemMatch[1].trim());
		}
	}
	return items;
}

function resolveProfilesDir(): string {
	// Works for both `src/roles/profile-loader.ts` (dev) and
	// `dist/src/roles/profile-loader.js` (compiled). We try a list
	// of candidate locations because the profiles live at the repo
	// root (`config/profiles/`) and the compiled dist lives at
	// `dist/src/roles/`, so the relative path differs.
	let here: string;
	if (typeof __dirname === "string") {
		here = __dirname;
	} else {
		// ESM context
		here = dirname(fileURLToPath(import.meta.url));
	}
	const candidates = [
		resolve(here, "..", "..", "config", "profiles"),
		resolve(here, "..", "..", "..", "config", "profiles"),
		resolve(here, "..", "..", "..", "..", "config", "profiles"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	// Fall back to the most likely dev location for a clear error.
	return candidates[0] ?? "";
}

export function loadRoleProfile(roleId: string): RoleProfile {
	const profilesDir = resolveProfilesDir();
	const path = join(profilesDir, `${roleId}.md`);
	if (!existsSync(path)) {
		throw new Error(
			`Role profile not found: ${roleId} (looked at ${path})`,
		);
	}
	const raw = readFileSync(path, "utf8");
	const { frontmatter, body } = parseFrontmatter(raw);
	const prohibitions = parseProhibitions(body);
	const tipoRaw = (frontmatter.tipo ?? "").toLowerCase();
	const tipo: RoleType =
		tipoRaw === "supervisor" || tipoRaw === "agentlab" || tipoRaw === "orquestador"
			? (tipoRaw as RoleType)
			: "agentlab";
	return {
		nombre: frontmatter.nombre ?? roleId,
		rolId: frontmatter["rol-id"] ?? roleId,
		tipo,
		modeloDefecto: frontmatter["modelo-defecto"] ?? "",
		body,
		prohibitions,
		path,
	};
}

export function listAvailableRoleProfiles(): string[] {
	const profilesDir = resolveProfilesDir();
	const entries = readdirSync(profilesDir);
	return entries
		.filter((entry) => entry.endsWith(".md") && entry !== "README.md")
		.map((entry) => entry.replace(/\.md$/u, ""));
}

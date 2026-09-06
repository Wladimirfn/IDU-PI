import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type SyncProjectConfigInput = {
	repoRoot: string;
	stateRoot: string;
};

export type SyncProjectConfigResult = {
	copied: number;
	skipped: number;
	files: string[];
};

const SYNCED_FILES = ["project-core.json", "project-constitution.json", "project-blueprint.json", "project-flows.json"] as const;

function assertSafeStateRoot(stateRoot: string): void {
	if (typeof stateRoot !== "string" || stateRoot.length === 0) {
		throw new Error("stateRoot inválido: vacío");
	}
	if (stateRoot.includes("..") || stateRoot.includes("\0")) {
		throw new Error("stateRoot inválido: contiene '..' o null byte");
	}
}

export function syncProjectConfigToStateRoot(
	input: SyncProjectConfigInput,
): SyncProjectConfigResult {
	assertSafeStateRoot(input.stateRoot);
	// Territory model: project-local governance lives under <repo>/.idu/config/.
	const srcDir = join(input.repoRoot, ".idu", "config");
	const dstDir = join(input.stateRoot, "config");

	if (!existsSync(srcDir)) {
		return { copied: 0, skipped: 0, files: [] };
	}

	mkdirSync(dstDir, { recursive: true });

	let copied = 0;
	let skipped = 0;
	const files: string[] = [];

	for (const name of SYNCED_FILES) {
		const srcPath = join(srcDir, name);
		const dstPath = join(dstDir, name);
		if (!existsSync(srcPath)) continue;
		const src = readFileSync(srcPath, "utf8");
		if (existsSync(dstPath)) {
			const dst = readFileSync(dstPath, "utf8");
			if (dst === src) {
				skipped += 1;
				files.push(`${name}=skipped`);
				continue;
			}
		}
		writeFileSync(dstPath, src, "utf8");
		copied += 1;
		files.push(`${name}=copied`);
	}

	return { copied, skipped, files };
}

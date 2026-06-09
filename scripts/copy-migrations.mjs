#!/usr/bin/env node
/**
 * Copies the SQL migration files from src/lab-db/migrations to
 * dist/src/lab-db/migrations so the compiled runner can find them at
 * runtime. tsc does not copy non-TS files; without this step the
 * migration runner cannot load the .sql content.
 *
 * This script is idempotent and safe to run repeatedly.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const sourceDir = join(repoRoot, "src", "lab-db", "migrations");
const destDir = join(repoRoot, "dist", "src", "lab-db", "migrations");

if (!existsSync(sourceDir)) {
	process.stderr.write(
		`copy-migrations: source directory not found: ${sourceDir}\n`,
	);
	process.exit(1);
}

mkdirSync(destDir, { recursive: true });
let copied = 0;
for (const name of readdirSync(sourceDir)) {
	if (!/^\d{4}_[a-z0-9_-]+\.sql$/u.test(name)) continue;
	copyFileSync(join(sourceDir, name), join(destDir, name));
	copied += 1;
}
process.stdout.write(`copy-migrations: copied ${copied} sql file(s)\n`);

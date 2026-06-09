import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Returns the directory that contains the migration `.sql` files at
 * runtime. When this file is compiled to JavaScript, `import.meta.url`
 * points to the compiled `.js` file inside `dist/`. The migration
 * directory lives next to it (sibling of `runner.js` / `index.js`).
 */
function migrationsDir(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return resolve(here, ".");
}

export function listMigrations(): string[] {
	const dir = migrationsDir();
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return [];
	}
	return entries
		.filter((name) => /^\d{4}_[a-z0-9_-]+\.sql$/u.test(name))
		.sort();
}

export function loadMigrationFile(name: string): string {
	if (!/^\d{4}_[a-z0-9_-]+\.sql$/u.test(name)) {
		throw new Error(`invalid migration name: ${name}`);
	}
	const path = join(migrationsDir(), name);
	return readFileSync(path, "utf8");
}

export function migrationPath(name: string): string {
	if (!/^\d{4}_[a-z0-9_-]+\.sql$/u.test(name)) {
		throw new Error(`invalid migration name: ${name}`);
	}
	return join(migrationsDir(), name);
}

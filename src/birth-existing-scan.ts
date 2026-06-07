import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";

export type BirthExistingScanObserved = {
	packageManager: "pnpm" | "yarn" | "npm" | "unknown";
	languages: string[];
	frameworks: string[];
	tests: string[];
	docs: string[];
	styles: string[];
	assets: string[];
};

export type BirthExistingScanApproval = {
	status: "draft" | "approved";
	approvedBy?: string;
	approvedAt?: string;
};

export type BirthExistingScan = {
	version: 1;
	scanId: string;
	projectId: string;
	mode: "existing_project";
	observed: BirthExistingScanObserved;
	risks: string[];
	approval: BirthExistingScanApproval;
};

export type BirthDetectedSpec = {
	category: "stack" | "architecture" | "visual" | "test" | "doc";
	value: string;
};

export type BirthDetectedSpecs = {
	version: 1;
	projectId: string;
	derivedFromScanId: string;
	status: "draft" | "approved";
	detected: {
		stack: string[];
		architecturePatterns: string[];
		visualPatterns: string[];
		testPatterns: string[];
	};
	contradictions: string[];
	approval: BirthExistingScanApproval;
};

export type BirthExistingScanResult = {
	scan: BirthExistingScan;
	detectedSpecs: BirthDetectedSpecs;
};

const IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	".next",
	"coverage",
	"build",
	"out",
	".turbo",
	"target",
]);

const MAX_DEPTH = 6;
const MAX_ENTRIES = 2_000;

export function scanExistingProject(input: {
	projectPath: string;
	projectId: string;
}): BirthExistingScanResult {
	const { projectPath, projectId } = input;
	const scanId = `birth-scan-${Date.now().toString(36)}`;

	const observed: BirthExistingScanObserved = {
		packageManager: detectPackageManager(projectPath),
		languages: [],
		frameworks: [],
		tests: [],
		docs: [],
		styles: [],
		assets: [],
	};
	const risks: string[] = [];

	let visited = 0;
	walk(projectPath, "", 0, (relPath, isDir) => {
		visited++;
		if (visited > MAX_ENTRIES) return;
		if (isDir) return;
		const ext = extname(relPath).toLowerCase();
		const base = relPath.toLowerCase();
		if (ext === ".ts" || ext === ".tsx") {
			if (!observed.languages.includes("TypeScript")) {
				observed.languages.push("TypeScript");
			}
		}
		if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") {
			if (!observed.languages.includes("JavaScript")) {
				observed.languages.push("JavaScript");
			}
		}
		if (ext === ".py") observed.languages.push("Python");
		if (
			ext === ".css" ||
			ext === ".scss" ||
			ext === ".sass" ||
			ext === ".less"
		) {
			observed.styles.push(relPath);
		}
		if (
			ext === ".svg" ||
			ext === ".png" ||
			ext === ".jpg" ||
			ext === ".jpeg" ||
			ext === ".webp" ||
			ext === ".gif"
		) {
			observed.assets.push(relPath);
		}
		if (ext === ".md" || ext === ".mdx" || ext === ".txt" || ext === ".pdf") {
			observed.docs.push(relPath);
		}
		if (
			base.endsWith(".test.ts") ||
			base.endsWith(".test.js") ||
			base.endsWith(".spec.ts") ||
			base.endsWith(".spec.js") ||
			base.startsWith("test/")
		) {
			observed.tests.push(relPath);
		}
	});

	if (observed.tests.length === 0) {
		risks.push(
			"No test files detected; existing-project scan reports zero coverage evidence.",
		);
	}
	if (observed.docs.length === 0) {
		risks.push("No documentation files detected.");
	}

	// Frameworks from package.json dependencies
	const frameworks = detectFrameworksFromPackageJson(projectPath);
	for (const f of frameworks) {
		if (!observed.frameworks.includes(f)) observed.frameworks.push(f);
	}

	const scan: BirthExistingScan = {
		version: 1,
		scanId,
		projectId,
		mode: "existing_project",
		observed,
		risks,
		approval: { status: "draft" },
	};

	const detectedSpecs = deriveDetectedSpecs(scan);

	return { scan, detectedSpecs };
}

function deriveDetectedSpecs(scan: BirthExistingScan): BirthDetectedSpecs {
	const stack = [
		...scan.observed.languages,
		scan.observed.packageManager !== "unknown"
			? scan.observed.packageManager
			: null,
		...scan.observed.frameworks,
	].filter((x): x is string => Boolean(x));

	const architecturePatterns: string[] = [];
	if (scan.observed.tests.length > 0) {
		architecturePatterns.push("test_aware_layout");
	}

	const testPatterns: string[] = [];
	if (scan.observed.tests.length > 0) {
		testPatterns.push("node_test_runner");
	}

	return {
		version: 1,
		projectId: scan.projectId,
		derivedFromScanId: scan.scanId,
		status: "draft",
		detected: {
			stack,
			architecturePatterns,
			visualPatterns: [],
			testPatterns,
		},
		contradictions: [],
		approval: { status: "draft" },
	};
}

function detectPackageManager(
	projectPath: string,
): BirthExistingScanObserved["packageManager"] {
	if (existsSync(join(projectPath, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(join(projectPath, "yarn.lock"))) return "yarn";
	if (existsSync(join(projectPath, "package-lock.json"))) return "npm";
	return "unknown";
}

function detectFrameworksFromPackageJson(projectPath: string): string[] {
	const pkgPath = join(projectPath, "package.json");
	if (!existsSync(pkgPath)) return [];
	let raw: string;
	try {
		raw = readFileSync(pkgPath, "utf8");
	} catch {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (typeof parsed !== "object" || parsed === null) return [];
	const record = parsed as Record<string, unknown>;
	const deps: Record<string, unknown> = {
		...((record.dependencies as Record<string, unknown> | undefined) ?? {}),
		...((record.devDependencies as Record<string, unknown> | undefined) ?? {}),
	};
	const known = [
		"typescript",
		"react",
		"vue",
		"svelte",
		"next",
		"express",
		"fastify",
		"@supabase/supabase-js",
	];
	return known.filter((k) => typeof deps[k] === "string");
}

function walk(
	root: string,
	prefix: string,
	depth: number,
	visitor: (rel: string, isDir: boolean) => void,
): void {
	if (depth > MAX_DEPTH) return;
	let entries: string[];
	try {
		entries = readdirSync(root);
	} catch {
		return;
	}
	for (const entry of entries) {
		const abs = join(root, entry);
		const rel = prefix ? `${prefix}/${entry}` : entry;
		let isDir = false;
		try {
			isDir = statSync(abs).isDirectory();
		} catch {
			continue;
		}
		if (isDir) {
			if (IGNORED_DIRS.has(entry)) continue;
			visitor(rel, true);
			walk(abs, rel, depth + 1, visitor);
		} else {
			visitor(rel, false);
		}
	}
}

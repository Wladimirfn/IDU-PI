import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

export type ExternalIntelligenceSourceId =
	| "nodejs-releases"
	| "nextjs-releases"
	| "npm-advisories";

export type ExternalIntelligenceSourceKind =
	| "changelog"
	| "advisory"
	| "npm_advisory"
	| "github_advisory";

export type ExternalIntelligenceSignal = {
	sourceId: ExternalIntelligenceSourceId;
	sourceKind: ExternalIntelligenceSourceKind;
	title: string;
	url: string;
	observedAt: string;
	publishedAt?: string;
	severity?: "info" | "low" | "moderate" | "high" | "critical";
	ecosystem: "node" | "npm" | "nextjs";
	packageName?: "node" | "npm" | "next";
	versionRange?: string;
	summary: string;
	evidenceRef: string;
	confidence: "low" | "medium" | "high";
	recommendedAction: "review" | "monitor" | "plan_feasibility_check";
	contractPromotionAllowed: false;
};

export type ExternalIntelligenceSourceStatus = {
	id: ExternalIntelligenceSourceId;
	url: string;
	status: "ok" | "failed" | "skipped";
	error?: string;
};

export type ExternalIntelligenceReport = {
	version: 1;
	projectId: string;
	generatedAt: string;
	mode: "advisory_only";
	allowlistVersion: 1;
	sourcesQueried: ExternalIntelligenceSourceStatus[];
	signals: ExternalIntelligenceSignal[];
	limitations: string[];
	stateRootOnly: true;
	rawContentStored: false;
	autoDependencyUpdatesAllowed: false;
	agentLabAutoRunAllowed: false;
	remoteAnalyticsAllowed: false;
	contractPromotionAllowed: false;
};

export type ExternalIntelligenceFetchResponse = {
	ok: boolean;
	status: number;
	url?: string;
	text: () => Promise<string>;
};

export type ExternalIntelligenceFetch = (
	url: string,
	init?: { signal?: AbortSignal },
) => Promise<ExternalIntelligenceFetchResponse>;

type ExternalIntelligenceSource = {
	id: ExternalIntelligenceSourceId;
	kind: ExternalIntelligenceSourceKind;
	url: string;
	host: string;
	pathPrefix: string;
	maxBytes: number;
	ecosystem: "node" | "npm" | "nextjs";
	packageName: "node" | "npm" | "next";
	supported: boolean;
	skipReason?: string;
};

const ALLOWLIST_VERSION = 1;
const DEFAULT_SOURCE_IDS: ExternalIntelligenceSourceId[] = [
	"nodejs-releases",
	"nextjs-releases",
	"npm-advisories",
];

const SOURCES: Record<
	ExternalIntelligenceSourceId,
	ExternalIntelligenceSource
> = {
	"nodejs-releases": {
		id: "nodejs-releases",
		kind: "changelog",
		url: "https://nodejs.org/dist/index.json",
		host: "nodejs.org",
		pathPrefix: "/dist/index.json",
		maxBytes: 256_000,
		ecosystem: "node",
		packageName: "node",
		supported: true,
	},
	"nextjs-releases": {
		id: "nextjs-releases",
		kind: "github_advisory",
		url: "https://api.github.com/repos/vercel/next.js/releases",
		host: "api.github.com",
		pathPrefix: "/repos/vercel/next.js/releases",
		maxBytes: 256_000,
		ecosystem: "nextjs",
		packageName: "next",
		supported: true,
	},
	"npm-advisories": {
		id: "npm-advisories",
		kind: "npm_advisory",
		url: "unsupported:npm-advisories",
		host: "unsupported",
		pathPrefix: "unsupported:npm-advisories",
		maxBytes: 0,
		ecosystem: "npm",
		packageName: "npm",
		supported: false,
		skipReason:
			"npm advisories source is intentionally skipped until a stable public allowlisted endpoint is selected.",
	},
};

export async function buildExternalIntelligenceReport(input: {
	projectId: string;
	sourceIds?: string[];
	fetcher?: ExternalIntelligenceFetch;
	now?: () => Date;
}): Promise<ExternalIntelligenceReport> {
	const observedAt = (input.now?.() ?? new Date()).toISOString();
	const sourceIds = normalizeSourceIds(input.sourceIds);
	const fetcher = input.fetcher ?? defaultFetch;
	const sourcesQueried: ExternalIntelligenceSourceStatus[] = [];
	const signals: ExternalIntelligenceSignal[] = [];
	const limitations: string[] = [
		"Advisory-only: external signals inform feasibility and risk; they do not approve plans or contracts.",
		"Exact source-id allowlist only; no arbitrary URL input and no free web browsing.",
		"Reports store normalized metadata/signals only, never raw response bodies, prompts, docs, request metadata, credentials, metering data, or analytics.",
		"No dependency updates, AgentLab execution, or contract promotion are performed.",
	];

	for (const sourceId of sourceIds) {
		const source = SOURCES[sourceId];
		if (!source.supported) {
			sourcesQueried.push({
				id: source.id,
				url: source.url,
				status: "skipped",
				error: source.skipReason,
			});
			limitations.push(source.skipReason ?? `${source.id} skipped.`);
			continue;
		}
		try {
			assertAllowlistedUrl(source.url, source);
			const response = await fetcher(source.url);
			if (response.url) assertAllowlistedUrl(response.url, source);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			const body = await readCappedText(response, source.maxBytes);
			const parsed = parseJsonArray(body);
			const sourceSignals = normalizeSignals({
				source,
				items: parsed,
				observedAt,
			});
			signals.push(...sourceSignals);
			sourcesQueried.push({
				id: source.id,
				url: source.url,
				status: "ok",
			});
		} catch (error) {
			sourcesQueried.push({
				id: source.id,
				url: source.url,
				status: "failed",
				error: safeError(error),
			});
			limitations.push(`${source.id} failed: ${safeError(error)}`);
		}
	}

	return {
		version: 1,
		projectId: sanitizeProjectId(input.projectId),
		generatedAt: observedAt,
		mode: "advisory_only",
		allowlistVersion: ALLOWLIST_VERSION,
		sourcesQueried,
		signals,
		limitations,
		stateRootOnly: true,
		rawContentStored: false,
		autoDependencyUpdatesAllowed: false,
		agentLabAutoRunAllowed: false,
		remoteAnalyticsAllowed: false,
		contractPromotionAllowed: false,
	};
}

export function externalIntelligenceReportPaths(stateRoot: string): {
	root: string;
	currentPath: string;
} {
	const root = resolve(stateRoot, "reports", "external-intelligence");
	return {
		root,
		currentPath: join(root, "current.json"),
	};
}

export function writeExternalIntelligenceReport(input: {
	stateRoot: string;
	report: ExternalIntelligenceReport;
	now?: () => Date;
}): { root: string; currentPath: string; historyPath: string } {
	const paths = externalIntelligenceReportPaths(input.stateRoot);
	const stamp = formatTimestamp(input.now?.() ?? new Date());
	const historyPath = join(paths.root, `external-intelligence-${stamp}.json`);
	assertUnderStateRoot(input.stateRoot, paths.root);
	assertUnderStateRoot(input.stateRoot, paths.currentPath);
	assertUnderStateRoot(input.stateRoot, historyPath);
	mkdirSync(paths.root, { recursive: true });
	const content = `${JSON.stringify(input.report, null, 2)}\n`;
	writeFileSync(paths.currentPath, content, "utf8");
	writeFileSync(historyPath, content, "utf8");
	return { ...paths, historyPath };
}

function normalizeSourceIds(
	sourceIds: string[] | undefined,
): ExternalIntelligenceSourceId[] {
	const values = sourceIds?.length ? sourceIds : DEFAULT_SOURCE_IDS;
	return values.map((sourceId) => {
		if (!isExternalIntelligenceSourceId(sourceId)) {
			throw new Error(
				`Unsupported external intelligence source id: ${sourceId}`,
			);
		}
		return sourceId;
	});
}

function isExternalIntelligenceSourceId(
	value: string,
): value is ExternalIntelligenceSourceId {
	return Object.hasOwn(SOURCES, value);
}

function assertAllowlistedUrl(
	url: string,
	source: ExternalIntelligenceSource,
): void {
	const parsed = new URL(url);
	if (parsed.protocol !== "https:") {
		throw new Error(`non-allowlisted protocol for ${source.id}`);
	}
	if (
		parsed.host !== source.host ||
		!parsed.pathname.startsWith(source.pathPrefix)
	) {
		throw new Error(`non-allowlisted redirect for ${source.id}`);
	}
}

async function readCappedText(
	response: ExternalIntelligenceFetchResponse,
	maxBytes: number,
): Promise<string> {
	const text = await response.text();
	return text.length > maxBytes ? text.slice(0, maxBytes) : text;
}

function parseJsonArray(body: string): unknown[] {
	const parsed: unknown = JSON.parse(body);
	return Array.isArray(parsed) ? parsed : [];
}

function normalizeSignals(input: {
	source: ExternalIntelligenceSource;
	items: unknown[];
	observedAt: string;
}): ExternalIntelligenceSignal[] {
	return input.items
		.slice(0, 10)
		.flatMap((item, index) =>
			normalizeSignal(input.source, item, index, input.observedAt),
		);
}

function normalizeSignal(
	source: ExternalIntelligenceSource,
	item: unknown,
	index: number,
	observedAt: string,
): ExternalIntelligenceSignal[] {
	if (!isRecord(item)) return [];
	const title = bounded(
		stringField(item, "version") ??
			stringField(item, "name") ??
			stringField(item, "tag_name") ??
			`${source.id}-${index + 1}`,
		120,
	);
	const publishedAt =
		stringField(item, "date") ?? stringField(item, "published_at");
	const security = booleanField(item, "security");
	const versionRange = bounded(
		stringField(item, "version") ?? stringField(item, "tag_name") ?? title,
		80,
	);
	const severity = security ? "high" : "info";
	const evidenceHash = createHash("sha256")
		.update(`${source.id}:${title}:${publishedAt ?? ""}`)
		.digest("hex")
		.slice(0, 12);
	return [
		{
			sourceId: source.id,
			sourceKind: source.kind,
			title,
			url: source.url,
			observedAt,
			...(publishedAt ? { publishedAt } : {}),
			severity,
			ecosystem: source.ecosystem,
			packageName: source.packageName,
			versionRange,
			summary: `${source.packageName} release signal ${title}${security ? " includes a security marker" : " observed"}.`,
			evidenceRef: `${source.id}:${evidenceHash}`,
			confidence: "high",
			recommendedAction: security ? "review" : "monitor",
			contractPromotionAllowed: false,
		},
	];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
	record: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
	return record[key] === true;
}

function bounded(value: string, max: number): string {
	return value.length > max ? value.slice(0, max) : value;
}

async function defaultFetch(
	url: string,
	init?: { signal?: AbortSignal },
): Promise<ExternalIntelligenceFetchResponse> {
	if (typeof fetch !== "function") {
		throw new Error("global fetch unavailable");
	}
	return fetch(url, init) as Promise<ExternalIntelligenceFetchResponse>;
}

function sanitizeProjectId(projectId: string): string {
	return projectId
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/giu, "_");
}

function safeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function formatTimestamp(date: Date): string {
	return date
		.toISOString()
		.replace(/[-:]/gu, "")
		.replace(/\.\d{3}Z$/u, "Z");
}

function assertUnderStateRoot(stateRoot: string, targetPath: string): void {
	const root = resolve(stateRoot);
	const target = resolve(targetPath);
	if (
		!(
			target === root ||
			target.startsWith(`${root}\\`) ||
			target.startsWith(`${root}/`)
		)
	) {
		throw new Error("external intelligence report path escapes stateRoot");
	}
}

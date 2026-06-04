import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	buildExternalIntelligenceReport,
	externalIntelligenceReportPaths,
	writeExternalIntelligenceReport,
	type ExternalIntelligenceFetch,
} from "../src/external-intelligence.js";

const now = () => new Date("2026-06-04T12:00:00.000Z");

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-external-intelligence-"));
}

test("external intelligence uses exact source allowlist and fake fetch only", async () => {
	const calls: string[] = [];
	const fetcher: ExternalIntelligenceFetch = async (url) => {
		calls.push(url);
		return {
			ok: true,
			status: 200,
			url,
			text: async () =>
				JSON.stringify([
					{
						version: "v24.1.0",
						date: "2026-06-01",
						security: true,
						npm: "11.4.0",
						rawSecret: "RAW NODE BODY MUST NOT BE STORED",
					},
				]),
		};
	};

	const report = await buildExternalIntelligenceReport({
		projectId: "Demo",
		sourceIds: ["nodejs-releases", "npm-advisories"],
		fetcher,
		now,
	});

	assert.deepEqual(calls, ["https://nodejs.org/dist/index.json"]);
	assert.equal(report.mode, "advisory_only");
	assert.equal(report.stateRootOnly, true);
	assert.equal(report.rawContentStored, false);
	assert.equal(report.autoDependencyUpdatesAllowed, false);
	assert.equal(report.agentLabAutoRunAllowed, false);
	assert.equal(report.remoteAnalyticsAllowed, false);
	assert.equal(report.contractPromotionAllowed, false);
	assert.ok(
		report.signals.some((signal) => signal.sourceId === "nodejs-releases"),
	);
	assert.ok(
		report.sourcesQueried.some(
			(source) => source.id === "npm-advisories" && source.status === "skipped",
		),
	);
	const serialized = JSON.stringify(report);
	assert.equal(serialized.includes("RAW NODE BODY MUST NOT BE STORED"), false);
	assert.equal(serialized.includes("headers"), false);
	assert.equal(serialized.includes("tokens"), false);
});

test("external intelligence rejects arbitrary source ids and unsafe redirects", async () => {
	await assert.rejects(
		() =>
			buildExternalIntelligenceReport({
				projectId: "Demo",
				sourceIds: ["https://evil.example/advisory"],
				fetcher: async () => ({
					ok: true,
					status: 200,
					text: async () => "[]",
				}),
				now,
			}),
		/Unsupported external intelligence source id/u,
	);

	const report = await buildExternalIntelligenceReport({
		projectId: "Demo",
		sourceIds: ["nodejs-releases"],
		fetcher: async (url) => ({
			ok: true,
			status: 200,
			url: "https://evil.example/redirected.json",
			text: async () => `[{"version":"v24.1.0","source":"${url}"}]`,
		}),
		now,
	});

	assert.equal(report.signals.length, 0);
	assert.ok(
		report.sourcesQueried.some(
			(source) =>
				source.status === "failed" &&
				/non-allowlisted redirect/u.test(source.error ?? ""),
		),
	);
});

test("external intelligence writes normalized reports only under stateRoot", async () => {
	const root = tempRoot();
	try {
		const report = await buildExternalIntelligenceReport({
			projectId: "Demo Project",
			sourceIds: ["nextjs-releases"],
			fetcher: async (url) => ({
				ok: true,
				status: 200,
				url,
				text: async () =>
					JSON.stringify([
						{
							name: "v16.0.0",
							tag_name: "v16.0.0",
							published_at: "2026-06-02T00:00:00.000Z",
							body: "RAW NEXT RELEASE BODY MUST NOT BE STORED",
						},
					]),
			}),
			now,
		});
		const paths = writeExternalIntelligenceReport({
			stateRoot: root,
			report,
			now,
		});
		const expected = externalIntelligenceReportPaths(root);

		assert.equal(paths.currentPath, expected.currentPath);
		assert.ok(paths.historyPath.startsWith(expected.root));
		assert.ok(existsSync(paths.currentPath));
		assert.ok(existsSync(paths.historyPath));
		const persisted = readFileSync(paths.currentPath, "utf8");
		assert.equal(
			persisted.includes("RAW NEXT RELEASE BODY MUST NOT BE STORED"),
			false,
		);
		assert.equal(persisted.includes("v16.0.0"), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

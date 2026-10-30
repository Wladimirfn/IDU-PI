import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	arbitrate,
	arbitrateDeterministically,
	arbitrateWithJev,
	looksLikeHighRiskMitigation,
	normalizeThreshold,
	redactErrorDetail,
	resolveTypeSafeApiKey,
	type ArbitrationInput,
} from "../src/arbitration.js";

const sampleInput: ArbitrationInput = {
	stateSummary: "Se completaron 4 PRs. Queda 403.css listo y soporte.css con deuda de dark mode.",
	options: [
		{
			id: "continuar_403",
			description: "Tokenizar 403.css, cambio autocontenido de bajo riesgo.",
			isHighRiskMitigation: false,
		},
		{
			id: "resolver_deuda_cross_file",
			description: "Modelar dark mode cross-file en temas.css para evitar regresiones de pixel.",
			isHighRiskMitigation: true,
		},
	],
};

test("resolveTypeSafeApiKey returns explicit key when provided", () => {
	const key = resolveTypeSafeApiKey("my-explicit-key");
	assert.equal(key, "my-explicit-key");
});

test("resolveTypeSafeApiKey reads from environment variables", () => {
	const prev = process.env.TYPESAFE_API_KEY;
	try {
		process.env.TYPESAFE_API_KEY = "env-test-key";
		const key = resolveTypeSafeApiKey();
		assert.equal(key, "env-test-key");
	} finally {
		if (prev === undefined) {
			delete process.env.TYPESAFE_API_KEY;
		} else {
			process.env.TYPESAFE_API_KEY = prev;
		}
	}
});

test("resolveTypeSafeApiKey reads from local .env file", () => {
	const prevTypesafe = process.env.TYPESAFE_API_KEY;
	const prevJev = process.env.JEV_API_KEY;
	delete process.env.TYPESAFE_API_KEY;
	delete process.env.JEV_API_KEY;

	const tempDir = mkdtempSync(join(tmpdir(), "idu-env-test-"));
	try {
		writeFileSync(join(tempDir, ".env"), "TYPESAFE_API_KEY=\"dotenv-secret-key\"\n", "utf8");
		const key = resolveTypeSafeApiKey(undefined, tempDir);
		assert.equal(key, "dotenv-secret-key");
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
		if (prevTypesafe) process.env.TYPESAFE_API_KEY = prevTypesafe;
		if (prevJev) process.env.JEV_API_KEY = prevJev;
	}
});

test("resolveTypeSafeApiKey climbs up directory tree to find .env in parent", () => {
	const prevTypesafe = process.env.TYPESAFE_API_KEY;
	const prevJev = process.env.JEV_API_KEY;
	delete process.env.TYPESAFE_API_KEY;
	delete process.env.JEV_API_KEY;

	const tempDir = mkdtempSync(join(tmpdir(), "idu-env-climb-"));
	const deepDir = join(tempDir, "worktree", "nested", "subdir");
	try {
		writeFileSync(join(tempDir, ".env"), "TYPESAFE_API_KEY=\"parent-tree-secret-key\"\n", "utf8");
		mkdirSync(deepDir, { recursive: true });
		const key = resolveTypeSafeApiKey(undefined, deepDir);
		assert.equal(key, "parent-tree-secret-key");
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
		if (prevTypesafe) process.env.TYPESAFE_API_KEY = prevTypesafe;
		if (prevJev) process.env.JEV_API_KEY = prevJev;
	}
});

test("resolveTypeSafeApiKey never reads a .env above the git root (S5)", () => {
	const prevTypesafe = process.env.TYPESAFE_API_KEY;
	const prevJev = process.env.JEV_API_KEY;
	delete process.env.TYPESAFE_API_KEY;
	delete process.env.JEV_API_KEY;

	const tempDir = mkdtempSync(join(tmpdir(), "idu-env-gitroot-"));
	const gitRoot = join(tempDir, "repo");
	const deepDir = join(gitRoot, "src", "deep");
	try {
		writeFileSync(join(tempDir, ".env"), "TYPESAFE_API_KEY=\"secret-above-git-root\"\n", "utf8");
		mkdirSync(deepDir, { recursive: true });
		writeFileSync(join(gitRoot, ".git"), "", "utf8");
		assert.equal(resolveTypeSafeApiKey(undefined, deepDir), undefined, "the .env one level above the git root must not be read");
		writeFileSync(join(gitRoot, ".env"), "TYPESAFE_API_KEY=\"inside-git-root\"\n", "utf8");
		assert.equal(resolveTypeSafeApiKey(undefined, deepDir), "inside-git-root", "the .env inside the git root must still resolve");
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
		if (prevTypesafe) process.env.TYPESAFE_API_KEY = prevTypesafe;
		if (prevJev) process.env.JEV_API_KEY = prevJev;
	}
});

test("arbitrateDeterministically chooses high-risk mitigation first", () => {
	const decision = arbitrateDeterministically(sampleInput);
	assert.equal(decision.selectedOptionId, "resolver_deuda_cross_file");
	assert.equal(decision.source, "deterministic_fallback");
	assert.equal(decision.requiresHumanReview, false);
	assert.equal(decision.confidence, 1.0);
});

test("arbitrateDeterministically falls back to sequential order if no high-risk option", () => {
	const inputNoRisk: ArbitrationInput = {
		stateSummary: "Tareas regulares sin riesgo de regresión.",
		options: [
			{ id: "task_a", description: "Hacer A" },
			{ id: "task_b", description: "Hacer B" },
		],
	};
	const decision = arbitrateDeterministically(inputNoRisk);
	assert.equal(decision.selectedOptionId, "task_a");
	assert.equal(decision.source, "deterministic_fallback");
	assert.equal(decision.confidence, 0.8);
	assert.equal(decision.requiresHumanReview, true, "sequential policy confidence 0.8 is below the default 0.85 threshold");
});

test("arbitrate never sends the cloud key to an insecure (non-https) endpoint (S2)", async () => {
	const prevEndpoint = process.env.TYPESAFE_ENDPOINT;
	process.env.TYPESAFE_ENDPOINT = "http://evil.example.com/v1/systemone";

	const requestedUrls: string[] = [];
	const mockFetch = async (url: string | URL | Request) => {
		const urlStr = String(url);
		requestedUrls.push(urlStr);
		if (urlStr.includes("api.typesafe.ai")) {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					answers: {
						next_action: {
							choice: "continuar_403",
							confidence: 0.9,
						},
					},
				}),
			} as Response;
		}
		return { ok: false, status: 404 } as Response;
	};

	try {
		const decision = await arbitrate({
			...sampleInput,
			apiKey: "cloud-secret-key",
			fetchFn: mockFetch as unknown as typeof fetch,
		});
		assert.equal(decision.source, "jev_cloud");
		assert.ok(
			requestedUrls.every((u) => !u.includes("evil.example.com")),
			"the insecure endpoint must never be contacted with the key present",
		);
	} finally {
		if (prevEndpoint === undefined) delete process.env.TYPESAFE_ENDPOINT;
		else process.env.TYPESAFE_ENDPOINT = prevEndpoint;
	}
});

test("arbitrateDeterministically escalates when threshold exceeds nominal confidence", () => {
	const noRiskInput: ArbitrationInput = {
		stateSummary: "Tareas regulares sin riesgo de regresión.",
		options: [
			{ id: "task_a", description: "Hacer A" },
			{ id: "task_b", description: "Hacer B" },
		],
	};
	const sequential = arbitrateDeterministically({ ...noRiskInput, confidenceThreshold: 0.99 });
	assert.equal(sequential.selectedOptionId, "task_a");
	assert.equal(sequential.requiresHumanReview, true, "sequential policy confidence 0.8 must escalate when threshold is 0.99");

	const riskFirst = arbitrateDeterministically({ ...sampleInput, confidenceThreshold: 0.99 });
	assert.equal(riskFirst.requiresHumanReview, false, "risk-first policy confidence 1.0 legitimately meets a 0.99 threshold");
});

test("arbitrateDeterministically stays autonomous when threshold is at or below nominal confidence", () => {
	const low = arbitrateDeterministically({ ...sampleInput, confidenceThreshold: 0.8 });
	assert.equal(low.selectedOptionId, "resolver_deuda_cross_file");
	assert.equal(low.requiresHumanReview, false);
	const seq = arbitrateDeterministically({ ...sampleInput, confidenceThreshold: 0.85 });
	assert.equal(seq.selectedOptionId, "resolver_deuda_cross_file");
	assert.equal(seq.requiresHumanReview, false, "risk-first policy confidence 1.0 meets the 0.85 threshold");
});

test("arbitrateWithJev handles confident response autonomously without human escalation", async () => {
	const mockFetch = async () => {
		return {
			ok: true,
			status: 200,
			json: async () => ({
				model: "jev-1.13.0",
				answers: {
					next_action: {
						type: "choice",
						choice: "resolver_deuda_cross_file",
						confidence: 0.94,
						probabilities: {
							resolver_deuda_cross_file: 0.94,
							continuar_403: 0.06,
						},
					},
				},
				usage: { input_tokens: 150, output_tokens: 20 },
			}),
		} as Response;
	};

	const decision = await arbitrateWithJev(
		{ ...sampleInput, fetchFn: mockFetch as unknown as typeof fetch },
		"dummy-key",
	);

	assert.equal(decision.selectedOptionId, "resolver_deuda_cross_file");
	assert.equal(decision.confidence, 0.94);
	assert.equal(decision.source, "jev");
	assert.equal(decision.requiresHumanReview, false);
});

test("arbitrateWithJev flags requiresHumanReview when confidence is below threshold", async () => {
	const mockFetch = async () => {
		return {
			ok: true,
			status: 200,
			json: async () => ({
				model: "jev-1.13.0",
				answers: {
					next_action: {
						type: "choice",
						choice: "continuar_403",
						confidence: 0.52,
						probabilities: {
							continuar_403: 0.52,
							resolver_deuda_cross_file: 0.48,
						},
					},
				},
				usage: { input_tokens: 150, output_tokens: 20 },
			}),
		} as Response;
	};

	const decision = await arbitrateWithJev(
		{ ...sampleInput, confidenceThreshold: 0.85, fetchFn: mockFetch as unknown as typeof fetch },
		"dummy-key",
	);

	assert.equal(decision.selectedOptionId, "continuar_403");
	assert.equal(decision.confidence, 0.52);
	assert.equal(decision.source, "jev");
	assert.equal(decision.requiresHumanReview, true);
});

test("arbitrateWithJev falls back gracefully to deterministic logic on HTTP failure", async () => {
	const mockFetch = async () => {
		return {
			ok: false,
			status: 500,
			text: async () => "Internal server error",
		} as Response;
	};

	const decision = await arbitrateWithJev(
		{ ...sampleInput, fetchFn: mockFetch as unknown as typeof fetch },
		"dummy-key",
	);

	assert.equal(decision.selectedOptionId, "resolver_deuda_cross_file");
	assert.equal(decision.source, "deterministic_fallback");
	assert.match(decision.reason, /HTTP 500/);
});

test("arbitrate calls deterministic fallback when no API key exists and Kev is offline", async () => {
	const prevTypesafe = process.env.TYPESAFE_API_KEY;
	const prevJev = process.env.JEV_API_KEY;
	delete process.env.TYPESAFE_API_KEY;
	delete process.env.JEV_API_KEY;

	const emptyDir = mkdtempSync(join(tmpdir(), "idu-empty-cwd-"));
	try {
		// Mock fetch that always fails, simulating offline environment
		const offlineFetch = async () => {
			throw new Error("Network unreachable");
		};

		const decision = await arbitrate({
			...sampleInput,
			cwd: emptyDir,
			fetchFn: offlineFetch as unknown as typeof fetch,
		});
		assert.equal(decision.selectedOptionId, "resolver_deuda_cross_file");
		assert.equal(decision.source, "deterministic_fallback");
	} finally {
		rmSync(emptyDir, { recursive: true, force: true });
		if (prevTypesafe) process.env.TYPESAFE_API_KEY = prevTypesafe;
		if (prevJev) process.env.JEV_API_KEY = prevJev;
	}
});

test("arbitrate routes to local Kev when local endpoint is alive", async () => {
	const mockFetch = async (url: string | URL | Request) => {
		const urlStr = String(url);
		if (urlStr.includes("/models")) {
			return { ok: true, status: 200 } as Response;
		}
		if (urlStr.includes("/systemone")) {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					model: "kev-latest",
					answers: {
						next_action: {
							type: "choice",
							choice: "resolver_deuda_cross_file",
							confidence: 0.92,
							probabilities: {
								resolver_deuda_cross_file: 0.92,
								continuar_403: 0.08,
							},
						},
					},
				}),
			} as Response;
		}
		return { ok: false, status: 404 } as Response;
	};

	const decision = await arbitrate({
		...sampleInput,
		fetchFn: mockFetch as unknown as typeof fetch,
	});

	assert.equal(decision.selectedOptionId, "resolver_deuda_cross_file");
	assert.equal(decision.source, "kev_local");
	assert.equal(decision.confidence, 0.92);
});

test("arbitrate routes to cloud Jev when Kev is offline but API key is present", async () => {
	const mockFetch = async (url: string | URL | Request) => {
		const urlStr = String(url);
		if (urlStr.includes("127.0.0.1") || urlStr.includes("localhost")) {
			throw new Error("Connection refused");
		}
		if (urlStr.includes("api.typesafe.ai")) {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					model: "jev-latest",
					answers: {
						next_action: {
							type: "choice",
							choice: "continuar_403",
							confidence: 0.89,
							probabilities: {
								continuar_403: 0.89,
								resolver_deuda_cross_file: 0.11,
							},
						},
					},
				}),
			} as Response;
		}
		return { ok: false, status: 404 } as Response;
	};

	const decision = await arbitrate({
		...sampleInput,
		apiKey: "cloud-test-key",
		fetchFn: mockFetch as unknown as typeof fetch,
	});

	assert.equal(decision.selectedOptionId, "continuar_403");
	assert.equal(decision.source, "jev_cloud");
	assert.equal(decision.confidence, 0.89);
});

test("arbitrate falls back to cloud when local endpoint is down, never sending the cloud key to localhost", async () => {
	const prevEndpoint = process.env.TYPESAFE_ENDPOINT;
	const prevJevEndpoint = process.env.JEV_ENDPOINT;
	process.env.TYPESAFE_ENDPOINT = "http://127.0.0.1:8009/v1/systemone";
	delete process.env.JEV_ENDPOINT;

	const localRequests: string[] = [];
	const cloudRequests: string[] = [];
	const mockFetch = async (url: string | URL | Request) => {
		const urlStr = String(url);
		if (urlStr.includes("127.0.0.1") || urlStr.includes("localhost")) {
			localRequests.push(urlStr);
			throw new Error("Connection refused");
		}
		if (urlStr.includes("api.typesafe.ai")) {
			cloudRequests.push(urlStr);
			return {
				ok: true,
				status: 200,
				json: async () => ({
					model: "jev-latest",
					answers: {
						next_action: {
							type: "choice",
							choice: "continuar_403",
							confidence: 0.9,
							probabilities: {
								continuar_403: 0.9,
								resolver_deuda_cross_file: 0.1,
							},
						},
					},
				}),
			} as Response;
		}
		return { ok: false, status: 404 } as Response;
	};

	try {
		const decision = await arbitrate({
			...sampleInput,
			apiKey: "cloud-secret-key",
			fetchFn: mockFetch as unknown as typeof fetch,
		});

		assert.equal(decision.source, "jev_cloud", "offline local Kev must cascade to cloud Jev");
		assert.ok(cloudRequests.length > 0, "the cloud endpoint must be contacted");
		assert.ok(
			cloudRequests.every((u) => u.startsWith("https://")),
			"cloud requests must go over https",
		);
	} finally {
		if (prevEndpoint === undefined) delete process.env.TYPESAFE_ENDPOINT;
		else process.env.TYPESAFE_ENDPOINT = prevEndpoint;
		if (prevJevEndpoint === undefined) delete process.env.JEV_ENDPOINT;
		else process.env.JEV_ENDPOINT = prevJevEndpoint;
	}
});

test("arbitrateWithJev aborts the request when the endpoint never responds", async () => {
	const neverFetch = (_url: unknown, init?: { signal?: AbortSignal }) =>
		new Promise<Response>((_resolve, reject) => {
			init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
		});

	const decision = await arbitrateWithJev(
		{ ...sampleInput, timeoutMs: 50, fetchFn: neverFetch as unknown as typeof fetch },
		"dummy-key",
	);

	assert.equal(decision.source, "deterministic_fallback", "a hung endpoint must fall back instead of blocking forever");
});

test("redactErrorDetail strips credential-shaped tokens from remote error bodies", () => {
	const leaked = 'HTTP 401: invalid api key "sk-proj-abc123XYZdef456" for key apikey_2255secret99';
	const redacted = redactErrorDetail(leaked);
	assert.ok(!redacted.includes("sk-proj-abc123XYZdef456"), "sk- tokens must be stripped");
	assert.ok(!redacted.includes("apikey_2255secret99"), "apikey_ tokens must be stripped");
	assert.ok(redacted.includes("[redacted]"));
	assert.ok(redacted.length <= 100 + "[redacted]".length * 2, "output must stay bounded");
});

test("redactErrorDetail strips bearer tokens and JWTs", () => {
	assert.ok(!redactErrorDetail("Bearer abcdefgh12345678 rejected").includes("abcdefgh12345678"));
	assert.ok(!redactErrorDetail("token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 invalid").includes("eyJhbGciOiJIUzI1NiIs"));
});

test("normalizeThreshold clamps out-of-range values and rejects NaN", () => {
	assert.equal(normalizeThreshold(5), 1);
	assert.equal(normalizeThreshold(-5), 0);
	assert.equal(normalizeThreshold(0), 0);
	assert.equal(normalizeThreshold(0.7), 0.7);
	assert.equal(normalizeThreshold(Number.NaN), 0.85);
	assert.equal(normalizeThreshold("not-a-number"), 0.85);
	assert.equal(normalizeThreshold(undefined), 0.85);
});

test("looksLikeHighRiskMitigation matches whole words only, no substring false positives", () => {
	assert.equal(looksLikeHighRiskMitigation("Fix asterisk bug"), false, "'asterisk' must not match 'risk'");
	assert.equal(looksLikeHighRiskMitigation("mitigates high-risk regression debt"), true);
	assert.equal(looksLikeHighRiskMitigation("Resolver deuda técnica cross-file"), true);
	assert.equal(looksLikeHighRiskMitigation("high risk migration"), true);
	assert.equal(looksLikeHighRiskMitigation("tokenize css colors"), false);
});

test("looksLikeHighRiskMitigation matches Spanish and English plurals", () => {
	assert.equal(looksLikeHighRiskMitigation("resolver deudas acumuladas"), true, "'deudas' plural must match");
	assert.equal(looksLikeHighRiskMitigation("mitigar riesgos de regresion"), true, "'riesgos' and 'regresion' must match");
	assert.equal(looksLikeHighRiskMitigation("fix known risks"), true, "'risks' plural must match");
	assert.equal(looksLikeHighRiskMitigation("pay technical debts"), true, "'debts' plural must match");
	assert.equal(looksLikeHighRiskMitigation("lista de riesgosas decisiones"), false, "'riesgosas' is a different word, not a plural of riesgo");
});

test("arbitrateWithJev redacts credentials that leak through HTTP error bodies", async () => {
	const leakingFetch = async () => ({
		ok: false,
		status: 401,
		text: async () => 'Unauthorized: key "sk-live-SECRETKEY123456" is invalid',
	} as Response);

	const decision = await arbitrateWithJev(
		{ ...sampleInput, fetchFn: leakingFetch as unknown as typeof fetch },
		"dummy-key",
	);

	assert.equal(decision.source, "deterministic_fallback");
	assert.ok(!decision.reason.includes("sk-live-SECRETKEY123456"), "the remote key must never reach decision.reason");
	assert.ok(decision.reason.includes("[redacted]"));
});


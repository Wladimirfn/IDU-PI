import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	formatWebToolchainProbe,
	probeWebToolchain,
} from "../src/video-binaries.js";
import {
	REQUIRED_WEB_VIEWS,
	WEB_AUDIT_VERSION,
	type WebAuditFile,
	type WebCaptureMetrics,
	buildWebAuditPrompt,
	collectWebAuditInputs,
	evaluateWebAudit,
	isValidWebDelivery,
	listCapturedWebViews,
	parseWebAuditReply,
	readWebBrief,
	runWebAuditCore,
	validateWebDelivery,
	webAuditFilePath,
} from "../src/web-audit.js";

const VIEWS = [...REQUIRED_WEB_VIEWS];

function reply(overrides: { piece?: object; views?: object[] } = {}): string {
	const body = {
		piece: {
			intent: "delivered",
			became: "",
			variety: "pass",
			rhythm: "Alternates hero Three.js canvas, interactive timeline, and grounded footer cleanly.",
			deliveryCompliant: true,
		},
		views: VIEWS.map((id) => ({
			id,
			verdict: "pass",
			failed: [],
			evidence: `${id} rendered cleanly`,
			fix: "",
		})),
		...overrides,
	};
	return `All views match declared intent.\n\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\`\n`;
}

function defaultMetrics(): WebCaptureMetrics {
	return {
		consoleErrors: [],
		pageErrors: [],
		failedRequests: [],
		desktopOverflowPx: 0,
		mobileOverflowPx: 0,
		brokenImages: 0,
		canvasCount: 1,
		zeroSizeCanvases: 0,
	};
}

function makeWebProject(delivery: "single-file" | "app-stack" = "single-file"): string {
	const dir = mkdtempSync(join(tmpdir(), "idu-web-audit-"));
	const files: Record<string, string> = {
		"web-brief.md": `# Web Brief\n- Intent: product-showcase\n- Delivery: ${delivery}\n- Author: claude-code/opus\n`,
		"art-direction.md": "# Art Direction\n- Shape: sharp editorial grid\n- Color: daylight paper + vermilion accent\n",
		"audit/web-captures/metrics.json": JSON.stringify(defaultMetrics()),
	};
	for (const id of VIEWS) {
		files[`audit/web-captures/${id}.png`] = `png-${id}`;
	}
	if (delivery === "single-file") {
		files["index.html"] = "<!doctype html><html><body><h1>Showcase</h1></body></html>";
	} else {
		files["package.json"] = JSON.stringify({ name: "showcase", scripts: { build: "vite build" } });
		files["dist/index.html"] = "<!doctype html><html><body><div id='app'></div></body></html>";
	}
	for (const [rel, content] of Object.entries(files)) {
		const path = join(dir, rel);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content, "utf8");
	}
	return dir;
}

function withWebProject(
	run: (dir: string) => void | Promise<void>,
	delivery: "single-file" | "app-stack" = "single-file",
): Promise<void> | void {
	const dir = makeWebProject(delivery);
	try {
		const res = run(dir);
		if (res && typeof (res as Promise<void>).then === "function") {
			return (res as Promise<void>).finally(() => rmSync(dir, { recursive: true, force: true }));
		}
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		rmSync(dir, { recursive: true, force: true });
		throw err;
	}
}

function writeWebAudit(
	dir: string,
	delivery: "single-file" | "app-stack" = "single-file",
	change: (audit: WebAuditFile) => void = () => {},
): void {
	const parsed = parseWebAuditReply(reply(), VIEWS);
	assert.equal(parsed.ok, true);
	if (!parsed.ok) return;
	const audit: WebAuditFile = {
		version: WEB_AUDIT_VERSION,
		createdAt: "2026-11-27T00:00:00.000Z",
		intent: "product-showcase",
		delivery,
		author: "claude-code/opus",
		auditor: { profile: "audit-gemini", harness: "antigravity", model: "gemini", runId: "IDU-web-1" },
		inputs: collectWebAuditInputs(dir, VIEWS),
		...parsed.reply,
	};
	change(audit);
	const out = webAuditFilePath(dir);
	mkdirSync(dirname(out), { recursive: true });
	writeFileSync(out, JSON.stringify(audit, null, 2), "utf8");
}

test("readWebBrief reads web-brief.md Delivery, Intent and Author fields", () => {
	withWebProject((dir) => {
		writeFileSync(
			join(dir, "web-brief.md"),
			"# Web Brief\n- **Intent:** technical-essay\n- **Delivery:** app-stack (Vite + Three.js)\n- **Author:** codex/gpt-5\n",
			"utf8",
		);
		const brief = readWebBrief(dir);
		assert.equal(brief.intent, "technical-essay");
		assert.equal(brief.delivery, "app-stack");
		assert.equal(brief.author, "codex/gpt-5");
	});
});

test("validateWebDelivery enforces single-file and app-stack project requirements", () => {
	assert.equal(isValidWebDelivery("single-file"), true);
	assert.equal(isValidWebDelivery("app-stack"), true);
	assert.equal(isValidWebDelivery("powerpoint"), false);

	const empty = mkdtempSync(join(tmpdir(), "idu-web-empty-"));
	try {
		assert.match(validateWebDelivery(empty, null) ?? "", /no declara `Delivery:`/);
		assert.match(validateWebDelivery(empty, "static") ?? "", /delivery desconocido "static"/);
		assert.match(validateWebDelivery(empty, "single-file") ?? "", /requiere `index\.html`/);
		assert.equal(validateWebDelivery(empty, "single-file", "http://127.0.0.1:4173"), null);

		assert.match(validateWebDelivery(empty, "app-stack") ?? "", /requiere `package\.json`/);
		writeFileSync(join(empty, "package.json"), "{}", "utf8");
		assert.match(validateWebDelivery(empty, "app-stack") ?? "", /requiere `dist\/index\.html`/);
		assert.equal(validateWebDelivery(empty, "app-stack", "http://127.0.0.1:5173"), null);
		mkdirSync(join(empty, "dist"), { recursive: true });
		writeFileSync(join(empty, "dist", "index.html"), "<html></html>", "utf8");
		assert.equal(validateWebDelivery(empty, "app-stack"), null);
	} finally {
		rmSync(empty, { recursive: true, force: true });
	}
});

test("listCapturedWebViews discovers PNG view ids", () => {
	withWebProject((dir) => {
		assert.deepEqual([...listCapturedWebViews(dir).keys()].sort(), [...VIEWS].sort());
	});
});

test("parseWebAuditReply validates complete verdicts and rejects gaps or contradictions", () => {
	const ok = parseWebAuditReply(reply(), VIEWS);
	assert.equal(ok.ok, true);

	const missing = parseWebAuditReply(reply({ views: [{ id: "desktop-hero", verdict: "pass", failed: [], evidence: "ok", fix: "" }] }), VIEWS);
	assert.equal(missing.ok, false);
	if (!missing.ok) assert.match(missing.error, /no cubre/);

	const passWithFailed = parseWebAuditReply(
		reply({
			views: VIEWS.map((id, i) =>
				i === 0
					? { id, verdict: "pass", failed: [4], evidence: "overflow", fix: "fix" }
					: { id, verdict: "pass", failed: [], evidence: "ok", fix: "" },
			),
		}),
		VIEWS,
	);
	assert.equal(passWithFailed.ok, false);
	if (!passWithFailed.ok) assert.match(passWithFailed.error, /pass con checks fallidos/);

	const emptyEvidence = parseWebAuditReply(
		reply({
			views: VIEWS.map((id, i) =>
				i === 0
					? { id, verdict: "revise", failed: [2], evidence: "", fix: "adjust weight" }
					: { id, verdict: "pass", failed: [], evidence: "ok", fix: "" },
			),
		}),
		VIEWS,
	);
	assert.equal(emptyEvidence.ok, false);
	if (!emptyEvidence.ok) assert.match(emptyEvidence.error, /sin evidencia/);
});

test("evaluateWebAudit accepts a clean fresh independent audit", () => {
	withWebProject((dir) => {
		writeWebAudit(dir);
		assert.deepEqual(evaluateWebAudit(dir), { errors: [], warnings: [] });
	});
});

test("evaluateWebAudit refuses stale inputs, delivery mismatch, and self-approval", () => {
	withWebProject((dir) => {
		writeWebAudit(dir, "app-stack");
		assert.deepEqual(evaluateWebAudit(dir), { errors: [], warnings: [] });

		// Mutating screenshot invalidates hash
		writeFileSync(join(dir, "audit", "web-captures", "mobile-hero.png"), "mutated", "utf8");
		assert.match(evaluateWebAudit(dir).errors.join("\n"), /captura\(s\) mobile-hero cambió/);
		writeFileSync(join(dir, "audit", "web-captures", "mobile-hero.png"), "png-mobile-hero", "utf8");

		// Mutating entry package.json invalidates hash
		writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "changed" }), "utf8");
		assert.match(evaluateWebAudit(dir).errors.join("\n"), /archivo de entrada cambió/);
	}, "app-stack");

	withWebProject((dir) => {
		writeWebAudit(dir, "single-file", (audit) => {
			audit.auditor.harness = "claude";
		});
		assert.match(evaluateWebAudit(dir).errors.join("\n"), /no independiente/);
	});

	withWebProject((dir) => {
		writeWebAudit(dir, "single-file");
		writeFileSync(
			join(dir, "web-brief.md"),
			"# Web Brief\n- Intent: product-showcase\n- Delivery: app-stack\n- Author: claude-code/opus\n",
			"utf8",
		);
		assert.match(evaluateWebAudit(dir).errors.join("\n"), /declara delivery `app-stack`, auditado como `single-file`/);
	});
});

test("evaluateWebAudit enforces runtime metrics and blocking checks [4, 9, 10]", () => {
	withWebProject((dir) => {
		writeWebAudit(dir);
		writeFileSync(
			join(dir, "audit", "web-captures", "metrics.json"),
			JSON.stringify({ ...defaultMetrics(), consoleErrors: ["TypeError: boom"], mobileOverflowPx: 24 }),
			"utf8",
		);
		// Refresh audit hashes so we specifically verify metrics checks after hash check passes
		writeWebAudit(dir);
		const res = evaluateWebAudit(dir);
		assert.match(res.errors.join("\n"), /runtime console error/);
		assert.match(res.errors.join("\n"), /overflow horizontal en mobile: 24px/);
	});

	withWebProject((dir) => {
		writeWebAudit(dir, "single-file", (audit) => {
			audit.views[0] = { id: "desktop-hero", verdict: "revise", failed: [2], evidence: "weak contrast", fix: "raise contrast" };
			audit.views[4] = { id: "mobile-hero", verdict: "revise", failed: [4], evidence: "clipped CTA", fix: "stack nav" };
		});
		const res = evaluateWebAudit(dir);
		assert.match(res.errors.join("\n"), /vista a corregir mobile-hero \(checks 4\)[\s\S]*check bloqueante/);
		assert.match(res.warnings.join("\n"), /a revisar desktop-hero \(checks 2\)/);
	});

	withWebProject((dir) => {
		writeWebAudit(dir, "single-file", (audit) => {
			audit.piece.deliveryCompliant = false;
			audit.piece.variety = "revise";
			audit.piece.rhythm = "3 identical card grids";
		});
		const res = evaluateWebAudit(dir);
		assert.match(res.errors.join("\n"), /incumple el modo Delivery/);
		assert.match(res.errors.join("\n"), /web audit variedad: 3 identical card grids/);
	});
});

test("buildWebAuditPrompt references contract, delivery entry file, and captures", () => {
	const prompt = buildWebAuditPrompt({
		briefName: "web-brief.md",
		intent: "interactive essay",
		delivery: "app-stack",
		viewIds: VIEWS,
		contractPath: "/skills/references/web-visual-qa.md",
	});
	assert.match(prompt, /Declared delivery mode: `app-stack`/);
	assert.match(prompt, /`package\.json`/);
	assert.match(prompt, /audit\/web-captures\/mobile-hero\.png/);
});

test("runWebAuditCore selects non-author harness, writes audit/web-visual-qa.json, and opens gate", async () => {
	await withWebProject(async (dir) => {
		let captured = false;
		let delegatedProfile = "";
		const exitCode = await runWebAuditCore(
			dir,
			{},
			{
				auditProfiles: ["audit-claude", "audit-gemini"],
				profiles: {
					"audit-claude": { harness: "claude" },
					"audit-gemini": { harness: "antigravity" },
				},
				resolveContractPath: () => "/skills/web-craft/references/web-visual-qa.md",
				captureViews: () => {
					captured = true;
					return 0;
				},
				delegate: async (req) => {
					delegatedProfile = req.profile;
					return {
						runId: "IDU-web-mock",
						profile: req.profile,
						harness: "antigravity",
						model: "gemini-3",
						status: "completed",
						summary: reply(),
						logPath: join(dir, "mock.log"),
					};
				},
				evaluateGate: evaluateWebAudit,
				log: () => {},
				error: () => {},
			},
		);
		assert.equal(exitCode, 0);
		assert.equal(captured, true);
		assert.equal(delegatedProfile, "audit-gemini");
		const saved = JSON.parse(readFileSync(webAuditFilePath(dir), "utf8")) as WebAuditFile;
		assert.equal(saved.delivery, "app-stack");
		assert.equal(saved.auditor.harness, "antigravity");
	}, "app-stack");
});

test("runWebAuditCore refuses when no non-author harness profile exists", async () => {
	await withWebProject(async (dir) => {
		const errs: string[] = [];
		const code = await runWebAuditCore(
			dir,
			{ noCapture: true },
			{
				auditProfiles: ["audit-claude"],
				profiles: { "audit-claude": { harness: "claude" } },
				resolveContractPath: () => "/skills/web-visual-qa.md",
				captureViews: () => 0,
				delegate: async () => {
					throw new Error("should not delegate");
				},
				evaluateGate: evaluateWebAudit,
				error: (m) => errs.push(m),
			},
		);
		assert.equal(code, 1);
		assert.match(errs.join("\n"), /ningún perfil disponible es de un harness distinto del autor/);
	});
});

test("probeWebToolchain detects project-local dependencies hermetically", () => {
	const dir = mkdtempSync(join(tmpdir(), "idu-web-probe-"));
	try {
		const pkgDir = join(dir, "node_modules", "three");
		mkdirSync(pkgDir, { recursive: true });
		writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "three", version: "0.187.0" }), "utf8");
		const probe = probeWebToolchain(dir);
		assert.equal(probe.packages.three.location, "project");
		assert.equal(probe.packages.three.version, "0.187.0");
		assert.ok("gsap" in probe.packages);
		assert.ok("button-sounds" in probe.packages);
		assert.match(formatWebToolchainProbe(probe), /=== idu-pi web toolchain ===/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

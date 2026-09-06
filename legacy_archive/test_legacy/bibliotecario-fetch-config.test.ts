import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	readBibliotecarFetchConfig,
	saveBibliotecarFetchConfig,
	isBibliotecarFetchAllowed,
} from "../src/bibliotecario-fetch-config.js";

function makeStateRoot(): string {
	return mkdtempSync(join(tmpdir(), "idu-b3-fetch-"));
}

test("readBibliotecarFetchConfig returns default-disabled when no config file exists", () => {
	const stateRoot = makeStateRoot();
	try {
		const cfg = readBibliotecarFetchConfig(stateRoot);
		assert.equal(cfg.enabled, false);
		assert.deepEqual(cfg.allowlist, []);
		assert.equal(cfg.rawDocsStored, false);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("readBibliotecarFetchConfig round-trips a saved config", () => {
	const stateRoot = makeStateRoot();
	try {
		saveBibliotecarFetchConfig(stateRoot, {
			enabled: true,
			allowlist: [{ host: "example.com", pathPrefix: "/docs" }],
			rawDocsStored: true,
			source: "test",
		});
		const cfg = readBibliotecarFetchConfig(stateRoot);
		assert.equal(cfg.enabled, true);
		assert.equal(cfg.allowlist.length, 1);
		assert.equal(cfg.allowlist[0]?.host, "example.com");
		assert.equal(cfg.rawDocsStored, true);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("isBibliotecarFetchAllowed returns false when enabled is false regardless of allowlist", () => {
	const cfg = {
		version: 1 as const,
		enabled: false,
		allowlist: [{ host: "example.com", pathPrefix: "/docs" }],
		rawDocsStored: true,
		updatedAt: new Date().toISOString(),
	};
	assert.equal(
		isBibliotecarFetchAllowed(cfg, "https://example.com/docs/page"),
		false,
	);
});

test("isBibliotecarFetchAllowed returns true when enabled and host/path match", () => {
	const cfg = {
		version: 1 as const,
		enabled: true,
		allowlist: [{ host: "example.com", pathPrefix: "/docs" }],
		rawDocsStored: false,
		updatedAt: new Date().toISOString(),
	};
	assert.equal(
		isBibliotecarFetchAllowed(cfg, "https://example.com/docs/page"),
		true,
	);
});

test("isBibliotecarFetchAllowed returns false when host not in allowlist", () => {
	const cfg = {
		version: 1 as const,
		enabled: true,
		allowlist: [{ host: "example.com", pathPrefix: "/docs" }],
		rawDocsStored: false,
		updatedAt: new Date().toISOString(),
	};
	assert.equal(
		isBibliotecarFetchAllowed(cfg, "https://other.com/docs/page"),
		false,
	);
});

test("isBibliotecarFetchAllowed returns false when path prefix mismatches", () => {
	const cfg = {
		version: 1 as const,
		enabled: true,
		allowlist: [{ host: "example.com", pathPrefix: "/docs" }],
		rawDocsStored: false,
		updatedAt: new Date().toISOString(),
	};
	assert.equal(
		isBibliotecarFetchAllowed(cfg, "https://example.com/other/page"),
		false,
	);
});

test("default-off regression: config absent means fetch disabled", () => {
	const stateRoot = makeStateRoot();
	try {
		const cfg = readBibliotecarFetchConfig(stateRoot);
		assert.equal(cfg.enabled, false);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("env override: IDU_PI_BIBLIOTECARIO_FETCH=1 enables fetch with no config file", () => {
	const stateRoot = makeStateRoot();
	try {
		const previous = process.env.IDU_PI_BIBLIOTECARIO_FETCH;
		process.env.IDU_PI_BIBLIOTECARIO_FETCH = "1";
		try {
			const cfg = readBibliotecarFetchConfig(stateRoot);
			assert.equal(cfg.enabled, true);
		} finally {
			if (previous === undefined) {
				delete process.env.IDU_PI_BIBLIOTECARIO_FETCH;
			} else {
				process.env.IDU_PI_BIBLIOTECARIO_FETCH = previous;
			}
		}
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

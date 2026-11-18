import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalHarnessName } from "./session-policy.js";
import type { IduProfile, ReasoningEffort } from "./types.js";

export const REASONING_EFFORT_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const satisfies readonly ReasoningEffort[];

const EFFORT_SET = new Set<string>(REASONING_EFFORT_LEVELS);

const EFFORT_ALIASES: Record<string, ReasoningEffort> = {
	none: "off",
	disabled: "off",
	ninguno: "off",
	min: "minimal",
	minimo: "minimal",
	mínimo: "minimal",
	bajo: "low",
	med: "medium",
	medio: "medium",
	alto: "high",
	xalto: "xhigh",
	maximo: "max",
	máximo: "max",
};

const EFFORT_BADGE_UPPER: Record<ReasoningEffort, string> = {
	off: "OFF",
	minimal: "MIN",
	low: "LOW",
	medium: "MED",
	high: "HIGH",
	xhigh: "XHIGH",
	max: "MAX",
};

export interface HarnessEffortSpec {
	canonicalHarness: string;
	supported: boolean;
	mechanism: string;
	nativeLevels: readonly ReasoningEffort[];
}

const HARNESS_EFFORT_SPECS: Record<string, HarnessEffortSpec> = {
	pi: {
		canonicalHarness: "pi",
		supported: true,
		mechanism: "--thinking <level>",
		nativeLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
	},
	"gentle-shell": {
		canonicalHarness: "gentle-shell",
		supported: true,
		mechanism: "--thinking <level>",
		nativeLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
	},
	opencode: {
		canonicalHarness: "opencode",
		supported: true,
		mechanism: "--model provider/model#<variant>",
		nativeLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
	},
	claude: {
		canonicalHarness: "claude",
		supported: true,
		mechanism: "--effort <level>",
		nativeLevels: ["low", "medium", "high", "xhigh", "max"],
	},
	codex: {
		canonicalHarness: "codex",
		supported: true,
		mechanism: '-c model_reasoning_effort="<level>"',
		nativeLevels: ["minimal", "low", "medium", "high", "xhigh"],
	},
	commandcode: {
		canonicalHarness: "commandcode",
		supported: true,
		mechanism: "--effort <level>",
		nativeLevels: ["off", "low", "medium", "high", "xhigh", "max"],
	},
	mcode: {
		canonicalHarness: "mcode",
		supported: true,
		mechanism: "--effort <level>",
		nativeLevels: ["off", "low", "medium", "high", "xhigh", "max"],
	},
	antigravity: {
		canonicalHarness: "antigravity",
		supported: true,
		mechanism: "--effort <level>",
		nativeLevels: ["low", "medium", "high", "xhigh", "max"],
	},
	kimi: {
		canonicalHarness: "kimi",
		supported: false,
		mechanism: "kimi CLI no expone flag de esfuerzo",
		nativeLevels: [],
	},
	qwen: {
		canonicalHarness: "qwen",
		supported: false,
		mechanism: "qwen CLI no expone flag de esfuerzo",
		nativeLevels: [],
	},
};

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
	return typeof value === "string" && EFFORT_SET.has(value);
}

/**
 * Parses a user-supplied reasoning effort string (`off|minimal|low|medium|high|xhigh|max`
 * or `"default"`/`"auto"`/`""` to clear an explicit override).
 */
export function parseReasoningEffortInput(raw?: string | null): ReasoningEffort | undefined {
	if (raw === undefined || raw === null) return undefined;
	const norm = raw.trim().toLowerCase();
	if (!norm || norm === "default" || norm === "auto" || norm === "inherit") {
		return undefined;
	}
	if (isReasoningEffort(norm)) return norm;
	if (norm in EFFORT_ALIASES) return EFFORT_ALIASES[norm];
	throw new Error(
		`Esfuerzo inválido: "${raw}". Usá uno de: ${REASONING_EFFORT_LEVELS.join(", ")} o "default".`,
	);
}

export function getHarnessEffortSpec(rawHarness: string): HarnessEffortSpec {
	const canonical = canonicalHarnessName(rawHarness.trim().toLowerCase());
	return (
		HARNESS_EFFORT_SPECS[canonical] ?? {
			canonicalHarness: canonical,
			supported: false,
			mechanism: `harness "${canonical}" sin soporte de flag de esfuerzo`,
			nativeLevels: [],
		}
	);
}

export interface ResolvedHarnessEffortArg {
	supported: boolean;
	effective?: ReasoningEffort;
	mappedFrom?: ReasoningEffort;
	mechanism: string;
	args: string[];
	opencodeVariant?: ReasoningEffort;
}

/**
 * Translates an abstract `ReasoningEffort` into the exact CLI arguments (or
 * OpenCode `#variant` suffix) for the given harness, falling back cleanly to the
 * nearest natively supported level when needed.
 */
export function resolveHarnessEffortArg(
	rawHarness: string,
	effort?: ReasoningEffort,
): ResolvedHarnessEffortArg {
	const spec = getHarnessEffortSpec(rawHarness);
	if (!effort) {
		return { supported: spec.supported, mechanism: spec.mechanism, args: [] };
	}
	if (!spec.supported || spec.nativeLevels.length === 0) {
		return {
			supported: false,
			mappedFrom: effort,
			mechanism: spec.mechanism,
			args: [],
		};
	}

	let effective: ReasoningEffort | undefined;
	if (spec.nativeLevels.includes(effort)) {
		effective = effort;
	} else {
		const idx = REASONING_EFFORT_LEVELS.indexOf(effort);
		for (let delta = 1; delta < REASONING_EFFORT_LEVELS.length; delta++) {
			const order =
				idx >= 4
					? [REASONING_EFFORT_LEVELS[idx - delta], REASONING_EFFORT_LEVELS[idx + delta]]
					: [REASONING_EFFORT_LEVELS[idx + delta], REASONING_EFFORT_LEVELS[idx - delta]];
			for (const cand of order) {
				if (cand && spec.nativeLevels.includes(cand)) {
					effective = cand;
					break;
				}
			}
			if (effective) break;
		}
	}

	if (!effective) {
		return { supported: false, mappedFrom: effort, mechanism: spec.mechanism, args: [] };
	}

	const mappedFrom = effective !== effort ? effort : undefined;
	switch (spec.canonicalHarness) {
		case "pi":
		case "gentle-shell":
			return {
				supported: true,
				effective,
				mappedFrom,
				mechanism: spec.mechanism,
				args: ["--thinking", effective],
			};
		case "opencode":
			return {
				supported: true,
				effective,
				mappedFrom,
				mechanism: spec.mechanism,
				args: [],
				opencodeVariant: effective,
			};
		case "codex":
			return {
				supported: true,
				effective,
				mappedFrom,
				mechanism: spec.mechanism,
				args: ["-c", `model_reasoning_effort="${effective}"`],
			};
		case "claude":
		case "commandcode":
		case "mcode":
		case "antigravity":
			return {
				supported: true,
				effective,
				mappedFrom,
				mechanism: spec.mechanism,
				args: ["--effort", effective],
			};
		default:
			return { supported: false, mappedFrom: effort, mechanism: spec.mechanism, args: [] };
	}
}

/** Strips trailing `#effort` or `:effort` suffixes (preserves `:free` and similar tags). */
export function stripEffortVariantSuffix(rawModel: string): {
	model: string;
	effortSuffix?: ReasoningEffort;
	syntax?: "hash" | "colon";
} {
	const trimmed = rawModel.trim();
	const hashMatch = trimmed.match(/^(.*?)#(off|minimal|low|medium|high|xhigh|max)$/i);
	if (hashMatch && hashMatch[1]) {
		return {
			model: hashMatch[1],
			effortSuffix: hashMatch[2].toLowerCase() as ReasoningEffort,
			syntax: "hash",
		};
	}
	const colonMatch = trimmed.match(/^(.*?):(off|minimal|low|medium|high|xhigh|max)$/i);
	if (colonMatch && colonMatch[1]) {
		return {
			model: colonMatch[1],
			effortSuffix: colonMatch[2].toLowerCase() as ReasoningEffort,
			syntax: "colon",
		};
	}
	return { model: trimmed };
}

/** Extracts an embedded effort suffix from a profile's model string for display and CLI parity. */
export function extractModelEffortSuffix(
	rawHarness: string,
	rawModel?: string,
): { baseModel: string; embeddedEffort?: ReasoningEffort; syntax?: "hash" | "colon" | "dash" } {
	const model = (rawModel ?? "").trim();
	if (!model) return { baseModel: "" };

	const stripped = stripEffortVariantSuffix(model);
	if (stripped.effortSuffix) {
		return {
			baseModel: stripped.model,
			embeddedEffort: stripped.effortSuffix,
			syntax: stripped.syntax,
		};
	}

	const canonical = canonicalHarnessName(rawHarness.trim().toLowerCase());
	if (canonical === "antigravity") {
		const dashMatch = model.match(/-(xhigh|max|high|medium|low)$/i);
		if (dashMatch) {
			return {
				baseModel: model,
				embeddedEffort: dashMatch[1].toLowerCase() as ReasoningEffort,
				syntax: "dash",
			};
		}
	}
	return { baseModel: model };
}

/** Applies or preserves the `#variant` suffix on an OpenCode `--model` argument. */
export function formatModelForOpenCode(fullModel: string, effort?: ReasoningEffort): string {
	if (!effort) return fullModel;
	const resolved = resolveHarnessEffortArg("opencode", effort);
	if (!resolved.opencodeVariant) return fullModel;
	const base = stripEffortVariantSuffix(fullModel).model.replace(/#[a-z0-9-]+$/i, "");
	return `${base}#${resolved.opencodeVariant}`;
}

export interface CliDefaultEffortInfo {
	effort?: ReasoningEffort;
	source: string;
	advertisedLevels?: ReasoningEffort[];
}

function safeReadJsonFile(filePath: string): Record<string, unknown> | null {
	if (!existsSync(filePath)) return null;
	try {
		const raw = readFileSync(filePath, "utf8")
			.replace(/^\s*\/\/.*$/gm, "")
			.replace(/,\s*([}\]])/g, "$1");
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function safeParseEffort(value: unknown): ReasoningEffort | undefined {
	if (typeof value !== "string") return undefined;
	try {
		return parseReasoningEffortInput(value);
	} catch {
		return undefined;
	}
}

/**
 * Inspects local CLI config files under `homeDir` to surface the actual fallback
 * effort that runs when an `IduProfile` does not specify an explicit `effort`.
 */
export function readCliDefaultEffort(
	rawHarness: string,
	modelDisplay: string,
	homeDir?: string,
): CliDefaultEffortInfo {
	if (!homeDir) return { source: "default del CLI" };
	const canonical = canonicalHarnessName(rawHarness.trim().toLowerCase());
	const slashIdx = modelDisplay.indexOf("/");
	const provider = slashIdx !== -1 ? modelDisplay.slice(0, slashIdx).toLowerCase() : "";
	const modelId = slashIdx !== -1 ? modelDisplay.slice(slashIdx + 1) : modelDisplay;

	switch (canonical) {
		case "pi": {
			const cfg = safeReadJsonFile(join(homeDir, ".pi", "agent", "settings.json"));
			const effort = safeParseEffort(cfg?.defaultThinkingLevel);
			return { effort, source: "~/.pi/agent/settings.json" };
		}
		case "gentle-shell": {
			const cfg = safeReadJsonFile(join(homeDir, ".gentle-shell", "agent", "settings.json"));
			const effort = safeParseEffort(cfg?.defaultThinkingLevel);
			return { effort, source: "~/.gentle-shell/agent/settings.json" };
		}
		case "claude": {
			const cfg = safeReadJsonFile(join(homeDir, ".claude", "settings.json"));
			let effort = safeParseEffort(cfg?.effortLevel);
			if (!effort && cfg?.modelSettings && typeof cfg.modelSettings === "object") {
				const ms = cfg.modelSettings as Record<string, Record<string, unknown>>;
				const exact = ms[modelId]?.effortLevel ?? ms[modelDisplay]?.effortLevel;
				effort = safeParseEffort(exact);
				if (!effort) {
					const needle = modelId.toLowerCase();
					for (const [k, v] of Object.entries(ms)) {
						if (k.toLowerCase().includes(needle)) {
							const parsed = safeParseEffort(v?.effortLevel);
							if (parsed) {
								effort = parsed;
								break;
							}
						}
					}
				}
			}
			return { effort, source: "~/.claude/settings.json" };
		}
		case "codex": {
			const tomlPath = join(homeDir, ".codex", "config.toml");
			if (!existsSync(tomlPath)) return { source: "~/.codex/config.toml" };
			try {
				const raw = readFileSync(tomlPath, "utf8");
				const m = raw.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m);
				return { effort: safeParseEffort(m?.[1]), source: "~/.codex/config.toml" };
			} catch {
				return { source: "~/.codex/config.toml" };
			}
		}
		case "commandcode": {
			const cfg = safeReadJsonFile(join(homeDir, ".commandcode", "config.json"));
			const map = cfg?.reasoningEffort;
			if (map && typeof map === "object") {
				const rec = map as Record<string, unknown>;
				const effort = safeParseEffort(rec[modelDisplay] ?? rec[modelId]);
				return { effort, source: "~/.commandcode/config.json" };
			}
			return { source: "~/.commandcode/config.json" };
		}
		case "opencode": {
			let advertisedLevels: ReasoningEffort[] | undefined;
			const cachePath = join(homeDir, ".cache", "opencode", "models.json");
			if (existsSync(cachePath) && provider && modelId) {
				try {
					const rawCache = JSON.parse(readFileSync(cachePath, "utf8")) as Record<
						string,
						{ models?: Record<string, { reasoning_options?: Array<{ type?: string; values?: string[] }> }> }
					>;
					const cleanId = stripEffortVariantSuffix(modelId).model;
					const modelMeta = rawCache[provider]?.models?.[cleanId];
					const values = modelMeta?.reasoning_options?.find((o) => Array.isArray(o.values))?.values;
					if (values && values.length > 0) {
						advertisedLevels = values
							.map((v) => safeParseEffort(v))
							.filter((v): v is ReasoningEffort => Boolean(v));
					}
				} catch {
					// ignore cache read errors cleanly
				}
			}
			for (const fname of ["opencode.jsonc", "opencode.json"]) {
				const cfg = safeReadJsonFile(join(homeDir, ".config", "opencode", fname));
				if (!cfg) continue;
				const agents = cfg.agent as Record<string, { variant?: unknown }> | undefined;
				const effort = safeParseEffort(agents?.build?.variant);
				return { effort, source: `~/.config/opencode/${fname}`, advertisedLevels };
			}
			return { source: "~/.config/opencode", advertisedLevels };
		}
		case "mcode": {
			const yamlPath = join(homeDir, ".mcode", "config.yaml");
			if (!existsSync(yamlPath)) return { source: "~/.mcode/config.yaml" };
			try {
				const raw = readFileSync(yamlPath, "utf8");
				const m = raw.match(/^\s*(?:reasoningEffort|effort)\s*:\s*["']?([a-zA-Z0-9_-]+)["']?/m);
				return { effort: safeParseEffort(m?.[1]), source: "~/.mcode/config.yaml" };
			} catch {
				return { source: "~/.mcode/config.yaml" };
			}
		}
		default:
			return { source: `default ${canonical}` };
	}
}

export interface EffortInspection {
	explicit?: ReasoningEffort;
	effective?: ReasoningEffort;
	cliEffective?: ReasoningEffort;
	source: "explicit" | "model-suffix" | "cli-default" | "unknown-default" | "unsupported";
	supported: boolean;
	nativeLevels: readonly ReasoningEffort[];
	advertisedModelLevels?: readonly ReasoningEffort[];
	badge: string;
	detail: string;
}

/**
 * Produces a unified inspection summary combining explicit `profile.effort`,
 * embedded model suffixes (`#high`, `-xhigh`), and host CLI config defaults.
 */
export function inspectProfileEffort(
	profile: Pick<IduProfile, "harness" | "provider" | "model" | "effort">,
	cliHomeDir?: string,
): EffortInspection {
	const spec = getHarnessEffortSpec(profile.harness);
	const rawModel = (profile.model ?? "default").replace(/^custom_provider:/i, "");
	const modelDisplay =
		profile.provider && !rawModel.startsWith(`${profile.provider}/`)
			? `${profile.provider}/${rawModel}`
			: rawModel;

	const explicit = safeParseEffort(profile.effort);
	const embedded = extractModelEffortSuffix(profile.harness, profile.model).embeddedEffort;
	const cliDefault = readCliDefaultEffort(profile.harness, modelDisplay, cliHomeDir);
	const advertised = cliDefault.advertisedLevels;

	if (explicit) {
		const argInfo = resolveHarnessEffortArg(profile.harness, explicit);
		if (!argInfo.supported) {
			return {
				explicit,
				effective: explicit,
				source: "unsupported",
				supported: false,
				nativeLevels: spec.nativeLevels,
				advertisedModelLevels: advertised,
				badge: `${EFFORT_BADGE_UPPER[explicit]}!`,
				detail: `${explicit} (${spec.mechanism}; guardado en perfil, sin flag CLI)`,
			};
		}
		const cliEffective = argInfo.effective ?? explicit;
		const mappedNote = argInfo.mappedFrom
			? ` -> ${cliEffective} en ${spec.canonicalHarness}`
			: "";
		const modelHint =
			advertised && advertised.length > 0 ? ` · modelo soporta: ${advertised.join("/")}` : "";
		return {
			explicit,
			effective: explicit,
			cliEffective,
			source: "explicit",
			supported: true,
			nativeLevels: spec.nativeLevels,
			advertisedModelLevels: advertised,
			badge: argInfo.mappedFrom ? `${EFFORT_BADGE_UPPER[cliEffective]}*` : EFFORT_BADGE_UPPER[explicit],
			detail: `${explicit}${mappedNote} [explícito · ${spec.mechanism}]${modelHint}`,
		};
	}

	if (embedded) {
		const argInfo = resolveHarnessEffortArg(profile.harness, embedded);
		return {
			effective: embedded,
			cliEffective: argInfo.effective ?? embedded,
			source: "model-suffix",
			supported: spec.supported,
			nativeLevels: spec.nativeLevels,
			advertisedModelLevels: advertised,
			badge: EFFORT_BADGE_UPPER[embedded],
			detail: `${embedded} [en modelo (${rawModel.includes("#") ? "#" : "-"})]`,
		};
	}

	if (!spec.supported) {
		return {
			source: "unsupported",
			supported: false,
			nativeLevels: spec.nativeLevels,
			advertisedModelLevels: advertised,
			badge: "n/a",
			detail: `default del modelo (${spec.mechanism})`,
		};
	}

	if (cliDefault.effort) {
		const modelHint =
			advertised && advertised.length > 0 ? ` · soporta: ${advertised.join("/")}` : "";
		return {
			effective: cliDefault.effort,
			cliEffective: cliDefault.effort,
			source: "cli-default",
			supported: true,
			nativeLevels: spec.nativeLevels,
			advertisedModelLevels: advertised,
			badge: `~${EFFORT_BADGE_UPPER[cliDefault.effort].toLowerCase()}`,
			detail: `${cliDefault.effort} [default ${cliDefault.source}]${modelHint}`,
		};
	}

	const modelHint =
		advertised && advertised.length > 0 ? ` · modelo soporta: ${advertised.join("/")}` : "";
	return {
		source: "unknown-default",
		supported: true,
		nativeLevels: spec.nativeLevels,
		advertisedModelLevels: advertised,
		badge: "def",
		detail: `default de ${spec.canonicalHarness} (sin override explícito${modelHint})`,
	};
}

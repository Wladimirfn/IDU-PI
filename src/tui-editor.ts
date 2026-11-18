import { homedir } from "node:os";
import { emitKeypressEvents } from "node:readline";
import {
	inspectProfileEffort,
	resolveHarnessEffortArg,
	type EffortInspection,
} from "./effort.js";
import {
	ALL_SUPPORTED_HARNESSES,
	bindProjectFleet,
	buildDynamicProfileDescription,
	CANONICAL_ROLES,
	createFleet,
	deleteFleet,
	deleteFleetAgent,
	formatProfileFieldsForHarness,
	LEGACY_AGENT_ALIASES,
	listCompatibleHarnessesForModel,
	listFleets,
	migrateFleetFile,
	nextAvailableSlotName,
	parseModelSpec,
	renameFleet,
	ROLE_SLOT_DEFAULTS,
	unbindProjectFleet,
	upsertFleetAgent,
	useFleet,
} from "./fleets.js";
import { discoverFleetCapabilities } from "./optimizer/discovery.js";
import { testModelAcrossTerminals } from "./optimizer/runner.js";
import type { ModelTerminalTestReport } from "./optimizer/types.js";
import type { IduProfile, ReasoningEffort } from "./types.js";

const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_DIM = "\x1b[2m";
const ANSI_BRIGHT_PURPLE = "\x1b[95m";
const ANSI_CYAN = "\x1b[36m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_RED = "\x1b[31m";
const ANSI_REVERSE = "\x1b[7m";
const ANSI_HOME_CLEAR = "\x1b[H\x1b[2J";

export interface EditorIo {
	stdin: NodeJS.ReadStream;
	stdout: NodeJS.WriteStream;
}

export interface EditorAgentTarget {
	name: string;
	role: string;
	rank: number;
	harness: string;
	provider?: string;
	modelDisplay: string;
	effort?: ReasoningEffort;
	permissions: "read-only" | "workspace";
	description: string;
	rawProfile: IduProfile;
}

export interface EditorContext {
	io: EditorIo;
	activeFleet: string;
	workingDir: string;
	installedClis: Array<{ name: string; command: string; available: boolean }>;
	profiles: Record<string, IduProfile>;
}

interface KeyEvent {
	name?: string;
	ctrl?: boolean;
	shift?: boolean;
	sequence?: string;
}

export interface SelectItem<T> {
	label: string;
	detail?: string;
	disabled?: boolean;
	value: T;
}

function fleetTarget(ctx: EditorContext): { fleet?: string; workingDir: string } {
	return {
		fleet: ctx.activeFleet.startsWith("local:") ? undefined : ctx.activeFleet,
		workingDir: ctx.workingDir,
	};
}

interface ResolvedSlotUpdate {
	harness: string;
	provider?: string;
	model: string;
	effort?: ReasoningEffort;
	streams: boolean;
	description: string;
}

function saveSlotProfileUpdate(
	ctx: EditorContext,
	slotName: string,
	baseProfile: IduProfile,
	next: ResolvedSlotUpdate,
): void {
	const updated: IduProfile = {
		...baseProfile,
		harness: next.harness,
		model: next.model,
		streams: next.streams,
		description: next.description,
	};
	if (next.provider) updated.provider = next.provider;
	else delete updated.provider;
	if (next.effort) updated.effort = next.effort;
	else delete updated.effort;

	upsertFleetAgent({
		...fleetTarget(ctx),
		slotName,
		profile: updated,
	});
}

function truncateAnsiLine(line: string, maxCols: number): string {
	if (maxCols <= 0) return "";
	const plainLen = line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").length;
	if (plainLen <= maxCols) return line;
	const target = maxCols > 1 ? maxCols - 1 : 1;
	let visible = 0;
	let out = "";
	let sawAnsi = false;
	let i = 0;
	while (i < line.length && visible < target) {
		if (line[i] === "\x1b" && line[i + 1] === "[") {
			const match = line.slice(i).match(/^\x1b\[[0-9;?]*[A-Za-z]/);
			if (match) {
				out += match[0];
				sawAnsi = true;
				i += match[0].length;
				continue;
			}
		}
		out += line[i];
		visible++;
		i++;
	}
	if (maxCols > 1) out += "…";
	if (sawAnsi) out += ANSI_RESET;
	return out;
}

function writeScreen(io: EditorIo, lines: string[]): void {
	const height = io.stdout.rows || 30;
	const width = io.stdout.columns || 100;
	const clipped = lines.slice(0, height).map((line) => truncateAnsiLine(line, width));
	io.stdout.write(`${ANSI_HOME_CLEAR}${clipped.join("\n")}`);
}

const initializedKeypressStreams = new WeakSet<NodeJS.ReadStream>();

function readKey(stdin: NodeJS.ReadStream): Promise<KeyEvent> {
	if (!initializedKeypressStreams.has(stdin)) {
		emitKeypressEvents(stdin);
		initializedKeypressStreams.add(stdin);
	}
	return new Promise((resolve) => {
		const onKey = (_str: string, key: KeyEvent) => {
			stdin.off("keypress", onKey);
			resolve(key ?? {});
		};
		stdin.on("keypress", onKey);
	});
}

async function waitForAnyKey(io: EditorIo, footer = "Presioná cualquier tecla para continuar..."): Promise<void> {
	io.stdout.write(`\n${ANSI_DIM}${footer}${ANSI_RESET}`);
	await readKey(io.stdin);
}

async function promptText(
	io: EditorIo,
	params: { title: string; prompt: string; initial?: string; hint?: string },
): Promise<string | null> {
	let value = params.initial ?? "";
	while (true) {
		writeScreen(io, [
			`${ANSI_BOLD}${ANSI_BRIGHT_PURPLE}IDU-PI · ${params.title}${ANSI_RESET}`,
			`${ANSI_DIM}${"─".repeat(Math.min(90, io.stdout.columns || 90))}${ANSI_RESET}`,
			"",
			params.hint ? `${ANSI_DIM}${params.hint}${ANSI_RESET}` : "",
			"",
			`${ANSI_CYAN}${params.prompt}${ANSI_RESET} ${ANSI_BOLD}${value}${ANSI_RESET}█`,
			"",
			`${ANSI_DIM}Enter Confirmar  ·  Esc / Ctrl+C Cancelar  ·  Backspace Borrar${ANSI_RESET}`,
		]);

		const key = await readKey(io.stdin);
		if (key.ctrl && key.name === "c") return null;
		if (key.name === "escape") return null;
		if (key.name === "return" || key.name === "enter") {
			const trimmed = value.trim();
			return trimmed.length > 0 ? trimmed : null;
		}
		if (key.name === "backspace") {
			value = value.slice(0, -1);
			continue;
		}
		const seq = key.sequence ?? "";
		if (seq.length === 1 && seq >= " " && seq !== "\x7f") {
			value += seq;
		} else if (seq.length > 1 && !seq.startsWith("\x1b")) {
			// Pasted text chunk
			value += seq.replace(/[\r\n]+/g, "");
		}
	}
}

async function promptSelect<T>(
	io: EditorIo,
	params: {
		title: string;
		subtitle?: string;
		items: Array<SelectItem<T>>;
		allowFilter?: boolean;
		pinnedValue?: T;
		extraActions?: Array<{ key: string; label: string }>;
	},
): Promise<{ kind: "select"; value: T; index: number; filter?: string } | { kind: "action"; key: string; item?: SelectItem<T> } | { kind: "cancel" }> {
	let filter = "";
	let selected = 0;
	let scroll = 0;
	const actionKeys = new Map((params.extraActions ?? []).map((a) => [a.key.toLowerCase(), a.key]));

	while (true) {
		const filtered = filter
			? (() => {
					const q = filter.toLowerCase();
					const matched = params.items.filter(
						(i) =>
							i.value !== params.pinnedValue &&
							(i.label.toLowerCase().includes(q) || (i.detail ?? "").toLowerCase().includes(q)),
					);
					const pinned =
						params.pinnedValue !== undefined
							? params.items.filter((i) => i.value === params.pinnedValue)
							: [];
					return [...matched, ...pinned];
				})()
			: params.items;
		if (selected >= filtered.length) selected = Math.max(0, filtered.length - 1);

		const height = Math.max(18, io.stdout.rows || 30);
		const pageRows = Math.max(6, height - 10);
		if (selected < scroll) scroll = selected;
		else if (selected >= scroll + pageRows) scroll = selected - pageRows + 1;

		const lines: string[] = [
			`${ANSI_BOLD}${ANSI_BRIGHT_PURPLE}IDU-PI · ${params.title}${ANSI_RESET}`,
		];
		if (params.subtitle) lines.push(`${ANSI_DIM}${params.subtitle}${ANSI_RESET}`);
		if (params.allowFilter) {
			lines.push(`${ANSI_CYAN}Filtro:${ANSI_RESET} ${filter || `${ANSI_DIM}(escribí para filtrar)${ANSI_RESET}`}`);
		}
		lines.push(`${ANSI_DIM}${"─".repeat(Math.min(100, io.stdout.columns || 100))}${ANSI_RESET}`);

		if (filtered.length === 0) {
			lines.push(`${ANSI_YELLOW}Sin coincidencias para "${filter}".${ANSI_RESET}`);
		} else {
			for (let row = 0; row < pageRows; row++) {
				const idx = scroll + row;
				const item = filtered[idx];
				if (!item) {
					lines.push("");
					continue;
				}
				const isSel = idx === selected;
				const prefix = isSel ? "►" : " ";
				const text = item.detail ? `${item.label}  ${ANSI_DIM}${item.detail}${ANSI_RESET}` : item.label;
				if (isSel) {
					lines.push(`${ANSI_REVERSE}${ANSI_CYAN}${prefix} ${item.label}${item.detail ? `  ${item.detail}` : ""}${ANSI_RESET}`);
				} else if (item.disabled) {
					lines.push(`${ANSI_DIM}${prefix} ${item.label}${item.detail ? `  ${item.detail}` : ""}${ANSI_RESET}`);
				} else {
					lines.push(`${prefix} ${text}`);
				}
			}
		}

		lines.push(`${ANSI_DIM}${"─".repeat(Math.min(100, io.stdout.columns || 100))}${ANSI_RESET}`);
		const extras = (params.extraActions ?? []).map((a) => `${a.key} ${a.label}`).join("  ·  ");
		lines.push(
			`${ANSI_DIM}↑/↓ Mover  ·  Enter Elegir${extras ? `  ·  ${extras}` : ""}  ·  Esc Volver${ANSI_RESET}`,
		);
		writeScreen(io, lines);

		const key = await readKey(io.stdin);
		if ((key.ctrl && key.name === "c") || key.name === "escape") {
			return { kind: "cancel" };
		}
		if (key.name === "down" || (!params.allowFilter && (key.name === "j" || key.sequence === "j"))) {
			if (filtered.length > 0) selected = Math.min(filtered.length - 1, selected + 1);
			continue;
		}
		if (key.name === "up" || (!params.allowFilter && (key.name === "k" || key.sequence === "k"))) {
			if (filtered.length > 0) selected = Math.max(0, selected - 1);
			continue;
		}
		if (key.name === "pagedown") {
			if (filtered.length > 0) selected = Math.min(filtered.length - 1, selected + Math.max(1, pageRows - 1));
			continue;
		}
		if (key.name === "pageup") {
			if (filtered.length > 0) selected = Math.max(0, selected - Math.max(1, pageRows - 1));
			continue;
		}
		if (key.name === "return" || key.name === "enter") {
			const picked = filtered[selected];
			if (picked && !picked.disabled) {
				return { kind: "select", value: picked.value, index: selected, filter };
			}
			continue;
		}

		const seq = key.sequence ?? "";
		if (!params.allowFilter && seq && actionKeys.has(seq.toLowerCase())) {
			return { kind: "action", key: actionKeys.get(seq.toLowerCase())!, item: filtered[selected] };
		}
		if (params.allowFilter) {
			if (key.name === "backspace") {
				filter = filter.slice(0, -1);
				selected = 0;
				scroll = 0;
				continue;
			}
			if (seq.length === 1 && seq >= " " && seq !== "\x7f") {
				filter += seq;
				selected = 0;
				scroll = 0;
				continue;
			}
		}
	}
}

async function promptConfirm(io: EditorIo, title: string, message: string): Promise<boolean> {
	while (true) {
		writeScreen(io, [
			`${ANSI_BOLD}${ANSI_YELLOW}IDU-PI · ${title}${ANSI_RESET}`,
			`${ANSI_DIM}${"─".repeat(Math.min(80, io.stdout.columns || 80))}${ANSI_RESET}`,
			"",
			message,
			"",
			`${ANSI_CYAN}[s/y] Sí confirmar${ANSI_RESET}   ·   ${ANSI_DIM}[n/Esc] Cancelar${ANSI_RESET}`,
		]);
		const key = await readKey(io.stdin);
		const s = (key.sequence ?? key.name ?? "").toLowerCase();
		if (s === "s" || s === "y") return true;
		if (s === "n" || key.name === "escape" || (key.ctrl && key.name === "c")) return false;
	}
}

async function pickModelInteractive(
	io: EditorIo,
	currentDisplay: string,
): Promise<string | null> {
	writeScreen(io, [
		`${ANSI_BOLD}${ANSI_BRIGHT_PURPLE}IDU-PI · Descubriendo modelos disponibles...${ANSI_RESET}`,
		`${ANSI_DIM}Consultando CLIs configurados y catálogo local (sin gasto)...${ANSI_RESET}`,
	]);

	let discoveredModels: Array<{ display: string; detail: string }> = [];
	try {
		const discovery = await discoverFleetCapabilities({ skipLiveEndpoints: false });
		const seen = new Map<string, { display: string; harnesses: Set<string>; billing: string }>();
		for (const c of discovery.candidates) {
			const display =
				c.provider && !c.modelId.startsWith(`${c.provider}/`)
					? `${c.provider}/${c.modelId}`
					: c.modelId;
			const existing = seen.get(display);
			if (existing) {
				existing.harnesses.add(c.harness);
			} else {
				seen.set(display, {
					display,
					harnesses: new Set([c.harness]),
					billing: c.billingModel,
				});
			}
		}
		discoveredModels = [...seen.values()]
			.sort((a, b) => a.display.localeCompare(b.display))
			.map((m) => ({
				display: m.display,
				detail: `[${m.billing}] CLIs: ${[...m.harnesses].join(", ")}`,
			}));
	} catch {
		// Fall back cleanly to manual input if discovery fails
	}

	if (discoveredModels.length === 0) {
		return promptText(io, {
			title: "Cambiar modelo manual",
			prompt: "Modelo (ej. nan/kimi-k3.1-pro):",
			initial: currentDisplay,
			hint: "Escribí provider/modelo (ej. nan/kimi-k3.1-pro, openai/gpt-6.1-terra, anthropic/opus).",
		});
	}

	const items: Array<SelectItem<string>> = [
		{
			label: "✎ Escribir modelo manualmente...",
			detail: `(actual: ${currentDisplay})`,
			value: "__manual__",
		},
		...discoveredModels.map((m) => ({
			label: m.display,
			detail: m.detail,
			value: m.display,
		})),
	];

	const choice = await promptSelect(io, {
		title: "Elegir modelo",
		subtitle: `Modelo actual: ${currentDisplay} — escribí para filtrar o elegí ingreso manual`,
		items,
		allowFilter: true,
		pinnedValue: "__manual__",
	});
	if (choice.kind !== "select") return null;
	if (choice.value === "__manual__") {
		return promptText(io, {
			title: "Ingresar modelo manual",
			prompt: "Modelo:",
			initial: choice.filter?.trim() ? choice.filter.trim() : currentDisplay,
			hint: "Ejemplos: nan/kimi-k3.1-pro · nan/deepseek-v4-flash · openai/gpt-6.1-terra · anthropic/opus",
		});
	}
	return choice.value;
}

const EFFORT_MENU_ORDER: ReadonlyArray<{ level: ReasoningEffort; hint: string }> = [
	{ level: "low", hint: "Rápido y económico (razonamiento corto)" },
	{ level: "medium", hint: "Equilibrado (default habitual en varios CLIs)" },
	{ level: "high", hint: "Profundo (recomendado para coding complejo y auditoría)" },
	{ level: "xhigh", hint: "Muy profundo (arquitectura y debugging difícil)" },
	{ level: "max", hint: "Máximo esfuerzo de razonamiento disponible" },
	{ level: "minimal", hint: "Mínimo razonamiento (casi directo)" },
	{ level: "off", hint: "Desactivar bloque/esfuerzo de pensamiento" },
];

async function pickEffortInteractive(
	io: EditorIo,
	params: {
		title: string;
		harness?: string;
		modelDisplay: string;
		currentProfile: Pick<IduProfile, "harness" | "provider" | "model" | "effort">;
		allowKeep?: boolean;
	},
): Promise<{ kind: "keep" } | { kind: "set"; effort?: ReasoningEffort } | { kind: "cancel" }> {
	const info: EffortInspection = inspectProfileEffort(params.currentProfile, homedir());
	const advertisedSet = info.advertisedModelLevels ? new Set(info.advertisedModelLevels) : null;
	const items: Array<SelectItem<string>> = [];

	if (params.allowKeep) {
		items.push({
			label: "0. Mantener esfuerzo actual",
			detail: `Actual: ${info.detail}`,
			value: "__keep__",
		});
	}

	items.push({
		label: `${info.explicit === undefined ? "● " : "  "}default`.padEnd(14),
		detail:
			info.source === "cli-default" && info.effective
				? `Sin override en perfil (actual en CLI: ${info.effective} via ${info.detail})`
				: "Sin override en perfil (usa default propio del CLI / modelo)",
		value: "__default__",
	});

	for (const entry of EFFORT_MENU_ORDER) {
		const isCurrent = info.explicit === entry.level;
		const modelNote = advertisedSet
			? advertisedSet.has(entry.level)
				? " · ✓ modelo soporta"
				: " · no listado en cache"
			: "";

		let compatNote = entry.hint;
		if (params.harness) {
			const argInfo = resolveHarnessEffortArg(params.harness, entry.level);
			if (!argInfo.supported) {
				compatNote = `Sin flag en ${params.harness} (se guarda para otras terminales)${modelNote}`;
			} else if (argInfo.mappedFrom) {
				compatNote = `En ${params.harness} se envía como ${argInfo.effective} (${argInfo.mechanism})${modelNote}`;
			} else {
				compatNote = `Nativo: ${argInfo.mechanism}${modelNote}`;
			}
		}

		items.push({
			label: `${isCurrent ? "★ " : "  "}${entry.level}`.padEnd(14),
			detail: compatNote,
			value: entry.level,
		});
	}

	const picked = await promptSelect(io, {
		title: params.title,
		subtitle: `Modelo: ${params.modelDisplay} · Actual: ${info.detail}`,
		items,
	});
	if (picked.kind !== "select") return { kind: "cancel" };
	if (picked.value === "__keep__") return { kind: "keep" };
	if (picked.value === "__default__") return { kind: "set", effort: undefined };
	return { kind: "set", effort: picked.value as ReasoningEffort };
}

async function runTerminalTestFlow(
	ctx: EditorContext,
	params: {
		slotName: string;
		role: string;
		rank: number;
		permissions: "read-only" | "workspace";
		modelInput: string;
		effort?: ReasoningEffort;
		existingDescription?: string;
	},
): Promise<ResolvedSlotUpdate | null> {
	const { io } = ctx;
	const progressLines: string[] = [];
	const effortLabel = params.effort ? ` · effort=${params.effort}` : "";
	const drawProgress = () => {
		writeScreen(io, [
			`${ANSI_BOLD}${ANSI_BRIGHT_PURPLE}IDU-PI · Test de Terminales para ${params.modelInput}${effortLabel}${ANSI_RESET}`,
			`${ANSI_DIM}Rol: ${params.role} · Slot: ${params.slotName} · ejecutando en sandboxes aislados...${ANSI_RESET}`,
			`${ANSI_DIM}${"─".repeat(Math.min(90, io.stdout.columns || 90))}${ANSI_RESET}`,
			"",
			...(progressLines.length > 0 ? progressLines.slice(-14) : ["Iniciando pruebas por terminal..."]),
		]);
	};
	drawProgress();

	let report: ModelTerminalTestReport;
	try {
		report = await testModelAcrossTerminals({
			role: params.role,
			modelInput: params.modelInput,
			...(params.effort ? { effort: params.effort } : {}),
			permissions: params.permissions,
			installedClisOverride: ctx.installedClis.map((c) => ({ name: c.name, available: c.available })),
			onProgress: (line) => {
				progressLines.push(line);
				drawProgress();
			},
		});
	} catch (err) {
		await waitForAnyKey(
			io,
			`Error al testear terminales: ${err instanceof Error ? err.message : String(err)}. Presioná una tecla...`,
		);
		return null;
	}

	const items: Array<SelectItem<string>> = report.results.map((r) => {
		const isRec = r.harness === report.recommendedHarness;
		const badge = isRec ? "★ RECOMENDADA" : !r.compatible ? "INCOMPATIBLE" : !r.available ? "NO INSTALADA" : r.resolved && r.regressionsClean ? "OK" : "FALLÓ";
		const sec = r.durationMs > 0 ? `${(r.durationMs / 1000).toFixed(1)}s` : "-";
		const tok = r.totalTokens !== null ? `${Math.round(r.totalTokens / 1000)}k tok` : "-";
		const detail =
			!r.compatible || !r.available
				? `[${badge}] ${r.incompatibleReason ?? r.unsupportedReason ?? ""}`
				: `[${badge}] pass=${r.resolved} regClean=${r.regressionsClean} ${sec} · ${tok} · score=${r.compositeBenchScore}`;
		return {
			label: r.harness.padEnd(14),
			detail,
			disabled: !r.compatible || !r.available,
			value: r.harness,
		};
	});

	const picked = await promptSelect(io, {
		title: `Resultados · ${report.parsedModel.display}`,
		subtitle: report.recommendationReason,
		items,
	});
	if (picked.kind !== "select") return null;

	const chosenCell = report.results.find((r) => r.harness === picked.value);
	const parsed = parseModelSpec(params.modelInput);
	const chosenEffort = params.effort ?? parsed.effortSuffix;
	const formatted = formatProfileFieldsForHarness(picked.value, parsed);
	const description = buildDynamicProfileDescription({
		slotName: params.slotName,
		role: params.role,
		rank: params.rank,
		existingDescription: params.existingDescription,
		harness: formatted.harness,
		provider: formatted.provider,
		model: formatted.model,
		...(chosenEffort ? { effort: chosenEffort } : {}),
		benchmark: chosenCell && chosenCell.durationMs > 0
			? {
					taskId: report.taskId,
					resolved: chosenCell.resolved,
					regressionsClean: chosenCell.regressionsClean,
					durationMs: chosenCell.durationMs,
					totalTokens: chosenCell.totalTokens,
					score: chosenCell.compositeBenchScore,
					testedCount: report.results.filter((r) => r.compatible && r.available).length,
					recommended: chosenCell.harness === report.recommendedHarness,
				}
			: undefined,
		manualNote: chosenCell && chosenCell.durationMs === 0 ? "configuración manual" : undefined,
	});

	return { ...formatted, ...(chosenEffort ? { effort: chosenEffort } : {}), description };
}

async function pickTerminalManualFlow(
	ctx: EditorContext,
	params: {
		slotName: string;
		role: string;
		rank: number;
		modelInput: string;
		effort?: ReasoningEffort;
		currentHarness?: string;
		existingDescription?: string;
	},
): Promise<ResolvedSlotUpdate | null> {
	const parsed = parseModelSpec(params.modelInput);
	const chosenEffort = params.effort ?? parsed.effortSuffix;
	const compatList = listCompatibleHarnessesForModel(
		parsed,
		ctx.installedClis.map((c) => ({ name: c.name, available: c.available })),
	);
	const items: Array<SelectItem<string>> = compatList.map((info) => {
		const curMark = info.harness === params.currentHarness ? " (actual)" : "";
		const availMark = info.available ? "CLI OK" : "no encontrado en PATH";
		const statusText = !info.compatible ? `INCOMPATIBLE: ${info.reason}` : availMark;
		return {
			label: `${info.harness}${curMark}`.padEnd(20),
			detail: statusText,
			disabled: !info.compatible,
			value: info.harness,
		};
	});

	const picked = await promptSelect(ioFromCtx(ctx), {
		title: `Elegir terminal manual · ${parsed.display}`,
		subtitle: `Slot ${params.slotName} (${params.role})${chosenEffort ? ` · effort=${chosenEffort}` : ""}`,
		items,
	});
	if (picked.kind !== "select") return null;

	const formatted = formatProfileFieldsForHarness(picked.value, parsed);
	const description = buildDynamicProfileDescription({
		slotName: params.slotName,
		role: params.role,
		rank: params.rank,
		existingDescription: params.existingDescription,
		harness: formatted.harness,
		provider: formatted.provider,
		model: formatted.model,
		...(chosenEffort ? { effort: chosenEffort } : {}),
		manualNote: chosenEffort ? `effort ${chosenEffort}` : "configuración manual",
	});
	return { ...formatted, ...(chosenEffort ? { effort: chosenEffort } : {}), description };
}

function ioFromCtx(ctx: EditorContext): EditorIo {
	return ctx.io;
}

export async function runEditModelAction(
	ctx: EditorContext,
	agent: EditorAgentTarget,
): Promise<boolean> {
	const chosenModel = await pickModelInteractive(ctx.io, agent.modelDisplay);
	if (!chosenModel) return false;

	let parsed;
	try {
		parsed = parseModelSpec(chosenModel);
	} catch (err) {
		await waitForAnyKey(ctx.io, `${err instanceof Error ? err.message : String(err)} — presioná una tecla...`);
		return false;
	}

	let chosenEffort: ReasoningEffort | undefined = parsed.effortSuffix ?? agent.rawProfile.effort;
	if (!parsed.effortSuffix) {
		const effPick = await pickEffortInteractive(ctx.io, {
			title: `Esfuerzo para ${parsed.display}`,
			modelDisplay: parsed.display,
			currentProfile: {
				harness: agent.harness,
				provider: parsed.provider ?? undefined,
				model: parsed.modelId,
				effort: agent.rawProfile.effort,
			},
			allowKeep: true,
		});
		if (effPick.kind === "cancel") return false;
		if (effPick.kind === "set") chosenEffort = effPick.effort;
	}

	const compatMap = new Map(
		listCompatibleHarnessesForModel(parsed, ctx.installedClis).map((c) => [c.harness, c]),
	);
	const currentCompat = compatMap.get(agent.harness);

	const strategy = await promptSelect<"test" | "manual" | "keep">(ctx.io, {
		title: `Modelo elegido: ${parsed.display}${chosenEffort ? ` · effort=${chosenEffort}` : ""}`,
		subtitle: `Slot: ${agent.name} (${agent.role}) · Terminal actual: ${agent.harness}`,
		items: [
			{
				label: "1. Testear terminales compatibles y recomendar la mejor",
				detail: "Corre el benchmark del rol en sandbox aislado y rankea terminales",
				value: "test",
			},
			{
				label: "2. Elegir una terminal manualmente",
				detail: `Seleccionar entre ${ALL_SUPPORTED_HARNESSES.join(", ")}`,
				value: "manual",
			},
			{
				label: `3. Mantener terminal actual (${agent.harness})`,
				detail: currentCompat?.compatible
					? "Actualiza modelo/esfuerzo y regenera la descripción"
					: `Incompatible: ${currentCompat?.reason ?? "no soporta este proveedor"}`,
				disabled: !currentCompat?.compatible,
				value: "keep",
			},
		],
	});
	if (strategy.kind !== "select") return false;

	let nextFields: ResolvedSlotUpdate | null = null;
	if (strategy.value === "test") {
		nextFields = await runTerminalTestFlow(ctx, {
			slotName: agent.name,
			role: agent.role,
			rank: agent.rank,
			permissions: agent.permissions,
			modelInput: chosenModel,
			...(chosenEffort ? { effort: chosenEffort } : {}),
			existingDescription: agent.description,
		});
	} else if (strategy.value === "manual") {
		nextFields = await pickTerminalManualFlow(ctx, {
			slotName: agent.name,
			role: agent.role,
			rank: agent.rank,
			modelInput: chosenModel,
			...(chosenEffort ? { effort: chosenEffort } : {}),
			currentHarness: agent.harness,
			existingDescription: agent.description,
		});
	} else {
		const formatted = formatProfileFieldsForHarness(agent.harness, parsed);
		nextFields = {
			...formatted,
			...(chosenEffort ? { effort: chosenEffort } : {}),
			description: buildDynamicProfileDescription({
				slotName: agent.name,
				role: agent.role,
				rank: agent.rank,
				existingDescription: agent.description,
				harness: formatted.harness,
				provider: formatted.provider,
				model: formatted.model,
				...(chosenEffort ? { effort: chosenEffort } : {}),
				manualNote: chosenEffort ? `effort ${chosenEffort}` : "configuración manual",
			}),
		};
	}

	if (!nextFields) return false;
	saveSlotProfileUpdate(ctx, agent.name, agent.rawProfile, nextFields);
	return true;
}

export async function runEditEffortAction(
	ctx: EditorContext,
	agent: EditorAgentTarget,
): Promise<boolean> {
	const picked = await pickEffortInteractive(ctx.io, {
		title: `Esfuerzo · ${agent.name} (${agent.harness})`,
		harness: agent.harness,
		modelDisplay: agent.modelDisplay,
		currentProfile: agent.rawProfile,
		allowKeep: false,
	});
	if (picked.kind !== "set") return false;

	const parsed = parseModelSpec(agent.rawProfile.model ?? "default", agent.rawProfile.provider);
	const formatted = formatProfileFieldsForHarness(agent.harness, parsed);
	const description = buildDynamicProfileDescription({
		slotName: agent.name,
		role: agent.role,
		rank: agent.rank,
		existingDescription: agent.description,
		harness: formatted.harness,
		provider: formatted.provider,
		model: formatted.model,
		...(picked.effort ? { effort: picked.effort } : {}),
		manualNote: picked.effort ? `effort ${picked.effort}` : "configuración manual",
	});
	saveSlotProfileUpdate(ctx, agent.name, agent.rawProfile, {
		...formatted,
		...(picked.effort ? { effort: picked.effort } : {}),
		description,
	});
	return true;
}

export async function runTestTerminalsForCurrentAgent(
	ctx: EditorContext,
	agent: EditorAgentTarget,
): Promise<boolean> {
	const preservedEffort = agent.rawProfile.effort ?? agent.effort;
	const result = await runTerminalTestFlow(ctx, {
		slotName: agent.name,
		role: agent.role,
		rank: agent.rank,
		permissions: agent.permissions,
		modelInput: agent.modelDisplay,
		...(preservedEffort ? { effort: preservedEffort } : {}),
		existingDescription: agent.description,
	});
	if (!result) return false;
	saveSlotProfileUpdate(ctx, agent.name, agent.rawProfile, result);
	return true;
}

export async function runManualTerminalAction(
	ctx: EditorContext,
	agent: EditorAgentTarget,
): Promise<boolean> {
	const preservedEffort = agent.rawProfile.effort ?? agent.effort;
	const result = await pickTerminalManualFlow(ctx, {
		slotName: agent.name,
		role: agent.role,
		rank: agent.rank,
		modelInput: agent.modelDisplay,
		...(preservedEffort ? { effort: preservedEffort } : {}),
		currentHarness: agent.harness,
		existingDescription: agent.description,
	});
	if (!result) return false;
	saveSlotProfileUpdate(ctx, agent.name, agent.rawProfile, result);
	return true;
}

export async function runCreateAgentAction(ctx: EditorContext): Promise<boolean> {
	const roleChoice = await promptSelect(ctx.io, {
		title: "Nuevo Agente · Elegí rol",
		subtitle: `Flota activa: ${ctx.activeFleet}`,
		items: CANONICAL_ROLES.map((r) => {
			const def = ROLE_SLOT_DEFAULTS[r];
			return {
				label: r,
				detail: `(${def.permissions}) ${def.concept}`,
				value: r,
			};
		}),
	});
	if (roleChoice.kind !== "select") return false;

	const suggestedSlot = nextAvailableSlotName(roleChoice.value, ctx.profiles);
	const slotName = await promptText(ctx.io, {
		title: "Nuevo Agente · Nombre del slot",
		prompt: "Nombre del slot (sin nombre de modelo):",
		initial: suggestedSlot,
		hint: `Sugerido: ${suggestedSlot}. Mantenelo agnóstico al modelo.`,
	});
	if (!slotName) return false;

	const modelInput = await pickModelInteractive(ctx.io, "nan/kimi-k3.1-pro");
	if (!modelInput) return false;

	let parsed;
	try {
		parsed = parseModelSpec(modelInput);
	} catch (err) {
		await waitForAnyKey(ctx.io, `${err instanceof Error ? err.message : String(err)} — presioná una tecla...`);
		return false;
	}

	let chosenEffort: ReasoningEffort | undefined = parsed.effortSuffix;
	if (!chosenEffort) {
		const effPick = await pickEffortInteractive(ctx.io, {
			title: `Nuevo Agente · Esfuerzo para ${parsed.display}`,
			modelDisplay: parsed.display,
			currentProfile: {
				harness: "opencode",
				provider: parsed.provider ?? undefined,
				model: parsed.modelId,
			},
			allowKeep: false,
		});
		if (effPick.kind === "cancel") return false;
		if (effPick.kind === "set") chosenEffort = effPick.effort;
	}

	const defaults = ROLE_SLOT_DEFAULTS[roleChoice.value];
	const strategy = await promptSelect<"test" | "manual">(ctx.io, {
		title: `Terminal para ${slotName} (${parsed.display}${chosenEffort ? ` · effort=${chosenEffort}` : ""})`,
		items: [
			{
				label: "1. Testear terminales compatibles y recomendar la mejor",
				value: "test",
			},
			{
				label: "2. Elegir terminal manualmente",
				value: "manual",
			},
		],
	});
	if (strategy.kind !== "select") return false;

	const rankMatch = slotName.match(/-(\d+)$/);
	const rank = rankMatch ? Number.parseInt(rankMatch[1], 10) : 1;
	const chosen =
		strategy.value === "test"
			? await runTerminalTestFlow(ctx, {
					slotName,
					role: roleChoice.value,
					rank,
					permissions: defaults.permissions,
					modelInput,
					...(chosenEffort ? { effort: chosenEffort } : {}),
				})
			: await pickTerminalManualFlow(ctx, {
					slotName,
					role: roleChoice.value,
					rank,
					modelInput,
					...(chosenEffort ? { effort: chosenEffort } : {}),
				});
	if (!chosen) return false;

	const profile: IduProfile = {
		harness: chosen.harness,
		...(chosen.provider ? { provider: chosen.provider } : {}),
		model: chosen.model,
		...(chosen.effort ? { effort: chosen.effort } : {}),
		permissions: defaults.permissions,
		description: chosen.description,
		streams: chosen.streams,
		timeoutMs: defaults.timeoutMs,
		idleTimeoutMs: defaults.idleTimeoutMs,
		hardCapMs: defaults.hardCapMs,
	};

	upsertFleetAgent({
		...fleetTarget(ctx),
		slotName,
		profile,
	});
	return true;
}

export async function runDeleteAgentAction(
	ctx: EditorContext,
	agent: EditorAgentTarget,
): Promise<boolean> {
	const ok = await promptConfirm(
		ctx.io,
		"Eliminar slot de agente",
		`¿Eliminar "${agent.name}" del perfil "${ctx.activeFleet}"? (Se crea backup automático antes de escribir.)`,
	);
	if (!ok) return false;
	deleteFleetAgent({ ...fleetTarget(ctx), slotName: agent.name });
	return true;
}

export async function runMigrateLegacyAction(ctx: EditorContext): Promise<boolean> {
	const legacyKeys = Object.keys(ctx.profiles).filter((k) => k in LEGACY_AGENT_ALIASES);
	if (legacyKeys.length === 0) {
		await waitForAnyKey(ctx.io, "Este perfil ya usa nombres agnósticos al modelo.");
		return false;
	}
	const preview = legacyKeys
		.slice(0, 6)
		.map((k) => `${k} → ${LEGACY_AGENT_ALIASES[k]}`)
		.join(", ");
	const ok = await promptConfirm(
		ctx.io,
		"Migrar nombres a slots por rol",
		`Se renombrarán ${legacyKeys.length} agente(s) en "${ctx.activeFleet}" (${preview}...) y se actualizarán descripciones con backup previo.`,
	);
	if (!ok) return false;
	migrateFleetFile({ ...fleetTarget(ctx), refreshDescriptions: true });
	return true;
}

export async function runManageFleetsAction(ctx: EditorContext): Promise<{ changed: boolean; fleetName?: string }> {
	while (true) {
		const fleets = listFleets();
		const choice = await promptSelect(ctx.io, {
			title: "Perfiles de Flota",
			subtitle: `Activo: ${ctx.activeFleet} · Proyecto actual: ${ctx.workingDir}`,
			items: fleets.map((f) => ({
				label: `${f.isActive ? "★ " : "  "}${f.name}`.padEnd(24),
				detail: `${f.agentCount} agentes · ${f.description ?? f.path}`,
				value: f.name,
			})),
			extraActions: [
				{ key: "c", label: "Crear" },
				{ key: "b", label: "Vincular proyecto" },
				{ key: "u", label: "Desvincular" },
				{ key: "r", label: "Renombrar" },
				{ key: "x", label: "Eliminar" },
			],
		});

		if (choice.kind === "cancel") {
			return { changed: false };
		}

		if (choice.kind === "select") {
			useFleet(choice.value);
			return { changed: true, fleetName: choice.value };
		}

		const selectedName = choice.item?.value;
		try {
			if (choice.key === "c") {
				const name = await promptText(ctx.io, {
					title: "Crear nuevo perfil de flota",
					prompt: "Nombre (ej. perfil-1, perfil-20, opencode-fast):",
					hint: "Se guardará como ~/.idu/fleets/<nombre>.json.",
				});
				if (!name) continue;
				const mode = await promptSelect<"clone" | "empty">(ctx.io, {
					title: `Contenido inicial para "${name}"`,
					items: [
						{ label: `Clonar agentes del perfil actual (${ctx.activeFleet})`, value: "clone" },
						{ label: "Empezar vacío (sin agentes pre-cargados)", value: "empty" },
					],
				});
				if (mode.kind !== "select") continue;
				const created = createFleet({
					name,
					fromFleet: ctx.activeFleet,
					empty: mode.value === "empty",
					migrateAliases: true,
					activate: true,
				});
				return { changed: true, fleetName: created.name };
			}
			if (choice.key === "b" && selectedName) {
				bindProjectFleet(selectedName, ctx.workingDir);
				return { changed: true, fleetName: selectedName };
			}
			if (choice.key === "u") {
				unbindProjectFleet(ctx.workingDir);
				return { changed: true };
			}
			if (choice.key === "r" && selectedName) {
				const nextName = await promptText(ctx.io, {
					title: `Renombrar "${selectedName}"`,
					prompt: "Nuevo nombre:",
					initial: selectedName,
				});
				if (!nextName) continue;
				const renamed = renameFleet(selectedName, nextName);
				return { changed: true, fleetName: renamed.name };
			}
			if (choice.key === "x" && selectedName) {
				const ok = await promptConfirm(
					ctx.io,
					"Eliminar perfil",
					`¿Seguro que querés eliminar el perfil "${selectedName}"?`,
				);
				if (!ok) continue;
				const res = deleteFleet(selectedName);
				return { changed: true, fleetName: res.activeFleet };
			}
		} catch (err) {
			await waitForAnyKey(ctx.io, `${err instanceof Error ? err.message : String(err)}`);
		}
	}
}

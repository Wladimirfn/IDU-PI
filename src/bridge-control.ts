import { spawn, type SpawnOptions } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, normalize } from "node:path";

export type BridgeControlAction = "status" | "restart" | "stop";

export type BridgeControlCommand = {
	file: string;
	args: string[];
	cwd: string;
};

export type BridgeControlLaunchResult =
	| { ok: true }
	| { ok: false; error: Error };

export type BridgeControlChild = {
	once(event: "error", listener: (error: Error) => void): unknown;
	removeListener(event: "error", listener: (error: Error) => void): unknown;
	unref(): void;
};

export type BridgeControlSpawner = (
	file: string,
	args: string[],
	options: SpawnOptions,
) => BridgeControlChild;

export type BridgeControlIntent = {
	type: "restart" | "stop";
	origin: "telegram" | "manual" | "scheduled-task" | "unknown";
	chatId?: number;
	reason?: string;
	notifyOnStartup: boolean;
	requestedAt: string;
};

export type BridgeStartupStatusInput = {
	origin: BridgeControlIntent["origin"] | "reset";
	pid: number;
	projectLabel: string;
	currentCwd: string;
	agentLabel: string;
	rpcRunning: boolean;
	iduActive: boolean;
	telegramCommandCount: number;
	now: Date;
};

const powershellArgs = [
	"powershell",
	"-NoProfile",
	"-ExecutionPolicy",
	"Bypass",
];

function cmdStartTitle(title: string): string {
	return `"${title}"`;
}

function normalizeBridgeRoot(root: string): string {
	const normalizedRoot = normalize(root);
	if (/[\r\n&|<>^;%!]/u.test(normalizedRoot)) {
		throw new Error("Bridge root contains unsafe shell metacharacters");
	}
	return normalizedRoot;
}

export function buildBridgeControlCommand(
	action: BridgeControlAction,
	root: string,
): BridgeControlCommand {
	const safeRoot = normalizeBridgeRoot(root);
	return {
		file: "cmd.exe",
		args: [
			"/c",
			"start",
			cmdStartTitle("pi-telegram-bridge-control"),
			"cmd.exe",
			"/c",
			...powershellArgs,
			"-File",
			join(safeRoot, "scripts", "bridge-control.ps1"),
			action,
		],
		cwd: safeRoot,
	};
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function spawnBridgeControl(
	action: BridgeControlAction,
	root: string,
	spawner: BridgeControlSpawner,
): BridgeControlChild {
	const command = buildBridgeControlCommand(action, root);
	return spawner(command.file, command.args, {
		cwd: command.cwd,
		detached: true,
		stdio: "ignore",
		windowsHide: false,
	});
}

export function tryLaunchBridgeControl(
	action: BridgeControlAction,
	root: string,
	spawner: BridgeControlSpawner = spawn,
): BridgeControlLaunchResult {
	try {
		const child = spawnBridgeControl(action, root, spawner);
		child.unref();
		return { ok: true };
	} catch (error) {
		return { ok: false, error: asError(error) };
	}
}

function waitForImmediateSpawnError(
	child: BridgeControlChild,
): Promise<BridgeControlLaunchResult> {
	return new Promise((resolve) => {
		let settled = false;
		let immediate: NodeJS.Immediate | undefined;

		const cleanup = (): void => {
			child.removeListener("error", onError);
			if (immediate !== undefined) clearImmediate(immediate);
		};
		const settle = (result: BridgeControlLaunchResult): void => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(result);
		};
		const onError = (error: Error): void => {
			settle({ ok: false, error: asError(error) });
		};

		child.once("error", onError);
		immediate = setImmediate(() => settle({ ok: true }));
	});
}

export async function launchBridgeControlSafely(
	action: BridgeControlAction,
	root: string,
	spawner: BridgeControlSpawner = spawn,
): Promise<BridgeControlLaunchResult> {
	try {
		const child = spawnBridgeControl(action, root, spawner);
		child.unref();
		return await waitForImmediateSpawnError(child);
	} catch (error) {
		return { ok: false, error: asError(error) };
	}
}

export function launchBridgeControl(
	action: BridgeControlAction,
	root: string,
): void {
	const result = tryLaunchBridgeControl(action, root);
	if (!result.ok) throw result.error;
}

export function bridgeControlIntentPath(root: string): string {
	return join(root, "logs", "bridge-control-intent.json");
}

export function writeBridgeControlIntent(
	path: string,
	intent: BridgeControlIntent,
): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(intent, null, 2)}\n`, "utf8");
}

export function consumeBridgeControlIntent(
	path: string,
): BridgeControlIntent | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
		rmSync(path, { force: true });
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return undefined;
		}
		const record = parsed as Record<string, unknown>;
		if (record.type !== "restart" && record.type !== "stop") return undefined;
		if (
			record.origin !== "telegram" &&
			record.origin !== "manual" &&
			record.origin !== "scheduled-task" &&
			record.origin !== "unknown"
		) {
			return undefined;
		}
		if (typeof record.notifyOnStartup !== "boolean") return undefined;
		if (typeof record.requestedAt !== "string") return undefined;
		return {
			type: record.type,
			origin: record.origin,
			chatId: typeof record.chatId === "number" ? record.chatId : undefined,
			reason: typeof record.reason === "string" ? record.reason : undefined,
			notifyOnStartup: record.notifyOnStartup,
			requestedAt: record.requestedAt,
		};
	} catch {
		try {
			rmSync(path, { force: true });
		} catch {
			// best effort cleanup only
		}
		return undefined;
	}
}

export function formatBridgeStartupStatus(
	input: BridgeStartupStatusInput,
): string {
	return [
		"✅ Bridge iniciado",
		"",
		"Estado: activo",
		`Origen: ${input.origin}`,
		`PID: ${input.pid}`,
		`Proyecto: ${input.projectLabel}`,
		`Proyecto target: ${input.currentCwd}`,
		`Pi/orquestador: ${input.rpcRunning ? "iniciado" : "en espera"}`,
		`Agente: ${input.agentLabel}`,
		`Idu-pi: ${input.iduActive ? "activo" : "inactivo"}`,
		`Comandos Telegram: ${input.telegramCommandCount}`,
		`Hora: ${input.now.toISOString()}`,
	].join("\n");
}

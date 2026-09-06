import type { PiRpcUiRequest } from "./pi-rpc.js";

export type ServerCommand = "run" | "restart" | "off" | "status";

export type TelegramInlineKeyboard = {
	inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export type UiCallbackData = {
	token: string;
	answer: string;
};

export function parseServerCommand(text: string): ServerCommand | undefined {
	const [, rawArg = "status"] =
		text.trim().match(/^\/server(?:\s+(\S+))?/iu) ?? [];
	const arg = rawArg.toLowerCase();
	if (arg === "reset") return "restart";
	if (arg === "run" || arg === "restart" || arg === "off" || arg === "status")
		return arg;
	return undefined;
}

export function isBlockingUiRequest(request: PiRpcUiRequest): boolean {
	return ["select", "confirm", "input", "editor"].includes(request.method);
}

export function formatUiRequestForTelegram(request: PiRpcUiRequest): string {
	const title = request.title || "Pi necesita una decisión";
	if (request.method === "confirm") {
		return `⚠️ ${title}\n${request.message || ""}\n\nRespondé SI o NO.`.trim();
	}
	if (request.method === "select") {
		const options = (request.options ?? [])
			.map((option, index) => `U${index + 1}. ${option}`)
			.join("\n");
		return `⚠️ ${title}\n\n${options}\n\nRespondé U1, U2... o /cancel.`.trim();
	}
	if (request.method === "notify") {
		return `ℹ️ ${request.message || title}`;
	}
	const hint = request.prefill || request.placeholder;
	return `⚠️ ${title}\n${hint ? `Sugerencia: ${hint}\n` : ""}\nRespondé con el texto para continuar, o /cancel.`.trim();
}

function normalize(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/gu, "")
		.replace(/\.$/u, "");
}

export function inlineKeyboardForUiRequest(
	request: PiRpcUiRequest,
	token = request.id,
): TelegramInlineKeyboard | undefined {
	if (request.method === "confirm") {
		return {
			inline_keyboard: [[
				{ text: "✅ Sí", callback_data: `ui:${token}:yes` },
				{ text: "❌ No", callback_data: `ui:${token}:no` },
			]],
		};
	}
	if (request.method === "select") {
		const buttons = (request.options ?? []).map((_option, index) => ({
			text: `U${index + 1}`,
			callback_data: `ui:${token}:${index + 1}`,
		}));
		return buttons.length ? { inline_keyboard: [buttons] } : undefined;
	}
	return undefined;
}

export function parseUiCallbackData(data: string): UiCallbackData | undefined {
	const match = data.match(/^ui:([^:]+):(.+)$/u);
	if (!match) return undefined;
	return { token: match[1], answer: match[2] };
}

export function parseUiRequestAnswer(
	request: PiRpcUiRequest,
	text: string,
): Record<string, unknown> | undefined {
	const normalized = normalize(text);
	if (normalized === "cancel" || normalized === "/cancel") {
		return { type: "extension_ui_response", id: request.id, cancelled: true };
	}

	if (request.method === "confirm") {
		if (["si", "s", "yes", "y", "1", "ok", "dale"].includes(normalized)) {
			return { type: "extension_ui_response", id: request.id, confirmed: true };
		}
		if (["no", "n", "2"].includes(normalized)) {
			return {
				type: "extension_ui_response",
				id: request.id,
				confirmed: false,
			};
		}
		return undefined;
	}

	if (request.method === "select") {
		const match = normalized.match(/^u?(\d+)$/u);
		if (!match) return undefined;
		const index = Number(match[1]);
		const options = request.options ?? [];
		if (!Number.isInteger(index) || index < 1 || index > options.length)
			return undefined;
		return {
			type: "extension_ui_response",
			id: request.id,
			value: options[index - 1],
		};
	}

	if (request.method === "input" || request.method === "editor") {
		return {
			type: "extension_ui_response",
			id: request.id,
			value: text.trim(),
		};
	}

	return { type: "extension_ui_response", id: request.id, confirmed: true };
}

import { readFileSync } from "node:fs";

export type SessionSummary = {
	firstUserText: string;
	lastUserText: string;
	lastAssistantText: string;
	titleHint: string;
	messageCount: number;
	subagentCount: number;
};

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: any) => {
			if (part?.type === "text" && typeof part.text === "string")
				return part.text;
			return "";
		})
		.filter(Boolean)
		.join("\n")
		.trim();
}

function titleCandidate(text: string): boolean {
	const normalized = text.trim();
	if (normalized.length < 3 || normalized.length > 80) return false;
	if (/^\d+\.?$/u.test(normalized)) return false;
	if (/^(hola|help|ayuda|sí|si|ok|perfecto)$/iu.test(normalized)) return false;
	if (
		/^(orquestación obligatoria|modo laboratorio|task:|resumen usuario:)/iu.test(
			normalized,
		)
	)
		return false;
	return !/[?¿]/u.test(normalized);
}

export function summarizeSessionFile(file: string): SessionSummary {
	let firstUserText = "";
	let lastUserText = "";
	let lastAssistantText = "";
	let titleHint = "";
	let messageCount = 0;
	let subagentCount = 0;

	for (const line of readFileSync(file, "utf8").split(/\r?\n/u)) {
		if (!line.trim()) continue;
		let entry: any;
		try {
			entry = JSON.parse(line);
		} catch {
			continue;
		}

		if (
			typeof entry?.customType === "string" &&
			entry.customType.includes("subagent")
		)
			subagentCount++;
		const message = entry?.message;
		if (!message?.role) continue;
		messageCount++;
		const text = textFromContent(message.content);
		if (!text) continue;
		if (message.role === "user") {
			if (!firstUserText) firstUserText = text;
			if (!titleHint && titleCandidate(text)) titleHint = text;
			lastUserText = text;
		} else if (message.role === "assistant") {
			lastAssistantText = text;
		}
	}

	return {
		firstUserText,
		lastUserText,
		lastAssistantText,
		titleHint,
		messageCount,
		subagentCount,
	};
}

export function oneLine(text: string, max = 90): string {
	const normalized = text.replace(/\s+/gu, " ").trim();
	if (normalized.length <= max) return normalized;
	return `${normalized.slice(0, max - 1)}…`;
}

export const TELEGRAM_MESSAGE_LIMIT = 4096;

export function chunkTelegramText(text: string, limit = 3900): string[] {
	const normalized = text.trim() || "(sin salida)";
	if (limit <= 0) throw new Error("limit must be positive");

	const chunks: string[] = [];
	let remaining = normalized;

	while (remaining.length > limit) {
		const newlineIndex = remaining.lastIndexOf("\n", limit);
		const spaceIndex = remaining.lastIndexOf(" ", limit);
		const splitAt = Math.max(
			newlineIndex,
			spaceIndex,
			Math.floor(limit * 0.75),
		);

		chunks.push(remaining.slice(0, splitAt).trimEnd());
		remaining = remaining.slice(splitAt).trimStart();
	}

	chunks.push(remaining);
	return chunks;
}

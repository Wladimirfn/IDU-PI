export function buildPrompt(userText: string, modePrefix?: string): string {
	const trimmed = userText.trim();
	if (!modePrefix?.trim()) return trimmed;
	return `${modePrefix.trim()}\n\nUser request:\n${trimmed}`;
}

export function createChildEnv(
	source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...source };
	delete env.TELEGRAM_BOT_TOKEN;
	delete env.ALLOWED_USER_ID;
	delete env.ALLOWED_ROOTS;
	delete env.DEFAULT_CWD;
	return env;
}

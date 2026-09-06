import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type SessionNameStore = Record<string, string>;

const filePath = join(process.cwd(), "data", "session-names.json");

export function loadSessionNames(path = filePath): SessionNameStore {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as SessionNameStore;
	} catch {
		return {};
	}
}

export function saveSessionNames(
	names: SessionNameStore,
	path = filePath,
): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(names, null, 2)}\n`);
}

export function getSessionName(
	names: SessionNameStore,
	sessionId: string,
): string | undefined {
	const value = names[sessionId]?.trim();
	return value || undefined;
}

export function setSessionName(
	names: SessionNameStore,
	sessionId: string,
	name: string,
): SessionNameStore {
	const normalized = name.replace(/\s+/gu, " ").trim();
	if (!normalized) throw new Error("Nombre vacío.");
	return { ...names, [sessionId]: normalized };
}

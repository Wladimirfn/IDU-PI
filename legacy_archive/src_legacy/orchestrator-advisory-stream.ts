/**
 * Orchestrator Advisory Stream — T1.5.
 *
 * The stream is a singleton that:
 * 1. Maintains an in-memory ring buffer of advisories (default 100).
 * 2. Persists advisories to disk as JSONL (stateRoot/reports/orchestrator-advisories.jsonl).
 * 3. Supports subscribe/unsubscribe for real-time listeners.
 * 4. Supports filtering by roleId, sinceMs, and limit.
 * 5. Tracks which advisories have been read per turnId.
 *
 * The stream is used by the RoleEngine to append advisories and by
 * consumers (CLI, MCP) to read them.
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { RoleAdvisory } from "./roles/index.js";

export type AdvisoryFilter = {
	roleId?: string;
	sinceMs?: number;
	limit?: number;
};

export type OrchestratorAdvisoryStream = {
	subscribe(listener: (advisory: RoleAdvisory) => void): () => void;
	getAdvisories(filter?: AdvisoryFilter): RoleAdvisory[];
	getNextAdvisory(turnId: string): RoleAdvisory | undefined;
	markAdvisoryRead(turnId: string, roleId: string): void;
	append(advisory: RoleAdvisory): void;
};

const DEFAULT_RING_BUFFER_SIZE = 100;

let singletonInstance: OrchestratorAdvisoryStream | null = null;
let singletonStateRoot: string | null = null;

/**
 * Get or create the singleton OrchestratorAdvisoryStream for the given stateRoot.
 * If called with a different stateRoot than the previous call, the singleton is reset.
 */
export function getOrchestratorAdvisoryStream(stateRoot: string): OrchestratorAdvisoryStream {
	// If stateRoot changed, reset the singleton
	if (singletonInstance && singletonStateRoot !== stateRoot) {
		singletonInstance = null;
		singletonStateRoot = null;
	}

	if (!singletonInstance) {
		singletonInstance = createOrchestratorAdvisoryStream(stateRoot);
		singletonStateRoot = stateRoot;
	}

	return singletonInstance;
}

/**
 * Reset the singleton. Used by tests to ensure isolation.
 */
export function resetOrchestratorAdvisoryStream(): void {
	singletonInstance = null;
	singletonStateRoot = null;
}

function createOrchestratorAdvisoryStream(stateRoot: string): OrchestratorAdvisoryStream {
	// In-memory ring buffer (bounded)
	const buffer: RoleAdvisory[] = [];
	const bufferSize = DEFAULT_RING_BUFFER_SIZE;

	// Listeners
	const listeners = new Set<(advisory: RoleAdvisory) => void>();

	// Read tracking: turnId -> Set of roleIds that have been read
	const readAdvisories = new Map<string, Set<string>>();

	// JSONL file path
	const reportsDir = join(stateRoot, "reports");
	const jsonlPath = join(reportsDir, "orchestrator-advisories.jsonl");

	// Ensure reports directory exists
	if (!existsSync(reportsDir)) {
		mkdirSync(reportsDir, { recursive: true });
	}

	function append(advisory: RoleAdvisory): void {
		// Add to ring buffer (bounded)
		if (buffer.length >= bufferSize) {
			// Remove oldest (first element)
			buffer.shift();
		}
		buffer.push(advisory);

		// Persist to JSONL
		try {
			const line = JSON.stringify(advisory) + "\n";
			appendFileSync(jsonlPath, line, "utf8");
		} catch (error) {
			// Log but don't throw - advisory persistence failure shouldn't break the engine
			console.error("Failed to persist advisory to JSONL:", error);
		}

		// Notify listeners
		for (const listener of listeners) {
			try {
				listener(advisory);
			} catch (error) {
				// Listener errors shouldn't break other listeners
				console.error("Listener error in advisory stream:", error);
			}
		}
	}

	function subscribe(listener: (advisory: RoleAdvisory) => void): () => void {
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
		};
	}

	function getAdvisories(filter?: AdvisoryFilter): RoleAdvisory[] {
		let result = [...buffer];

		// Filter by roleId
		if (filter?.roleId) {
			result = result.filter((a) => a.roleId === filter.roleId);
		}

		// Filter by sinceMs
		if (filter?.sinceMs !== undefined) {
			const sinceMs = filter.sinceMs;
			result = result.filter((a) => {
				const ts = Date.parse(a.ts);
				return !isNaN(ts) && ts >= sinceMs;
			});
		}

		// Apply limit
		if (filter?.limit !== undefined && filter.limit >= 0) {
			result = result.slice(0, filter.limit);
		}

		return result;
	}

	function getNextAdvisory(turnId: string): RoleAdvisory | undefined {
		// Get advisories that haven't been read for this turnId
		const readSet = readAdvisories.get(turnId) || new Set<string>();

		// Filter to unread advisories
		const unread = buffer.filter((a) => !readSet.has(a.roleId));

		if (unread.length === 0) {
			return undefined;
		}

		// Return highest priority (highest number = highest priority)
		// If priorities are equal, return the first one (oldest)
		unread.sort((a, b) => {
			if (b.priority !== a.priority) {
				return b.priority - a.priority;
			}
			return 0; // maintain original order
		});

		return unread[0];
	}

	function markAdvisoryRead(turnId: string, roleId: string): void {
		if (!readAdvisories.has(turnId)) {
			readAdvisories.set(turnId, new Set<string>());
		}
		readAdvisories.get(turnId)!.add(roleId);
	}

	return {
		subscribe,
		getAdvisories,
		getNextAdvisory,
		markAdvisoryRead,
		append,
	};
}

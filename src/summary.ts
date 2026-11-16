export function extractCleanSummary(stdout: string, harness = ""): string {
	if (!stdout) return "";

	const trimmed = stdout.trim();

	// Try parsing NDJSON lines (OpenCode / Claude stream-json / Command Code json / Pi json / mcode stream-json / kimi stream-json)
	const lines = trimmed.split("\n");
	const assistantTexts: string[] = [];
	const piTurnTexts: string[] = [];
	const piMessageEndTexts: string[] = [];
	let definitiveResult = "";
	let cmdcStreamedText = "";
	const normalizedHarness = harness.toLowerCase();
	const isCmdc = normalizedHarness === "commandcode" || normalizedHarness === "cmdc";

	const errorLabelForHarness = (): string => {
		if (normalizedHarness === "qwen" || normalizedHarness === "qwen-code") return "Qwen Code error";
		if (normalizedHarness === "claude" || normalizedHarness === "claude-code") return "Claude Code error";
		if (normalizedHarness === "mcode" || normalizedHarness === "minimax-code") return "minimax Code error";
		if (normalizedHarness === "opencode") return "OpenCode error";
		if (normalizedHarness === "kimi" || normalizedHarness === "kimi-code") return "Kimi error";
		if (normalizedHarness === "codex") return "Codex error";
		if (normalizedHarness === "antigravity" || normalizedHarness === "agy") return "Antigravity error";
		return "Command Code error";
	};

	const pushContentBlocks = (content: unknown, target: string[]): void => {
		if (typeof content === "string") {
			if (content) target.push(content);
		} else if (Array.isArray(content)) {
			for (const c of content) {
				if (c && typeof c === "object" && (c as Record<string, unknown>).type === "text") {
					const txt = (c as Record<string, unknown>).text;
					if (typeof txt === "string" && txt) target.push(txt);
				}
			}
		}
	};

	for (const line of lines) {
		const l = line.trim();
		if (!l.startsWith("{") || !l.endsWith("}")) continue;
		try {
			const parsed = JSON.parse(l);

			// minimax Code (mcode exec): supports both `--output-format json` (`exec.result`)
			// and `--output-format stream-json` (`exec.completed.result`).
			const execResult =
				parsed.type === "exec.result"
					? parsed
					: parsed.type === "exec.completed" && parsed.result?.type === "exec.result"
						? parsed.result
						: null;
			if (execResult) {
				if (typeof execResult.output === "string" && execResult.output.trim()) {
					definitiveResult = execResult.output.trim();
				} else if (typeof execResult.error === "string" && execResult.error.trim()) {
					definitiveResult = `minimax Code error: ${execResult.error.trim()}`;
				}
			}

			// Claude Code & Qwen Code final result event
			if (parsed.type === "result" && typeof parsed.result === "string" && parsed.result.trim()) {
				definitiveResult = parsed.result.trim();
			}

			// Command Code (cmdc) / Qwen / Claude error envelope on `type: "result"`
			if (parsed.type === "result") {
				if (typeof parsed.finalText === "string" && parsed.finalText.trim()) {
					definitiveResult = parsed.finalText.trim();
				} else if (parsed.error && typeof parsed.error.message === "string" && parsed.error.message.trim()) {
					definitiveResult = `${errorLabelForHarness()}: ${parsed.error.message.trim()}`;
				} else if (typeof parsed.error === "string" && parsed.error.trim()) {
					definitiveResult = `${errorLabelForHarness()}: ${parsed.error.trim()}`;
				} else if (parsed.is_error && Array.isArray(parsed.errors) && parsed.errors.length > 0) {
					const joined = parsed.errors
						.map((item: unknown) => (typeof item === "string" ? item : JSON.stringify(item)))
						.filter(Boolean)
						.join("; ");
					if (joined) definitiveResult = `${errorLabelForHarness()}: ${joined}`;
				}
			}

			// OpenCode NDJSON top-level error event (e.g. variant/model/auth error)
			if (parsed.type === "error" && parsed.error && typeof parsed.error === "object") {
				const errMsg = parsed.error.data?.message ?? parsed.error.message;
				if (typeof errMsg === "string" && errMsg.trim() && !definitiveResult) {
					definitiveResult = `${errorLabelForHarness()}: ${errMsg.trim()}`;
				}
			}

			// Command Code (cmdc) event stream (run_end or text_delta)
			if (parsed.type === "event" && parsed.event) {
				if (parsed.event.type === "run_end" && typeof parsed.event.result?.finalText === "string" && parsed.event.result.finalText.trim()) {
					definitiveResult = parsed.event.result.finalText.trim();
				} else if (parsed.event.type === "text_delta" && typeof parsed.event.delta === "string") {
					cmdcStreamedText += parsed.event.delta;
				}
			}

			// Antigravity (agy) result events (stream-json or json)
			if (parsed.event === "result" && typeof parsed.result?.response === "string" && parsed.result.response.trim()) {
				definitiveResult = parsed.result.response.trim();
			} else if (typeof parsed.response === "string" && parsed.response.trim()) {
				definitiveResult = parsed.response.trim();
			}

			// Codex & mcode stream-json `item.completed` agent messages (skip reasoning/tool items)
			if (parsed.type === "item.completed" && parsed.item && typeof parsed.item === "object") {
				if (parsed.item.type === "agent_message" || parsed.item.type === "message") {
					const itemText = parsed.item.text ?? parsed.item.content;
					if (typeof itemText === "string" && itemText) {
						assistantTexts.push(itemText);
					}
				}
			}

			// Pi / gentle-shell `--mode json` assistant messages (prefer turn_end, avoid agent_end duplication)
			if (parsed.type === "turn_end" && parsed.message?.role === "assistant") {
				pushContentBlocks(parsed.message.content, piTurnTexts);
			} else if (parsed.type === "message_end" && parsed.message?.role === "assistant") {
				pushContentBlocks(parsed.message.content, piMessageEndTexts);
			}

			// OpenCode NDJSON & Kimi stream-json events
			if (parsed.type === "text") {
				if (typeof parsed.text === "string" && parsed.text) {
					assistantTexts.push(parsed.text);
				} else if (parsed.part && typeof parsed.part.text === "string" && parsed.part.text) {
					assistantTexts.push(parsed.part.text);
				}
			} else if (parsed.type === "agent_message" && typeof parsed.message === "string") {
				assistantTexts.push(parsed.message);
			} else if ((parsed.type === "message" || !parsed.type) && parsed.role === "assistant") {
				pushContentBlocks(parsed.content, assistantTexts);
			}

			// Claude & Qwen stream-json assistant events
			if (parsed.type === "assistant" && parsed.message?.content) {
				pushContentBlocks(parsed.message.content, assistantTexts);
			}
		} catch {
			// not valid JSON line, ignore
		}
	}

	if (piTurnTexts.length > 0) {
		assistantTexts.push(...piTurnTexts);
	} else if (piMessageEndTexts.length > 0) {
		assistantTexts.push(...piMessageEndTexts);
	}

	if (cmdcStreamedText.trim()) {
		assistantTexts.push(cmdcStreamedText.trim());
	}

	if (definitiveResult) {
		return definitiveResult;
	}

	if (assistantTexts.length > 0) {
		const nonEmpty = assistantTexts.map((t) => t.trim()).filter(Boolean);
		if (nonEmpty.length > 0) {
			// Skip trivial trailing acks (< 20 chars) when an earlier substantive message exists,
			// while still capturing concise 20-100 char final replies instead of stale preambles.
			const lastMeaningful = [...nonEmpty].reverse().find((t) => t.length >= 20);
			return lastMeaningful ?? nonEmpty[nonEmpty.length - 1];
		}
	}

	// Plain-text fallback: strip wrapper header and footer markers
	const cleaned = trimmed
		.replace(/^=== IDU RUN START:[^=]+===\s*[\r\n]+(?:[^\r\n]+[\r\n]+){1,6}={20,}[\r\n]+/i, "")
		.replace(/[\r\n]+=== PROCESS (?:CLOSED|EXITED|ERROR)[^\r\n]*===[\r\n]*$/i, "")
		.trim();

	// If the harness is cmdc/commandcode, or output is an unparsed NDJSON stream, never leak raw NDJSON
	if (isCmdc || (cleaned.startsWith("{") && cleaned.endsWith("}") && cleaned.includes("\n{"))) {
		return "";
	}

	return cleaned;
}

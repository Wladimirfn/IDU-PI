export function extractCleanSummary(stdout: string, harness = ""): string {
	if (!stdout) return "";

	const trimmed = stdout.trim();

	// Try parsing NDJSON lines (OpenCode / Claude stream-json / Command Code json)
	const lines = trimmed.split("\n");
	const assistantTexts: string[] = [];
	let definitiveResult = "";
	let cmdcStreamedText = "";
	const normalizedHarness = harness.toLowerCase();
	const isCmdc = normalizedHarness === "commandcode" || normalizedHarness === "cmdc";

	for (const line of lines) {
		const l = line.trim();
		if (!l.startsWith("{") || !l.endsWith("}")) continue;
		try {
			const parsed = JSON.parse(l);

			// minimax Code (mcode exec) final result event. Its payload is
			// a single JSON object, not an NDJSON stream, so without this
			// branch the whole line would leak into the summary as raw JSON
			// instead of the agent's answer.
			if (parsed.type === "exec.result") {
				if (typeof parsed.output === "string" && parsed.output.trim()) {
					definitiveResult = parsed.output.trim();
				} else if (typeof parsed.error === "string" && parsed.error.trim()) {
					definitiveResult = `minimax Code error: ${parsed.error.trim()}`;
				}
			}

			// Claude final result event has the highest priority
			if (parsed.type === "result" && typeof parsed.result === "string" && parsed.result.trim()) {
				definitiveResult = parsed.result.trim();
			}

			// Command Code (cmdc) final result event
			if (parsed.type === "result") {
				if (typeof parsed.finalText === "string" && parsed.finalText.trim()) {
					definitiveResult = parsed.finalText.trim();
				} else if (parsed.error && typeof parsed.error.message === "string" && parsed.error.message.trim()) {
					definitiveResult = `Command Code error: ${parsed.error.message.trim()}`;
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

			// OpenCode NDJSON events
			if (parsed.type === "text") {
				if (typeof parsed.text === "string" && parsed.text) {
					assistantTexts.push(parsed.text);
				} else if (parsed.part && typeof parsed.part.text === "string" && parsed.part.text) {
					assistantTexts.push(parsed.part.text);
				}
			} else if (parsed.type === "agent_message" && typeof parsed.message === "string") {
				assistantTexts.push(parsed.message);
			} else if (parsed.type === "message" && parsed.role === "assistant") {
				if (typeof parsed.content === "string") {
					assistantTexts.push(parsed.content);
				} else if (Array.isArray(parsed.content)) {
					for (const c of parsed.content) {
						if (c?.type === "text" && c.text) assistantTexts.push(c.text);
					}
				}
			}

			// Claude stream-json events
			if (parsed.type === "assistant" && parsed.message?.content) {
				if (Array.isArray(parsed.message.content)) {
					for (const c of parsed.message.content) {
						if (c?.type === "text" && c.text) assistantTexts.push(c.text);
					}
				}
			}
		} catch {
			// not valid JSON line, ignore
		}
	}

	if (cmdcStreamedText.trim()) {
		assistantTexts.push(cmdcStreamedText.trim());
	}

	if (definitiveResult) {
		return definitiveResult;
	}

	if (assistantTexts.length > 0) {
		// If multiple messages, find the last substantial text block (the final answer/report)
		const lastSubstantial = [...assistantTexts].reverse().find((t) => t.length > 100);
		if (lastSubstantial) {
			return lastSubstantial.trim();
		}
		return assistantTexts[assistantTexts.length - 1].trim();
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

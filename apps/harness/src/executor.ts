import type { LlmProviderRuntimeConfig } from "@managed-agent/contracts";

/**
 * Harness-native event — no platform concepts (sessionId, entryId).
 * The consumer (API pi-executor) maps these to platform SessionRunEvents.
 */
export type HarnessEvent =
	| { type: "agent_start" }
	| { type: "agent_end" }
	| { type: "text_delta"; text: string }
	| { type: "tool_start"; toolCallId: string; name: string; arguments?: string }
	| { type: "tool_end"; toolCallId: string; name: string; result?: string; isError?: boolean };

export type HarnessInput = {
	model: string;
	thinkingLevel: string;
	prompt: string;
	piSessionFile?: string;
	cwd?: string;
	sessionDir?: string;
	llmProvider?: LlmProviderRuntimeConfig;
};

export type HarnessResult = { piSessionFile?: string };

export { resolveAdapter } from "./adapter.js";

import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import {
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	type ModelCycleResult,
	ModelRegistry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

/**
 * Harness-native event — no platform concepts (sessionId, entryId).
 * The consumer (API pi-executor) maps these to platform SessionRunEvents.
 */
export type HarnessEvent =
	| { type: "agent_start" }
	| { type: "agent_end" }
	| { type: "text_delta"; text: string }
	| {
			type: "tool_start";
			toolCallId: string;
			name: string;
			arguments?: string;
	  }
	| {
			type: "tool_end";
			toolCallId: string;
			name: string;
			result?: string;
			isError?: boolean;
	  };

export type HarnessInput = {
	model: string;
	thinkingLevel: string;
	prompt: string;
	piSessionFile?: string;
	cwd?: string;
	sessionDir?: string;
};

export type HarnessResult = { piSessionFile?: string };

export async function* runHarness(input: HarnessInput): AsyncGenerator<HarnessEvent, HarnessResult> {
	const cwd = input.cwd ?? process.cwd();
	const sessionDir = input.sessionDir ?? join(cwd, "pi-sessions");
	await mkdir(sessionDir, { recursive: true });
	const sessionRoot = dirname(sessionDir);

	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);

	const [provider, ...rest] = input.model.split("/");
	const modelId = rest.join("/");
	const selectedModel = provider && modelId ? modelRegistry.find(provider, modelId) : undefined;

	const sessionPath = input.piSessionFile
		? isAbsolute(input.piSessionFile)
			? input.piSessionFile
			: join(sessionRoot, input.piSessionFile)
		: undefined;
	const sessionManager = sessionPath
		? SessionManager.open(sessionPath, sessionDir, cwd)
		: SessionManager.create(cwd, sessionDir);

	const { session } = await createAgentSession({
		cwd,
		authStorage,
		modelRegistry,
		model: selectedModel,
		thinkingLevel: input.thinkingLevel as ModelCycleResult["thinkingLevel"],
		sessionManager,
	});

	const bufferedEvents: HarnessEvent[] = [];
	let nextToolCallIndex = 1;

	const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			const delta = event.assistantMessageEvent.delta;
			if (delta && delta.length > 0) {
				bufferedEvents.push({ type: "text_delta", text: delta });
			}
		}

		if (event.type === "tool_execution_start") {
			bufferedEvents.push({
				type: "tool_start",
				toolCallId: event.toolCallId?.length ? event.toolCallId : `tool_${nextToolCallIndex++}`,
				name: event.toolName,
				arguments: "args" in event ? JSON.stringify(event.args) : undefined,
			});
		}

		if (event.type === "tool_execution_end") {
			bufferedEvents.push({
				type: "tool_end",
				toolCallId: event.toolCallId?.length ? event.toolCallId : `tool_${nextToolCallIndex++}`,
				name: event.toolName,
				result: "result" in event && event.result ? JSON.stringify(event.result) : undefined,
				isError: "isError" in event ? event.isError : undefined,
			});
		}
	});

	try {
		yield { type: "agent_start" };
		await session.prompt(input.prompt);
		for (const event of bufferedEvents) yield event;
		yield { type: "agent_end" };
		return { piSessionFile: session.sessionFile };
	} finally {
		unsubscribe();
		session.dispose();
	}
}

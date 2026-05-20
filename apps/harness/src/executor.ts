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
import type { LlmProviderRuntimeConfig } from "@managed-agent/contracts";

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
	llmProvider?: LlmProviderRuntimeConfig;
};

export type HarnessResult = { piSessionFile?: string };

const createCompatibleModelDefinition = (provider: LlmProviderRuntimeConfig) => {
	const availableModels =
		provider.availableModels && provider.availableModels.length > 0
			? provider.availableModels
			: [
					{
						modelId: provider.modelId,
						displayName: provider.modelId,
						supportsReasoning: provider.supportsReasoning,
					},
				];

	return availableModels.map((modelDefinition) => ({
		id: modelDefinition.modelId,
		name: modelDefinition.displayName,
		reasoning: modelDefinition.supportsReasoning,
		input: ["text", "image"] as ("text" | "image")[],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 256_000,
		maxTokens: 32_768,
	}));
};

/**
 * Apply one resolved provider runtime config to the in-memory `pi-ai` auth and
 * model registries so the harness no longer depends on provider env vars.
 */
const applyRuntimeProviderConfig = ({
	authStorage,
	modelRegistry,
	llmProvider,
}: {
	authStorage: AuthStorage;
	modelRegistry: ModelRegistry;
	llmProvider: LlmProviderRuntimeConfig;
}) => {
	if (llmProvider.authMode === "api_key" && llmProvider.apiKey) {
		authStorage.set(llmProvider.runtimeProviderId, {
			type: "api_key",
			key: llmProvider.apiKey,
		});
	}

	if (llmProvider.authMode === "oauth" && llmProvider.oauthCredential) {
		authStorage.set(llmProvider.runtimeProviderId, {
			type: "oauth",
			access: llmProvider.oauthCredential.access,
			refresh: llmProvider.oauthCredential.refresh,
			expires: llmProvider.oauthCredential.expires,
		});
	}

	if (
		llmProvider.usesBuiltInProvider &&
		!llmProvider.baseUrl &&
		(!llmProvider.headers || Object.keys(llmProvider.headers).length === 0)
	) {
		return;
	}

	modelRegistry.registerProvider(llmProvider.runtimeProviderId, {
		name: llmProvider.displayName,
		baseUrl: llmProvider.baseUrl,
		api: llmProvider.apiType,
		headers: llmProvider.headers,
		authHeader: llmProvider.authHeader,
		...(llmProvider.usesBuiltInProvider
			? {}
			: {
					models: createCompatibleModelDefinition(llmProvider),
				}),
	});
};

export async function* runHarness(input: HarnessInput): AsyncGenerator<HarnessEvent, HarnessResult> {
	const cwd = input.cwd ?? process.cwd();
	const sessionDir = input.sessionDir ?? join(cwd, "pi-sessions");
	await mkdir(sessionDir, { recursive: true });
	const sessionRoot = dirname(sessionDir);

	const authStorage = input.llmProvider ? AuthStorage.inMemory() : AuthStorage.create();
	const modelRegistry = input.llmProvider ? ModelRegistry.inMemory(authStorage) : ModelRegistry.create(authStorage);

	if (input.llmProvider) {
		applyRuntimeProviderConfig({
			authStorage,
			modelRegistry,
			llmProvider: input.llmProvider,
		});
	}

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

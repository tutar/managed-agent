/**
 * Shared contracts between managed-agent-api and harness-worker.
 *
 * Service-to-service payloads and shared transcript-facing entry types live
 * here so application packages never import each other's internal `src/`
 * modules directly.
 */
export type TextContentItem = {
	type: "text";
	text: string;
};

export type MediaContentItem = {
	type: "image" | "video";
	url: string;
};

export type ToolCallContentItem = {
	type: "tool_call";
	toolCallId: string;
	toolName: string;
	status: "started" | "completed" | "error";
	arguments?: string;
	result?: string;
	error?: string;
};

export type InputContentItem = TextContentItem | MediaContentItem;
export type DemoContentItem = TextContentItem | MediaContentItem | ToolCallContentItem;

export type DemoInput = {
	content: InputContentItem[];
};

export type ProviderAuthMode = "api_key" | "oauth" | "none";

export type ProviderApiType =
	| "openai-completions"
	| "openai-responses"
	| "anthropic-messages"
	| "google-generative-ai";

export type OAuthCredentialMaterial = {
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
	enterpriseUrl?: string;
};

export type LlmProviderModelDefinition = {
	modelId: string;
	displayName: string;
	supportsReasoning: boolean;
	supportedThinkingLevels?: string[];
};

export type LlmProviderRuntimeConfig = {
	providerConfigId: string;
	providerType: string;
	runtimeProviderId: string;
	displayName: string;
	modelId: string;
	authMode: ProviderAuthMode;
	apiType?: ProviderApiType;
	baseUrl?: string;
		anthropicBaseUrl?: string;
	apiKey?: string;
	headers?: Record<string, string>;
	authHeader?: boolean;
	oauthCredential?: OAuthCredentialMaterial;
	usesBuiltInProvider: boolean;
	supportsReasoning: boolean;
	availableModels?: LlmProviderModelDefinition[];
};

type BaseEntry = {
	id: string;
	parentId: string | null;
	createdAt: string;
};

export type UserEntry = {
	messageType: "user";
	content: DemoContentItem[];
	input: DemoInput;
} & BaseEntry;

export type ProcessEntry = {
	messageType: "process";
	content: DemoContentItem[];
} & BaseEntry & { parentId: string };

export type AssistantEntry = {
	messageType: "assistant";
	content: DemoContentItem[];
} & BaseEntry & { parentId: string };

export type SessionEntry = UserEntry | ProcessEntry | AssistantEntry;

export type SessionRunJob = {
	sessionId: string;
	model: string;
	thinkingLevel: string;
	providerConfigId?: string;
	providerType?: string;
	input: DemoInput;
	piSessionFile?: string;
	llmProvider?: LlmProviderRuntimeConfig;
	userEntry: UserEntry;
	processEntryId: string;
	finalEntryId: string;
};

export type SessionRunEvent =
	| {
			type: "process.delta";
			data: {
				sessionId: string;
				entryId: string;
				parentId: string;
				text: string;
			};
	  }
	| {
			type: "action.started" | "action.completed" | "action.failed";
			data: {
				sessionId: string;
				entryId: string;
				parentId: string;
				toolCallId: string;
				name: string;
				arguments?: string;
				result?: string;
				error?: string;
			};
	  }
	| {
			type: "final.output.delta";
			data: {
				sessionId: string;
				entryId: string;
				parentId: string;
				text: string;
			};
	  }
	| {
			type: "final.output.completed";
			data: {
				sessionId: string;
				entryId: string;
			};
	  }
	| {
			type: "run.failed";
			data: {
				sessionId: string;
				entryId: string;
				parentId: string;
				code: string;
				message: string;
			};
	  };

export type SessionRunCompletion = {
	piSessionFile?: string;
};


export interface SessionExecutor {
	run(
		job: SessionRunJob,
	): AsyncGenerator<SessionRunEvent, SessionRunCompletion>;
}

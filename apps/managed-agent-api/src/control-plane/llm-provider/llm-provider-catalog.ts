import type {
	CapabilityTier,
	LlmProviderModelDefinition,
	OAuthCredentialMaterial,
	ProviderApiType,
	ProviderAuthMode,
} from "@managed-agent/contracts";

/**
 * Static provider-type catalog used by the API and the settings UI.
 *
 * The registry is intentionally declarative: the API owns which provider types
 * are supported, which auth mode they require, and whether they map to a
 * built-in `pi-ai` provider or to a generic compatible API shape.
 */
export type LlmProviderTypeCatalogItem = {
	providerType: string;
	displayName: string;
	authMode: ProviderAuthMode;
	runtimeProviderId: string;
	usesBuiltInProvider: boolean;
	apiType?: ProviderApiType;
	supportsCustomBaseUrl: boolean;
	supportsCustomHeaders: boolean;
	baseUrlRequired: boolean;
	defaultModels: LlmProviderModelDefinition[];
	defaultCapabilityModelIds: Partial<Record<CapabilityTier, string>>;
	defaultThinkingLevel: string;
	secretFields: Array<"apiKey" | "oauthCredential">;
	helpText?: string;
};

export type StoredProviderSecretMaterial = {
	apiKey?: string;
	oauthCredential?: OAuthCredentialMaterial;
};

const createBuiltInCatalogItem = ({
	providerType,
	displayName,
	runtimeProviderId = providerType,
	authMode = "api_key",
	defaultModelId,
	defaultThinkingLevel = "medium",
	helpText,
}: {
	providerType: string;
	displayName: string;
	runtimeProviderId?: string;
	authMode?: ProviderAuthMode;
	defaultModelId: string;
	defaultThinkingLevel?: string;
	helpText?: string;
}): LlmProviderTypeCatalogItem => {
	return {
		providerType,
		displayName,
		authMode,
		runtimeProviderId,
		usesBuiltInProvider: true,
		supportsCustomBaseUrl: true,
		supportsCustomHeaders: true,
		baseUrlRequired: false,
		defaultModels: [
			{
				modelId: defaultModelId,
				displayName: defaultModelId,
				supportsReasoning: true,
			},
		],
		defaultCapabilityModelIds: {
			balanced: defaultModelId,
			strong: defaultModelId,
		},
		defaultThinkingLevel,
		secretFields: authMode === "oauth" ? ["oauthCredential"] : authMode === "none" ? [] : ["apiKey"],
		helpText,
	};
};

const createCompatibleCatalogItem = ({
	providerType,
	displayName,
	apiType,
	authMode = "api_key",
	defaultModelId,
	defaultThinkingLevel = "medium",
	helpText,
}: {
	providerType: string;
	displayName: string;
	apiType: ProviderApiType;
	authMode?: ProviderAuthMode;
	defaultModelId: string;
	defaultThinkingLevel?: string;
	helpText?: string;
}): LlmProviderTypeCatalogItem => {
	return {
		providerType,
		displayName,
		authMode,
		runtimeProviderId: providerType,
		usesBuiltInProvider: false,
		apiType,
		supportsCustomBaseUrl: true,
		supportsCustomHeaders: true,
		baseUrlRequired: true,
		defaultModels: [
			{
				modelId: defaultModelId,
				displayName: defaultModelId,
				supportsReasoning: true,
			},
		],
		defaultCapabilityModelIds: {
			balanced: defaultModelId,
			strong: defaultModelId,
		},
		defaultThinkingLevel,
		secretFields: authMode === "oauth" ? ["oauthCredential"] : authMode === "none" ? [] : ["apiKey"],
		helpText,
	};
};

export const LLM_PROVIDER_TYPE_CATALOG: LlmProviderTypeCatalogItem[] = [
	createBuiltInCatalogItem({
		providerType: "openai",
		displayName: "OpenAI",
		defaultModelId: "gpt-5.4",
	}),
	createBuiltInCatalogItem({
		providerType: "azure-openai-responses",
		displayName: "Azure OpenAI (Responses)",
		defaultModelId: "gpt-5.4",
		helpText: "Configure the Azure endpoint as a custom base URL if you are not using the default account endpoint.",
	}),
	createBuiltInCatalogItem({
		providerType: "openai-codex",
		displayName: "OpenAI Codex (ChatGPT Plus/Pro)",
		authMode: "oauth",
		defaultModelId: "gpt-5.5",
		helpText: "Requires OAuth credential material from the linked ChatGPT subscription.",
	}),
	createBuiltInCatalogItem({
		providerType: "deepseek",
		displayName: "DeepSeek",
		defaultModelId: "deepseek-v4-pro",
	}),
	createBuiltInCatalogItem({
		providerType: "anthropic",
		displayName: "Anthropic",
		defaultModelId: "claude-opus-4-7",
	}),
	createBuiltInCatalogItem({
		providerType: "google",
		displayName: "Google",
		defaultModelId: "gemini-3.1-pro-preview",
	}),
	createBuiltInCatalogItem({
		providerType: "vertex-ai",
		displayName: "Vertex AI (Gemini via Vertex AI)",
		runtimeProviderId: "google-vertex",
		defaultModelId: "gemini-3.1-pro-preview",
	}),
	createBuiltInCatalogItem({
		providerType: "mistral",
		displayName: "Mistral",
		defaultModelId: "devstral-medium-latest",
	}),
	createBuiltInCatalogItem({
		providerType: "groq",
		displayName: "Groq",
		defaultModelId: "openai/gpt-oss-120b",
	}),
	createBuiltInCatalogItem({
		providerType: "cerebras",
		displayName: "Cerebras",
		defaultModelId: "zai-glm-4.7",
	}),
	createBuiltInCatalogItem({
		providerType: "cloudflare-ai-gateway",
		displayName: "Cloudflare AI Gateway",
		defaultModelId: "workers-ai/@cf/moonshotai/kimi-k2.6",
	}),
	createBuiltInCatalogItem({
		providerType: "cloudflare-workers-ai",
		displayName: "Cloudflare Workers AI",
		defaultModelId: "@cf/moonshotai/kimi-k2.6",
	}),
	createBuiltInCatalogItem({
		providerType: "xai",
		displayName: "xAI",
		defaultModelId: "grok-4.20-0309-reasoning",
	}),
	createBuiltInCatalogItem({
		providerType: "openrouter",
		displayName: "OpenRouter",
		defaultModelId: "moonshotai/kimi-k2.6",
	}),
	createBuiltInCatalogItem({
		providerType: "vercel-ai-gateway",
		displayName: "Vercel AI Gateway",
		defaultModelId: "zai/glm-5.1",
	}),
	createBuiltInCatalogItem({
		providerType: "minimax",
		displayName: "MiniMax",
		defaultModelId: "MiniMax-M2.7",
	}),
	createCompatibleCatalogItem({
		providerType: "together-ai",
		displayName: "Together AI",
		apiType: "openai-completions",
		defaultModelId: "deepseek-ai/DeepSeek-V3.1",
		helpText: "Together AI is configured through its OpenAI-compatible API endpoint.",
	}),
	createBuiltInCatalogItem({
		providerType: "github-copilot",
		displayName: "GitHub Copilot",
		authMode: "oauth",
		defaultModelId: "gpt-5.4",
		helpText: "Requires OAuth credential material from the linked GitHub Copilot account.",
	}),
	createBuiltInCatalogItem({
		providerType: "amazon-bedrock",
		displayName: "Amazon Bedrock",
		authMode: "none",
		defaultModelId: "us.anthropic.claude-opus-4-6-v1",
		helpText: "Current v1 assumes the harness runs with ambient AWS credentials instead of a stored API key.",
	}),
	createBuiltInCatalogItem({
		providerType: "opencode-zen",
		displayName: "OpenCode Zen",
		runtimeProviderId: "opencode",
		defaultModelId: "kimi-k2.6",
	}),
	createBuiltInCatalogItem({
		providerType: "opencode-go",
		displayName: "OpenCode Go",
		defaultModelId: "kimi-k2.6",
	}),
	createBuiltInCatalogItem({
		providerType: "fireworks",
		displayName: "Fireworks",
		defaultModelId: "accounts/fireworks/models/kimi-k2p6",
	}),
	createBuiltInCatalogItem({
		providerType: "kimi-for-coding",
		displayName: "Kimi For Coding",
		runtimeProviderId: "kimi-coding",
		defaultModelId: "kimi-for-coding",
	}),
	createBuiltInCatalogItem({
		providerType: "xiaomi-mimo",
		displayName: "Xiaomi MiMo",
		runtimeProviderId: "xiaomi",
		defaultModelId: "mimo-v2.5-pro",
		helpText:
			"Token Plan variants can be represented by configuring a custom base URL or a dedicated provider instance.",
	}),
	createCompatibleCatalogItem({
		providerType: "openai-compatible",
		displayName: "Any OpenAI-compatible API",
		apiType: "openai-completions",
		defaultModelId: "local-model",
		helpText: "Use this type for Ollama, vLLM, LM Studio, or any other OpenAI-compatible API.",
	}),
];

const providerTypeCatalogMap = new Map(LLM_PROVIDER_TYPE_CATALOG.map((item) => [item.providerType, item] as const));

/** Read one provider type definition from the immutable system catalog. */
export const getLlmProviderTypeCatalogItem = (providerType: string) => {
	return providerTypeCatalogMap.get(providerType);
};

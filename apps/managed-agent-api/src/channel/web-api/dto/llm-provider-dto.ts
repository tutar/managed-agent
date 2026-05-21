import type { LlmProviderTypeCatalogItem } from "../../../control-plane/llm-provider/llm-provider-catalog.js";
import type { LlmProviderConfigSummary } from "../../../control-plane/llm-provider/llm-provider-service.js";
import type {
	LlmProviderConfigPatchSchemaDto,
	LlmProviderConfigRequestSchemaDto,
	LlmProviderOAuthStartRequestSchemaDto,
	OAuthCredentialSchemaDto,
} from "../schemas/llm-provider-schema.js";

export type UpsertLlmProviderConfigRequestDto = {
	providerType?: string;
	displayName?: string;
	baseUrl?: string;
	anthropicBaseUrl?: string;
	headers?: Record<string, string>;
	availableModels?: string[];
	defaultModelId?: string;
	defaultThinkingLevel?: string;
	enabled?: boolean;
	apiKey?: string;
	oauthCredential?: OAuthCredentialSchemaDto;
};

export type LlmProviderOAuthStartRequestDto = {
	enterpriseUrl?: string;
};

const trimOptionalString = (value?: string) => {
	const trimmedValue = value?.trim();
	return trimmedValue && trimmedValue.length > 0 ? trimmedValue : undefined;
};

const normalizeHeaders = (headers: Record<string, string> | undefined) => {
	if (!headers) {
		return undefined;
	}

	return Object.fromEntries(
		Object.entries(headers)
			.map(([key, value]) => [key.trim(), value.trim()] as const)
			.filter(([key, value]) => key.length > 0 && value.length > 0),
	);
};

const normalizeModels = (availableModels?: string[]) => {
	if (!availableModels) {
		return undefined;
	}

	const normalizedModels = availableModels.map((modelId) => modelId.trim()).filter((modelId) => modelId.length > 0);

	return normalizedModels.length > 0 ? normalizedModels : undefined;
};

/** Normalize validated provider-config create/update input into service DTOs. */
export const toUpsertLlmProviderConfigRequestDto = (
	body: LlmProviderConfigRequestSchemaDto | LlmProviderConfigPatchSchemaDto,
): UpsertLlmProviderConfigRequestDto => {
	return {
		providerType: "providerType" in body ? trimOptionalString(body.providerType) : undefined,
		displayName: "displayName" in body ? trimOptionalString(body.displayName) : undefined,
		baseUrl: "baseUrl" in body ? trimOptionalString(body.baseUrl) : undefined,
		anthropicBaseUrl: "anthropicBaseUrl" in body ? trimOptionalString(body.anthropicBaseUrl) : undefined,
		headers: "headers" in body ? normalizeHeaders(body.headers) : undefined,
		availableModels: "availableModels" in body ? normalizeModels(body.availableModels) : undefined,
		defaultModelId: "defaultModelId" in body ? trimOptionalString(body.defaultModelId) : undefined,
		defaultThinkingLevel: "defaultThinkingLevel" in body ? trimOptionalString(body.defaultThinkingLevel) : undefined,
		enabled: "enabled" in body ? body.enabled : undefined,
		apiKey: "apiKey" in body ? trimOptionalString(body.apiKey) : undefined,
		oauthCredential: "oauthCredential" in body ? body.oauthCredential : undefined,
	};
};

/** Normalize OAuth-start input into the internal flow-service request shape. */
export const toLlmProviderOAuthStartRequestDto = (
	body: LlmProviderOAuthStartRequestSchemaDto,
): LlmProviderOAuthStartRequestDto => ({
	enterpriseUrl: trimOptionalString(body.enterpriseUrl),
});

export type LlmProviderTypeResponseDto = LlmProviderTypeCatalogItem;
export type LlmProviderConfigResponseDto = LlmProviderConfigSummary;

/** Pass provider-type catalog items straight through to the public API shape. */
export const toLlmProviderTypeResponseDto = (providerType: LlmProviderTypeCatalogItem) => providerType;

/** Map one provider config summary into the public response shape. */
export const toLlmProviderConfigResponseDto = (providerConfig: LlmProviderConfigSummary) => providerConfig;

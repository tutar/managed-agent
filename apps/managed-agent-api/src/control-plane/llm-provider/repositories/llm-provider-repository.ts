import type {
	LlmProviderModelDefinition,
	OAuthCredentialMaterial,
	ProviderApiType,
	ProviderAuthMode,
} from "@managed-agent/contracts";

export type StoredProviderSecretMaterial = {
	apiKey?: string;
	oauthCredential?: OAuthCredentialMaterial;
};

export type LlmProviderConfigRecord = {
	providerConfigId: string;
	userId: string;
	providerType: string;
	displayName: string;
	authMode: ProviderAuthMode;
	encryptedSecret?: string;
	baseUrl?: string;
	anthropicBaseUrl?: string;
	apiType?: ProviderApiType;
	headers: Record<string, string>;
	providerOptions: Record<string, unknown>;
	availableModels: LlmProviderModelDefinition[];
	defaultModelId: string;
	defaultThinkingLevel: string;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
};

export type CreateLlmProviderConfigRecord = Omit<LlmProviderConfigRecord, "createdAt" | "updatedAt"> & {
	createdAt?: string;
	updatedAt?: string;
};

export type UpdateLlmProviderConfigRecord = Partial<
	Omit<LlmProviderConfigRecord, "providerConfigId" | "userId" | "createdAt" | "encryptedSecret">
> & {
	encryptedSecret?: string | null;
	updatedAt: string;
};

/**
 * Durable provider-registry repository contract.
 *
 * Provider configuration truth lives in PostgreSQL. The control plane owns
 * secret encryption and runtime resolution on top of these raw durable rows.
 */
export interface LlmProviderRepository {
	createProviderConfig(record: CreateLlmProviderConfigRecord): Promise<void>;
	getProviderConfig(providerConfigId: string): Promise<LlmProviderConfigRecord | null>;
	listProviderConfigs(userId: string): Promise<LlmProviderConfigRecord[]>;
	updateProviderConfig(
		providerConfigId: string,
		userId: string,
		patch: UpdateLlmProviderConfigRecord,
	): Promise<LlmProviderConfigRecord | null>;
	deleteProviderConfig(providerConfigId: string, userId: string): Promise<boolean>;
}

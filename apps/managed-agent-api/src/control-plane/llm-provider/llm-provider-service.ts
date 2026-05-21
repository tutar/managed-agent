import { randomUUID } from "node:crypto";

import type {
	LlmProviderModelDefinition,
	LlmProviderRuntimeConfig,
	OAuthCredentialMaterial,
	ProviderAuthMode,
} from "@managed-agent/contracts";
import { NotFoundError, ValidationError } from "../../channel/web-api/errors/http-errors.js";
import { createSecretsCrypto } from "../../infrastructure/security/secrets-crypto.js";
import { getLlmProviderTypeCatalogItem, LLM_PROVIDER_TYPE_CATALOG } from "./llm-provider-catalog.js";
import type {
	LlmProviderConfigRecord,
	LlmProviderRepository,
	StoredProviderSecretMaterial,
} from "./repositories/llm-provider-repository.js";

type ProviderConfigInput = {
	providerType: string;
	displayName?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
	availableModels?: string[];
	defaultModelId?: string;
	defaultThinkingLevel?: string;
	enabled?: boolean;
	apiKey?: string;
	oauthCredential?: {
		access: string;
		refresh: string;
		expires: number;
		accountId?: string;
		enterpriseUrl?: string;
	};
};

export type LlmProviderConfigSummary = {
	providerConfigId: string;
	providerType: string;
	displayName: string;
	authMode: ProviderAuthMode;
	baseUrl?: string;
	anthropicBaseUrl?: string;
	headers: Record<string, string>;
	availableModels: LlmProviderModelDefinition[];
	defaultModelId: string;
	defaultThinkingLevel: string;
	enabled: boolean;
	hasStoredCredential: boolean;
};

type ResolvedModelSelection = {
	modelId: string;
	thinkingLevel?: string;
};

const trimOptionalString = (value: string | undefined) => {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const normalizeAvailableModels = ({
	requestedModels,
	catalogDefaultModels,
}: {
	requestedModels?: string[];
	catalogDefaultModels: LlmProviderModelDefinition[];
}) => {
	const catalogDefaultSupportsReasoning = catalogDefaultModels.some((model) => model.supportsReasoning);
	const catalogDefaultThinkingLevels = Array.from(
		new Set(catalogDefaultModels.flatMap((model) => model.supportedThinkingLevels ?? [])),
	);
	const normalizedRequestedModels =
		requestedModels
			?.map((modelId) => modelId.trim())
			.filter((modelId) => modelId.length > 0)
			.map((modelId) => ({
				modelId,
				displayName: modelId,
				supportsReasoning: catalogDefaultSupportsReasoning,
				supportedThinkingLevels: catalogDefaultThinkingLevels.length > 0 ? catalogDefaultThinkingLevels : undefined,
			})) ?? [];

	return normalizedRequestedModels.length > 0 ? normalizedRequestedModels : catalogDefaultModels;
};

const mapRecordToSummary = (record: LlmProviderConfigRecord): LlmProviderConfigSummary => {
	return {
		providerConfigId: record.providerConfigId,
		providerType: record.providerType,
		displayName: record.displayName,
		authMode: record.authMode,
		baseUrl: record.baseUrl,
		anthropicBaseUrl: record.anthropicBaseUrl,
		headers: record.headers,
		availableModels: record.availableModels,
		defaultModelId: record.defaultModelId,
		defaultThinkingLevel: record.defaultThinkingLevel,
		enabled: record.enabled,
		hasStoredCredential: typeof record.encryptedSecret === "string" && record.encryptedSecret.length > 0,
	};
};

const pickModelId = ({
	record,
	modelId,
	thinkingLevel,
	validateThinkingLevel,
}: {
	record: LlmProviderConfigRecord;
	modelId?: string;
	thinkingLevel?: string;
	validateThinkingLevel: boolean;
}): ResolvedModelSelection => {
	const selectedModelId = modelId ?? record.defaultModelId;
	const modelDefinition = record.availableModels.find((availableModel) => availableModel.modelId === selectedModelId);

	if (!modelDefinition) {
		throw new ValidationError(`model ${selectedModelId} is not configured for provider ${record.providerConfigId}`);
	}

	const selectedThinkingLevel = trimOptionalString(thinkingLevel) ?? record.defaultThinkingLevel;
	const supportedThinkingLevels = modelDefinition.supportedThinkingLevels ?? [];
	if (validateThinkingLevel && trimOptionalString(thinkingLevel) && supportedThinkingLevels.length === 0) {
		throw new ValidationError(`model ${selectedModelId} does not support explicit thinkingLevel`);
	}
	if (
		validateThinkingLevel &&
		supportedThinkingLevels.length > 0 &&
		!supportedThinkingLevels.includes(selectedThinkingLevel)
	) {
		throw new ValidationError(`thinkingLevel ${selectedThinkingLevel} is not supported by model ${selectedModelId}`);
	}

	return {
		modelId: selectedModelId,
		thinkingLevel: selectedThinkingLevel,
	};
};

/**
 * User-scoped provider registry service.
 *
 * This service turns durable provider rows into validated session-level model
 * selections and `pi-ai` runtime config. It is the only layer that knows about
 * secret encryption, provider-type catalog rules, and model/thinking-level validation.
 */
export const createLlmProviderService = ({
	llmProviderRepository,
}: {
	llmProviderRepository: LlmProviderRepository;
}) => {
	const secretsCrypto = createSecretsCrypto();

	const decryptSecretMaterial = (encryptedSecret: string | undefined): StoredProviderSecretMaterial => {
		if (!encryptedSecret) {
			return {};
		}

		return JSON.parse(secretsCrypto.decrypt(encryptedSecret)) as StoredProviderSecretMaterial;
	};

	const encryptSecretMaterial = (secretMaterial: StoredProviderSecretMaterial) => {
		return secretMaterial.apiKey || secretMaterial.oauthCredential
			? secretsCrypto.encrypt(JSON.stringify(secretMaterial))
			: undefined;
	};

	const requireOwnedProviderRecord = async (userId: string, providerConfigId: string) => {
		const record = await llmProviderRepository.getProviderConfig(providerConfigId);
		if (!record || record.userId !== userId) {
			throw new NotFoundError(`provider config ${providerConfigId} not found`, "provider_config_not_found");
		}

		return record;
	};

	const updateStoredSecretMaterial = async ({
		userId,
		providerConfigId,
		mutate,
	}: {
		userId: string;
		providerConfigId: string;
		mutate: (
			secretMaterial: StoredProviderSecretMaterial,
			record: LlmProviderConfigRecord,
		) => StoredProviderSecretMaterial;
	}) => {
		const record = await requireOwnedProviderRecord(userId, providerConfigId);
		const updatedSecretMaterial = mutate(decryptSecretMaterial(record.encryptedSecret), record);
		const updatedRecord = await llmProviderRepository.updateProviderConfig(providerConfigId, userId, {
			encryptedSecret: encryptSecretMaterial(updatedSecretMaterial) ?? null,
			updatedAt: new Date().toISOString(),
		});

		if (!updatedRecord) {
			throw new NotFoundError(`provider config ${providerConfigId} not found`, "provider_config_not_found");
		}

		return mapRecordToSummary(updatedRecord);
	};

	const validateAndNormalizeRecordInput = ({
		userId,
		existingRecord,
		input,
	}: {
		userId: string;
		existingRecord?: LlmProviderConfigRecord | null;
		input: ProviderConfigInput;
	}) => {
		const providerType = trimOptionalString(input.providerType) ?? existingRecord?.providerType;
		if (!providerType) {
			throw new ValidationError("providerType is required");
		}

		const catalogItem = getLlmProviderTypeCatalogItem(providerType);
		if (!catalogItem) {
			throw new ValidationError(`unsupported providerType: ${providerType}`);
		}

		const displayName =
			trimOptionalString(input.displayName) ?? existingRecord?.displayName ?? catalogItem.displayName;
		const baseUrl = trimOptionalString(input.baseUrl) ?? existingRecord?.baseUrl;
		const defaultThinkingLevel =
			trimOptionalString(input.defaultThinkingLevel) ??
			existingRecord?.defaultThinkingLevel ??
			catalogItem.defaultThinkingLevel;
		const availableModels = normalizeAvailableModels({
			requestedModels: input.availableModels,
			catalogDefaultModels: existingRecord?.availableModels ?? catalogItem.defaultModels,
		});
		const defaultModelId =
			trimOptionalString(input.defaultModelId) ??
			existingRecord?.defaultModelId ??
			catalogItem.defaultModels[0]?.modelId;

		if (!defaultModelId) {
			throw new ValidationError(`provider ${providerType} has no default model configured`);
		}

		const availableModelIds = new Set(availableModels.map((model) => model.modelId));
		if (!availableModelIds.has(defaultModelId)) {
			throw new ValidationError(`default model ${defaultModelId} is not listed in availableModels`);
		}
		const defaultModelDefinition = availableModels.find((model) => model.modelId === defaultModelId);
		if (!defaultModelDefinition) {
			throw new ValidationError(`default model ${defaultModelId} is not listed in availableModels`);
		}
		const supportedThinkingLevels = defaultModelDefinition.supportedThinkingLevels ?? [];
		if (supportedThinkingLevels.length > 0 && !supportedThinkingLevels.includes(defaultThinkingLevel)) {
			throw new ValidationError(
				`defaultThinkingLevel ${defaultThinkingLevel} is not supported by model ${defaultModelId}`,
			);
		}

		if (catalogItem.baseUrlRequired && !baseUrl) {
			throw new ValidationError(`provider ${providerType} requires baseUrl`);
		}

		const headers = input.headers ?? existingRecord?.headers ?? {};
		const providerOptions = existingRecord?.providerOptions ?? {};
		const secretMaterial = {
			...decryptSecretMaterial(existingRecord?.encryptedSecret),
			...(trimOptionalString(input.apiKey) ? { apiKey: trimOptionalString(input.apiKey) } : {}),
			...(input.oauthCredential ? { oauthCredential: input.oauthCredential } : {}),
		} satisfies StoredProviderSecretMaterial;

		if (catalogItem.authMode === "api_key" && !secretMaterial.apiKey && !existingRecord) {
			throw new ValidationError(`provider ${providerType} requires apiKey`);
		}

		const encryptedSecret = encryptSecretMaterial(secretMaterial) ?? existingRecord?.encryptedSecret;

		return {
			catalogItem,
			record: {
				providerConfigId: existingRecord?.providerConfigId ?? `provider_${randomUUID()}`,
				userId,
				providerType,
				displayName,
				authMode: catalogItem.authMode,
				encryptedSecret,
				baseUrl,
				apiType: catalogItem.apiType,
				headers,
				providerOptions,
				availableModels,
				defaultModelId,
				defaultThinkingLevel,
				enabled: input.enabled ?? existingRecord?.enabled ?? true,
			} satisfies Omit<LlmProviderConfigRecord, "createdAt" | "updatedAt">,
		};
	};

	return {
		listProviderTypes() {
			return LLM_PROVIDER_TYPE_CATALOG;
		},
		async listUserProviderConfigs(userId: string) {
			return (await llmProviderRepository.listProviderConfigs(userId)).map(mapRecordToSummary);
		},
		async createProviderConfig(userId: string, input: ProviderConfigInput) {
			const { record } = validateAndNormalizeRecordInput({
				userId,
				input,
			});

			await llmProviderRepository.createProviderConfig({
				...record,
			});

			const createdRecord = await llmProviderRepository.getProviderConfig(record.providerConfigId);
			if (!createdRecord) {
				throw new Error(`provider config ${record.providerConfigId} was not persisted`);
			}

			return mapRecordToSummary(createdRecord);
		},
		async updateProviderConfig(userId: string, providerConfigId: string, input: ProviderConfigInput) {
			const existingRecord = await requireOwnedProviderRecord(userId, providerConfigId);

			const { record } = validateAndNormalizeRecordInput({
				userId,
				existingRecord,
				input,
			});
			const updatedRecord = await llmProviderRepository.updateProviderConfig(providerConfigId, userId, {
				...record,
				updatedAt: new Date().toISOString(),
			});
			if (!updatedRecord) {
				throw new NotFoundError(`provider config ${providerConfigId} not found`, "provider_config_not_found");
			}

			return mapRecordToSummary(updatedRecord);
		},
		async deleteProviderConfig(userId: string, providerConfigId: string) {
			const deleted = await llmProviderRepository.deleteProviderConfig(providerConfigId, userId);
			if (!deleted) {
				throw new NotFoundError(`provider config ${providerConfigId} not found`, "provider_config_not_found");
			}
		},
		async validateProviderConfig(userId: string, providerConfigId: string) {
			const record = await requireOwnedProviderRecord(userId, providerConfigId);

			const secretMaterial = decryptSecretMaterial(record.encryptedSecret);
			const errors: string[] = [];
			const catalogItem = getLlmProviderTypeCatalogItem(record.providerType);

			if (!catalogItem) {
				errors.push(`unsupported providerType: ${record.providerType}`);
			}
			if (record.availableModels.length === 0) {
				errors.push("availableModels must not be empty");
			}
			if (catalogItem?.baseUrlRequired && !record.baseUrl) {
				errors.push("baseUrl is required");
			}
			if (record.authMode === "api_key" && !secretMaterial.apiKey) {
				errors.push("apiKey is required");
			}
			if (record.authMode === "oauth" && !secretMaterial.oauthCredential) {
				errors.push("oauthCredential is required");
			}

			return {
				providerConfigId,
				valid: errors.length === 0,
				errors,
			};
		},
		async storeOAuthCredential(userId: string, providerConfigId: string, oauthCredential: OAuthCredentialMaterial) {
			return updateStoredSecretMaterial({
				userId,
				providerConfigId,
				mutate(secretMaterial, record) {
					if (record.authMode !== "oauth") {
						throw new ValidationError(`provider ${providerConfigId} does not use OAuth`);
					}

					return {
						...secretMaterial,
						oauthCredential,
					};
				},
			});
		},
		async clearOAuthCredential(userId: string, providerConfigId: string) {
			return updateStoredSecretMaterial({
				userId,
				providerConfigId,
				mutate(secretMaterial, record) {
					if (record.authMode !== "oauth") {
						throw new ValidationError(`provider ${providerConfigId} does not use OAuth`);
					}

					return {
						...secretMaterial,
						oauthCredential: undefined,
					};
				},
			});
		},
		async getProviderConfigSummary(userId: string, providerConfigId: string) {
			return mapRecordToSummary(await requireOwnedProviderRecord(userId, providerConfigId));
		},
		async resolveProviderSelectionForSession(input: {
			userId: string;
			providerConfigId: string;
			modelId?: string;
			thinkingLevel?: string;
			validateThinkingLevel?: boolean;
		}): Promise<{
			record: LlmProviderConfigRecord;
			runtimeConfig: LlmProviderRuntimeConfig;
			resolvedModelSelection: ResolvedModelSelection;
		}> {
			const record = await llmProviderRepository.getProviderConfig(input.providerConfigId);
			if (!record || record.userId !== input.userId || !record.enabled) {
				throw new NotFoundError(`provider config ${input.providerConfigId} not found`, "provider_config_not_found");
			}

			const catalogItem = getLlmProviderTypeCatalogItem(record.providerType);
			if (!catalogItem) {
				throw new ValidationError(`unsupported providerType: ${record.providerType}`);
			}

			const resolvedModelSelection = pickModelId({
				record,
				modelId: trimOptionalString(input.modelId),
				thinkingLevel: trimOptionalString(input.thinkingLevel),
				validateThinkingLevel: input.validateThinkingLevel ?? true,
			});
			const modelDefinition = record.availableModels.find(
				(availableModel) => availableModel.modelId === resolvedModelSelection.modelId,
			);

			if (!modelDefinition) {
				throw new ValidationError(
					`model ${resolvedModelSelection.modelId} is not configured for provider ${record.providerConfigId}`,
				);
			}

			const secretMaterial = decryptSecretMaterial(record.encryptedSecret);
			if (record.authMode === "api_key" && !secretMaterial.apiKey) {
				throw new ValidationError(`provider ${record.providerConfigId} does not have an API key configured`);
			}
			if (record.authMode === "oauth" && !secretMaterial.oauthCredential) {
				throw new ValidationError(`provider ${record.providerConfigId} does not have OAuth credentials configured`);
			}

			return {
				record,
				resolvedModelSelection,
				runtimeConfig: {
					providerConfigId: record.providerConfigId,
					providerType: record.providerType,
					runtimeProviderId: catalogItem.usesBuiltInProvider
						? catalogItem.runtimeProviderId
						: `${catalogItem.runtimeProviderId}-${record.providerConfigId}`,
					displayName: record.displayName,
					modelId: resolvedModelSelection.modelId,
					authMode: record.authMode,
					apiType: record.apiType,
					baseUrl: record.baseUrl,
					apiKey: secretMaterial.apiKey,
					headers: record.headers,
					oauthCredential: secretMaterial.oauthCredential,
					usesBuiltInProvider: catalogItem.usesBuiltInProvider,
					supportsReasoning: modelDefinition.supportsReasoning,
					availableModels: record.availableModels,
				},
			};
		},
	};
};

export type LlmProviderService = ReturnType<typeof createLlmProviderService>;

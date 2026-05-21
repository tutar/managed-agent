import { and, desc, eq } from "drizzle-orm";

import type { ManagedAgentDatabase } from "../../../infrastructure/persistence/postgres/database.js";
import { llmProviderConfigsTable } from "../../../infrastructure/persistence/postgres/schema.js";
import type { LlmProviderConfigRecord, LlmProviderRepository } from "./llm-provider-repository.js";

const parseJsonObject = (value: string | null): Record<string, unknown> => {
	if (!value) {
		return {};
	}

	return JSON.parse(value) as Record<string, unknown>;
};

const parseStringMap = (value: string | null): Record<string, string> => {
	if (!value) {
		return {};
	}

	return JSON.parse(value) as Record<string, string>;
};

const toRecord = (
	row:
		| (typeof llmProviderConfigsTable.$inferSelect & {
				headersJson: string | null;
				providerOptionsJson: string | null;
				availableModelsJson: string;
		  })
		| undefined,
): LlmProviderConfigRecord | null => {
	if (!row) {
		return null;
	}

	return {
		providerConfigId: row.providerConfigId,
		userId: row.userId,
		providerType: row.providerType,
		displayName: row.displayName,
		authMode: row.authMode as LlmProviderConfigRecord["authMode"],
		encryptedSecret: row.encryptedSecret ?? undefined,
		baseUrl: row.baseUrl ?? undefined,
		anthropicBaseUrl: row.anthropicBaseUrl ?? undefined,
		apiType: (row.apiType as LlmProviderConfigRecord["apiType"] | null) ?? undefined,
		headers: parseStringMap(row.headersJson),
		providerOptions: parseJsonObject(row.providerOptionsJson),
		availableModels: JSON.parse(row.availableModelsJson) as LlmProviderConfigRecord["availableModels"],
		defaultModelId: row.defaultModelId,
		defaultThinkingLevel: row.defaultThinkingLevel,
		enabled: row.enabled,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
};

/**
 * PostgreSQL-backed provider registry repository.
 *
 * The repository persists only durable configuration rows. Higher-level
 * services remain responsible for encryption, validation, and runtime
 * resolution into `pi-ai` provider config.
 */
export const createPostgresLlmProviderRepository = ({ db }: { db: ManagedAgentDatabase }): LlmProviderRepository => {
	return {
		async createProviderConfig(record) {
			await db.insert(llmProviderConfigsTable).values({
				providerConfigId: record.providerConfigId,
				userId: record.userId,
				providerType: record.providerType,
				displayName: record.displayName,
				authMode: record.authMode,
				encryptedSecret: record.encryptedSecret,
				baseUrl: record.baseUrl,
					anthropicBaseUrl: record.anthropicBaseUrl,
					apiType: record.apiType,
				headersJson: JSON.stringify(record.headers),
				providerOptionsJson: JSON.stringify(record.providerOptions),
				availableModelsJson: JSON.stringify(record.availableModels),
				defaultModelId: record.defaultModelId,
				defaultThinkingLevel: record.defaultThinkingLevel,
				enabled: record.enabled,
				createdAt: record.createdAt ?? new Date().toISOString(),
				updatedAt: record.updatedAt ?? new Date().toISOString(),
			});
		},
		async getProviderConfig(providerConfigId) {
			return toRecord(
				await db.query.llmProviderConfigsTable.findFirst({
					where: eq(llmProviderConfigsTable.providerConfigId, providerConfigId),
				}),
			);
		},
		async listProviderConfigs(userId) {
			const rows = await db.query.llmProviderConfigsTable.findMany({
				where: eq(llmProviderConfigsTable.userId, userId),
				orderBy: desc(llmProviderConfigsTable.updatedAt),
			});

			return rows.flatMap((row) => {
				const record = toRecord(row);
				return record ? [record] : [];
			});
		},
		async updateProviderConfig(providerConfigId, userId, patch) {
			await db
				.update(llmProviderConfigsTable)
				.set({
					providerType: patch.providerType,
					displayName: patch.displayName,
					authMode: patch.authMode,
					encryptedSecret: patch.encryptedSecret,
					baseUrl: patch.baseUrl,
					anthropicBaseUrl: patch.anthropicBaseUrl,
					apiType: patch.apiType,
					headersJson: patch.headers ? JSON.stringify(patch.headers) : undefined,
					providerOptionsJson: patch.providerOptions ? JSON.stringify(patch.providerOptions) : undefined,
					availableModelsJson: patch.availableModels ? JSON.stringify(patch.availableModels) : undefined,
					defaultModelId: patch.defaultModelId,
					defaultThinkingLevel: patch.defaultThinkingLevel,
					enabled: patch.enabled,
					updatedAt: patch.updatedAt,
				})
				.where(
					and(
						eq(llmProviderConfigsTable.providerConfigId, providerConfigId),
						eq(llmProviderConfigsTable.userId, userId),
					),
				);

			return this.getProviderConfig(providerConfigId);
		},
		async deleteProviderConfig(providerConfigId, userId) {
			const existingRecord = await db.query.llmProviderConfigsTable.findFirst({
				where: and(
					eq(llmProviderConfigsTable.providerConfigId, providerConfigId),
					eq(llmProviderConfigsTable.userId, userId),
				),
			});

			if (!existingRecord) {
				return false;
			}

			await db
				.delete(llmProviderConfigsTable)
				.where(
					and(
						eq(llmProviderConfigsTable.providerConfigId, providerConfigId),
						eq(llmProviderConfigsTable.userId, userId),
					),
				);

			return true;
		},
	};
};

/**
 * Provider-registry service tests.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createLlmProviderService } from "../../../src/control-plane/llm-provider/llm-provider-service.js";
import { createPostgresLlmProviderRepository } from "../../../src/control-plane/llm-provider/repositories/postgres-llm-provider-repository.js";
import { createTestManagedAgentDatabase } from "../../test-support/create-test-database.js";

process.env.MANAGED_AGENT_SECRETS_KEY = "managed-agent-test-secrets-key";

test("llm provider service persists encrypted secrets and resolves model + thinking level", async () => {
	const { db, client } = await createTestManagedAgentDatabase();
	const llmProviderRepository = createPostgresLlmProviderRepository({ db });
	const llmProviderService = createLlmProviderService({
		llmProviderRepository,
	});

	try {
		const createdProviderConfig = await llmProviderService.createProviderConfig("user_1", {
			providerType: "openai",
			displayName: "OpenAI Personal",
			availableModels: ["gpt-5.4", "gpt-5.5"],
			defaultModelId: "gpt-5.4",
			defaultThinkingLevel: "medium",
			apiKey: "secret-openai-key",
		});

		const storedProviderConfig = await llmProviderRepository.getProviderConfig(createdProviderConfig.providerConfigId);
		assert.ok(storedProviderConfig);
		assert.notEqual(storedProviderConfig?.encryptedSecret, undefined);
		assert.notEqual(storedProviderConfig?.encryptedSecret?.includes("secret-deepseek-key"), true);

		const resolution = await llmProviderService.resolveProviderSelectionForSession({
			userId: "user_1",
			providerConfigId: createdProviderConfig.providerConfigId,
			modelId: "gpt-5.5",
			thinkingLevel: "xhigh",
		});

		assert.equal(resolution.runtimeConfig.providerType, "openai");
		assert.equal(resolution.runtimeConfig.modelId, "gpt-5.5");
		assert.equal(resolution.runtimeConfig.apiKey, "secret-openai-key");
		assert.equal(resolution.resolvedModelSelection.thinkingLevel, "xhigh");
	} finally {
		await client.close();
	}
});

test("llm provider service allows OAuth configs before connect and can later store credentials", async () => {
	const { db, client } = await createTestManagedAgentDatabase();
	const llmProviderRepository = createPostgresLlmProviderRepository({ db });
	const llmProviderService = createLlmProviderService({
		llmProviderRepository,
	});

	try {
		const createdProviderConfig = await llmProviderService.createProviderConfig("user_2", {
			providerType: "openai-codex",
			displayName: "Codex Personal",
			availableModels: ["gpt-5.5"],
			defaultModelId: "gpt-5.5",
		});

		assert.equal(createdProviderConfig.hasStoredCredential, false);

		const validationBeforeConnect = await llmProviderService.validateProviderConfig(
			"user_2",
			createdProviderConfig.providerConfigId,
		);
		assert.equal(validationBeforeConnect.valid, false);
		assert.deepEqual(validationBeforeConnect.errors, ["oauthCredential is required"]);

		const updatedProviderConfig = await llmProviderService.storeOAuthCredential(
			"user_2",
			createdProviderConfig.providerConfigId,
			{
				access: "oauth-access-token",
				refresh: "oauth-refresh-token",
				expires: Date.now() + 60_000,
				accountId: "account_123",
			},
		);
		assert.equal(updatedProviderConfig.hasStoredCredential, true);

		const validationAfterConnect = await llmProviderService.validateProviderConfig(
			"user_2",
			createdProviderConfig.providerConfigId,
		);
		assert.equal(validationAfterConnect.valid, true);

		const clearedProviderConfig = await llmProviderService.clearOAuthCredential(
			"user_2",
			createdProviderConfig.providerConfigId,
		);
		assert.equal(clearedProviderConfig.hasStoredCredential, false);
	} finally {
		await client.close();
	}
});

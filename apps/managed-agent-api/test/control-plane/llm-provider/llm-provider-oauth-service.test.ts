/**
 * OAuth flow manager tests for provider-registry browser connect flows.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createLlmProviderOAuthService } from "../../../src/control-plane/llm-provider/llm-provider-oauth-service.js";

test("llm provider oauth service completes the managed OpenAI Codex callback flow", async () => {
	const storedCredentials: Array<{ userId: string; providerConfigId: string; accountId?: string }> = [];
	const originalFetch = globalThis.fetch;

	globalThis.fetch = (async () =>
		new Response(
			JSON.stringify({
				access_token:
					"eyJhbGciOiJIUzI1NiJ9.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjdF8xMjMifX0.signature",
				refresh_token: "refresh-token",
				expires_in: 3600,
			}),
			{
				status: 200,
				headers: {
					"content-type": "application/json",
				},
			},
		)) as typeof fetch;

	try {
		const oauthService = createLlmProviderOAuthService({
			llmProviderService: {
				async getProviderConfigSummary(userId: string, providerConfigId: string) {
					return {
						userId,
						providerConfigId,
						providerType: "openai-codex",
						displayName: "Codex",
						authMode: "oauth",
						headers: {},
						availableModels: [{ modelId: "gpt-5.5", displayName: "gpt-5.5", supportsReasoning: true }],
						defaultModelId: "gpt-5.5",
						defaultThinkingLevel: "medium",
						enabled: true,
						hasStoredCredential: false,
					};
				},
				async storeOAuthCredential(userId: string, providerConfigId: string, credential) {
					storedCredentials.push({
						userId,
						providerConfigId,
						accountId: credential.accountId,
					});
					return {
						providerConfigId,
						providerType: "openai-codex",
						displayName: "Codex",
						authMode: "oauth",
						headers: {},
						availableModels: [{ modelId: "gpt-5.5", displayName: "gpt-5.5", supportsReasoning: true }],
						defaultModelId: "gpt-5.5",
						defaultThinkingLevel: "medium",
						enabled: true,
						hasStoredCredential: true,
					};
				},
				async clearOAuthCredential() {
					throw new Error("not used");
				},
			},
		});

		const startedFlow = await oauthService.startOAuthFlow({
			userId: "user_1",
			providerConfigId: "provider_1",
			requestBaseUrl: "http://127.0.0.1:4173",
		});

		assert.equal(startedFlow.usesManagedCallback, true);
		assert.match(startedFlow.authUrl, /auth\.openai\.com/);
		const state = new URL(startedFlow.authUrl).searchParams.get("state");
		assert.ok(state);

		const callbackResult = await oauthService.completeOpenAICodexCallback({
			state,
			code: "authorization-code",
			requestBaseUrl: "http://127.0.0.1:4173",
		});

		assert.equal(callbackResult.statusCode, 200);
		assert.equal(storedCredentials.length, 1);
		assert.equal(storedCredentials[0]?.providerConfigId, "provider_1");
		assert.equal(storedCredentials[0]?.accountId, "acct_123");

		const flowStatus = await oauthService.getOAuthFlowStatus({
			userId: "user_1",
			providerConfigId: "provider_1",
			flowId: startedFlow.flowId,
		});
		assert.equal(flowStatus.status, "completed");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

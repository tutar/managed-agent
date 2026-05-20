import { createHash, randomBytes, randomUUID } from "node:crypto";

import { loginGitHubCopilot } from "@earendil-works/pi-ai/oauth";
import type { OAuthCredentialMaterial } from "@managed-agent/contracts";
import { ValidationError } from "../../channel/web-api/errors/http-errors.js";
import type { LlmProviderService } from "./llm-provider-service.js";

type OAuthFlowStatus = "pending" | "completed" | "failed";

type OAuthFlowRecord = {
	flowId: string;
	userId: string;
	providerConfigId: string;
	providerType: "openai-codex" | "github-copilot";
	status: OAuthFlowStatus;
	authUrl?: string;
	instructions?: string;
	error?: string;
	expiresAt: number;
	completedAt?: string;
	callbackState?: string;
	codeVerifier?: string;
};

export type OAuthFlowStartResult = {
	flowId: string;
	status: OAuthFlowStatus;
	authUrl: string;
	instructions?: string;
	expiresAt: number;
	usesManagedCallback: boolean;
};

export type OAuthFlowStatusResult = {
	flowId: string;
	status: OAuthFlowStatus;
	authUrl?: string;
	instructions?: string;
	error?: string;
	expiresAt: number;
	completedAt?: string;
	usesManagedCallback: boolean;
};

const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_CODEX_AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const OPENAI_CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const OPENAI_CODEX_SCOPE = "openid profile email offline_access";
const OPENAI_CODEX_JWT_CLAIM_PATH = "https://api.openai.com/auth";
const OPENAI_CODEX_FLOW_TTL_MS = 15 * 60 * 1000;
const GITHUB_COPILOT_FLOW_TTL_MS = 20 * 60 * 1000;

const CALLBACK_RESPONSE_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>OAuth Completed</title>
  </head>
  <body>
    <script>
      window.close();
    </script>
    OAuth flow completed. You can close this window.
  </body>
</html>`;

const CALLBACK_ERROR_HTML = (message: string) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>OAuth Failed</title>
  </head>
  <body>
    OAuth flow failed: ${message}
  </body>
</html>`;

const base64UrlEncode = (buffer: Buffer) =>
	buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const createPkcePair = () => {
	const verifier = base64UrlEncode(randomBytes(32));
	const challenge = base64UrlEncode(createHash("sha256").update(verifier).digest());
	return { verifier, challenge };
};

const decodeJwt = (token: string) => {
	try {
		const parts = token.split(".");
		if (parts.length !== 3) {
			return null;
		}

		return JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
	} catch {
		return null;
	}
};

const extractOpenAICodexAccountId = (accessToken: string) => {
	const payload = decodeJwt(accessToken);
	const authClaim = payload?.[OPENAI_CODEX_JWT_CLAIM_PATH];
	if (!authClaim || typeof authClaim !== "object") {
		return undefined;
	}

	const accountId = (authClaim as Record<string, unknown>).chatgpt_account_id;
	return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
};

const exchangeOpenAICodexAuthorizationCode = async ({
	code,
	codeVerifier,
	redirectUri,
}: {
	code: string;
	codeVerifier: string;
	redirectUri: string;
}): Promise<OAuthCredentialMaterial> => {
	const response = await fetch(OPENAI_CODEX_TOKEN_URL, {
		method: "POST",
		headers: {
			"content-type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({
			grant_type: "authorization_code",
			client_id: OPENAI_CODEX_CLIENT_ID,
			code,
			code_verifier: codeVerifier,
			redirect_uri: redirectUri,
		}).toString(),
	});

	if (!response.ok) {
		const errorText = await response.text().catch(() => "");
		throw new Error(`OpenAI Codex token exchange failed: ${response.status} ${errorText || response.statusText}`);
	}

	const payload = (await response.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
	};

	if (
		typeof payload.access_token !== "string" ||
		typeof payload.refresh_token !== "string" ||
		typeof payload.expires_in !== "number"
	) {
		throw new Error("OpenAI Codex token exchange response is missing required fields");
	}

	return {
		access: payload.access_token,
		refresh: payload.refresh_token,
		expires: Date.now() + payload.expires_in * 1000,
		accountId: extractOpenAICodexAccountId(payload.access_token),
	};
};

/**
 * Browser-oriented OAuth flow manager for user-scoped provider configs.
 *
 * The API owns third-party authorization orchestration so web-ui never handles
 * raw provider credentials directly. Completed credentials are written back to
 * the durable provider registry via `LlmProviderService`.
 */
export const createLlmProviderOAuthService = ({
	llmProviderService,
}: {
	llmProviderService: Pick<
		LlmProviderService,
		"getProviderConfigSummary" | "storeOAuthCredential" | "clearOAuthCredential"
	>;
}) => {
	const flowById = new Map<string, OAuthFlowRecord>();
	const codexFlowIdByState = new Map<string, string>();

	const getRequiredFlow = ({
		userId,
		providerConfigId,
		flowId,
	}: {
		userId: string;
		providerConfigId: string;
		flowId: string;
	}) => {
		const flow = flowById.get(flowId);
		if (!flow || flow.userId !== userId || flow.providerConfigId !== providerConfigId) {
			throw new ValidationError(`OAuth flow ${flowId} was not found`);
		}
		return flow;
	};

	const toFlowStatusResult = (flow: OAuthFlowRecord): OAuthFlowStatusResult => ({
		flowId: flow.flowId,
		status: flow.status,
		authUrl: flow.authUrl,
		instructions: flow.instructions,
		error: flow.error,
		expiresAt: flow.expiresAt,
		completedAt: flow.completedAt,
		usesManagedCallback: flow.providerType === "openai-codex",
	});

	const failFlow = (flow: OAuthFlowRecord, error: unknown) => {
		flow.status = "failed";
		flow.error = error instanceof Error ? error.message : String(error);
		flow.completedAt = new Date().toISOString();
	};

	const completeFlow = async (flow: OAuthFlowRecord, credential: OAuthCredentialMaterial) => {
		await llmProviderService.storeOAuthCredential(flow.userId, flow.providerConfigId, credential);
		flow.status = "completed";
		flow.completedAt = new Date().toISOString();
	};

	return {
		async startOAuthFlow(input: {
			userId: string;
			providerConfigId: string;
			requestBaseUrl: string;
			enterpriseUrl?: string;
		}): Promise<OAuthFlowStartResult> {
			const providerConfig = await llmProviderService.getProviderConfigSummary(input.userId, input.providerConfigId);
			if (providerConfig.authMode !== "oauth") {
				throw new ValidationError(`provider ${input.providerConfigId} does not use OAuth`);
			}

			if (providerConfig.providerType !== "openai-codex" && providerConfig.providerType !== "github-copilot") {
				throw new ValidationError(
					`provider type ${providerConfig.providerType} does not support browser OAuth yet`,
				);
			}

			const flowId = `oauth_${randomUUID()}`;

			if (providerConfig.providerType === "openai-codex") {
				const callbackState = randomBytes(16).toString("hex");
				const { verifier, challenge } = createPkcePair();
				const redirectUri = `${input.requestBaseUrl}/oauth/llm-provider-flows/openai-codex/callback`;
				const authUrl = new URL(OPENAI_CODEX_AUTHORIZE_URL);
				authUrl.searchParams.set("response_type", "code");
				authUrl.searchParams.set("client_id", OPENAI_CODEX_CLIENT_ID);
				authUrl.searchParams.set("redirect_uri", redirectUri);
				authUrl.searchParams.set("scope", OPENAI_CODEX_SCOPE);
				authUrl.searchParams.set("code_challenge", challenge);
				authUrl.searchParams.set("code_challenge_method", "S256");
				authUrl.searchParams.set("state", callbackState);
				authUrl.searchParams.set("id_token_add_organizations", "true");
				authUrl.searchParams.set("codex_cli_simplified_flow", "true");
				authUrl.searchParams.set("originator", "managed-agent");

				const flow: OAuthFlowRecord = {
					flowId,
					userId: input.userId,
					providerConfigId: input.providerConfigId,
					providerType: "openai-codex",
					status: "pending",
					authUrl: authUrl.toString(),
					instructions: "Complete the ChatGPT authorization flow in the opened window.",
					expiresAt: Date.now() + OPENAI_CODEX_FLOW_TTL_MS,
					callbackState,
					codeVerifier: verifier,
				};

				flowById.set(flowId, flow);
				codexFlowIdByState.set(callbackState, flowId);

				return {
					flowId,
					status: flow.status,
					authUrl: flow.authUrl ?? authUrl.toString(),
					instructions: flow.instructions,
					expiresAt: flow.expiresAt,
					usesManagedCallback: true,
				};
			}

			const flow: OAuthFlowRecord = {
				flowId,
				userId: input.userId,
				providerConfigId: input.providerConfigId,
				providerType: "github-copilot",
				status: "pending",
				authUrl: "",
				expiresAt: Date.now() + GITHUB_COPILOT_FLOW_TTL_MS,
			};
			flowById.set(flowId, flow);

			void loginGitHubCopilot({
				onAuth: (url, instructions) => {
					flow.authUrl = url;
					flow.instructions = instructions;
				},
				onPrompt: async (prompt) => {
					if (prompt.message.startsWith("GitHub Enterprise URL/domain")) {
						return input.enterpriseUrl?.trim() ?? "";
					}

					throw new Error(`Unexpected OAuth prompt: ${prompt.message}`);
				},
				onProgress: (message) => {
					flow.instructions = flow.instructions ? `${flow.instructions}\n${message}` : message;
				},
			})
				.then(async (credential) => {
					await completeFlow(flow, credential);
				})
				.catch((error) => {
					failFlow(flow, error);
				});

			while (!flow.authUrl) {
				await new Promise((resolve) => setTimeout(resolve, 10));
				if (flow.status === "failed") {
					throw new Error(flow.error ?? "GitHub Copilot OAuth start failed");
				}
			}

			return {
				flowId,
				status: flow.status,
				authUrl: flow.authUrl,
				instructions: flow.instructions,
				expiresAt: flow.expiresAt,
				usesManagedCallback: false,
			};
		},
		async getOAuthFlowStatus(input: { userId: string; providerConfigId: string; flowId: string }) {
			return toFlowStatusResult(getRequiredFlow(input));
		},
		async clearOAuthCredential(userId: string, providerConfigId: string) {
			return llmProviderService.clearOAuthCredential(userId, providerConfigId);
		},
		async completeOpenAICodexCallback(input: { state?: string; code?: string; requestBaseUrl: string }) {
			if (!input.state || !input.code) {
				return {
					statusCode: 400,
					body: CALLBACK_ERROR_HTML("Missing state or code."),
				};
			}

			const flowId = codexFlowIdByState.get(input.state);
			if (!flowId) {
				return {
					statusCode: 404,
					body: CALLBACK_ERROR_HTML("OAuth flow not found."),
				};
			}

			const flow = flowById.get(flowId);
			if (!flow || !flow.codeVerifier) {
				return {
					statusCode: 404,
					body: CALLBACK_ERROR_HTML("OAuth flow not found."),
				};
			}

			try {
				const credential = await exchangeOpenAICodexAuthorizationCode({
					code: input.code,
					codeVerifier: flow.codeVerifier,
					redirectUri: `${input.requestBaseUrl}/oauth/llm-provider-flows/openai-codex/callback`,
				});
				await completeFlow(flow, credential);
				if (flow.callbackState) {
					codexFlowIdByState.delete(flow.callbackState);
				}
				return {
					statusCode: 200,
					body: CALLBACK_RESPONSE_HTML,
				};
			} catch (error) {
				failFlow(flow, error);
				return {
					statusCode: 500,
					body: CALLBACK_ERROR_HTML(flow.error ?? "OAuth callback failed."),
				};
			}
		},
	};
};

export type LlmProviderOAuthService = ReturnType<typeof createLlmProviderOAuthService>;

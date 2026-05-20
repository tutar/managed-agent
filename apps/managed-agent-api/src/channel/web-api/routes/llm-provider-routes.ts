import type { FastifyInstance } from "fastify";
import type { LlmProviderTypeCatalogItem } from "../../../control-plane/llm-provider/llm-provider-catalog.js";
import type {
	LlmProviderOAuthService,
	OAuthFlowStartResult,
	OAuthFlowStatusResult,
} from "../../../control-plane/llm-provider/llm-provider-oauth-service.js";
import type { LlmProviderConfigSummary } from "../../../control-plane/llm-provider/llm-provider-service.js";
import type { AuthorizationGuard } from "../../../identity/authorization-guard.js";
import {
	toLlmProviderConfigResponseDto,
	toLlmProviderOAuthStartRequestDto,
	toLlmProviderTypeResponseDto,
	toUpsertLlmProviderConfigRequestDto,
} from "../dto/llm-provider-dto.js";
import {
	LlmProviderConfigPatchSchema,
	type LlmProviderConfigPatchSchemaDto,
	LlmProviderConfigRequestSchema,
	type LlmProviderConfigRequestSchemaDto,
	LlmProviderOAuthStartRequestSchema,
	type LlmProviderOAuthStartRequestSchemaDto,
	ProviderConfigIdParamsSchema,
	type ProviderConfigIdParamsSchemaDto,
	ProviderOAuthFlowParamsSchema,
	type ProviderOAuthFlowParamsSchemaDto,
} from "../schemas/llm-provider-schema.js";

const getRequestBaseUrl = (request: { protocol: string; headers: Record<string, string | string[] | undefined> }) => {
	const hostHeader = request.headers.host;
	const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
	if (!host) {
		throw new Error("request host header is required");
	}

	return `${request.protocol}://${host}`;
};

/**
 * Register provider-registry routes for per-user LLM configuration.
 */
export const registerLlmProviderRoutes = (
	app: FastifyInstance,
	{
		authorizationGuard,
		llmProviderService,
		llmProviderOAuthService,
	}: {
		authorizationGuard: AuthorizationGuard;
		llmProviderService: {
			listProviderTypes(): LlmProviderTypeCatalogItem[];
			listUserProviderConfigs(userId: string): Promise<LlmProviderConfigSummary[]>;
			createProviderConfig(userId: string, input: Record<string, unknown>): Promise<LlmProviderConfigSummary>;
			updateProviderConfig(
				userId: string,
				providerConfigId: string,
				input: Record<string, unknown>,
			): Promise<LlmProviderConfigSummary>;
			deleteProviderConfig(userId: string, providerConfigId: string): Promise<void>;
			validateProviderConfig(
				userId: string,
				providerConfigId: string,
			): Promise<{ providerConfigId: string; valid: boolean; errors: string[] }>;
		};
		llmProviderOAuthService: Pick<
			LlmProviderOAuthService,
			"startOAuthFlow" | "getOAuthFlowStatus" | "clearOAuthCredential" | "completeOpenAICodexCallback"
		>;
	},
) => {
	app.get("/llm-provider-types", async () => {
		return llmProviderService.listProviderTypes().map(toLlmProviderTypeResponseDto);
	});

	app.get("/me/llm-providers", async (request) => {
		const currentUser = await authorizationGuard.requireCurrentUser(request);
		return (await llmProviderService.listUserProviderConfigs(currentUser.userId)).map(toLlmProviderConfigResponseDto);
	});

	app.post<{ Body: LlmProviderConfigRequestSchemaDto }>(
		"/me/llm-providers",
		{
			schema: {
				body: LlmProviderConfigRequestSchema,
			},
		},
		async (request) => {
			const currentUser = await authorizationGuard.requireCurrentUser(request);
			return toLlmProviderConfigResponseDto(
				await llmProviderService.createProviderConfig(
					currentUser.userId,
					toUpsertLlmProviderConfigRequestDto(request.body),
				),
			);
		},
	);

	app.patch<{ Params: ProviderConfigIdParamsSchemaDto; Body: LlmProviderConfigPatchSchemaDto }>(
		"/me/llm-providers/:providerConfigId",
		{
			schema: {
				params: ProviderConfigIdParamsSchema,
				body: LlmProviderConfigPatchSchema,
			},
		},
		async (request) => {
			const currentUser = await authorizationGuard.requireCurrentUser(request);
			return toLlmProviderConfigResponseDto(
				await llmProviderService.updateProviderConfig(
					currentUser.userId,
					request.params.providerConfigId,
					toUpsertLlmProviderConfigRequestDto(request.body),
				),
			);
		},
	);

	app.delete<{ Params: ProviderConfigIdParamsSchemaDto }>(
		"/me/llm-providers/:providerConfigId",
		{
			schema: {
				params: ProviderConfigIdParamsSchema,
			},
		},
		async (request, reply) => {
			const currentUser = await authorizationGuard.requireCurrentUser(request);
			await llmProviderService.deleteProviderConfig(currentUser.userId, request.params.providerConfigId);
			reply.status(204).send();
		},
	);

	app.post<{ Params: ProviderConfigIdParamsSchemaDto }>(
		"/me/llm-providers/:providerConfigId/validate",
		{
			schema: {
				params: ProviderConfigIdParamsSchema,
			},
		},
		async (request) => {
			const currentUser = await authorizationGuard.requireCurrentUser(request);
			return llmProviderService.validateProviderConfig(currentUser.userId, request.params.providerConfigId);
		},
	);

	app.post<{ Params: ProviderConfigIdParamsSchemaDto; Body: LlmProviderOAuthStartRequestSchemaDto }>(
		"/me/llm-providers/:providerConfigId/oauth/start",
		{
			schema: {
				params: ProviderConfigIdParamsSchema,
				body: LlmProviderOAuthStartRequestSchema,
			},
		},
		async (request): Promise<OAuthFlowStartResult> => {
			const currentUser = await authorizationGuard.requireCurrentUser(request);
			return llmProviderOAuthService.startOAuthFlow({
				userId: currentUser.userId,
				providerConfigId: request.params.providerConfigId,
				requestBaseUrl: getRequestBaseUrl(request),
				...toLlmProviderOAuthStartRequestDto(request.body),
			});
		},
	);

	app.get<{ Params: ProviderOAuthFlowParamsSchemaDto }>(
		"/me/llm-providers/:providerConfigId/oauth/flows/:flowId",
		{
			schema: {
				params: ProviderOAuthFlowParamsSchema,
			},
		},
		async (request): Promise<OAuthFlowStatusResult> => {
			const currentUser = await authorizationGuard.requireCurrentUser(request);
			return llmProviderOAuthService.getOAuthFlowStatus({
				userId: currentUser.userId,
				providerConfigId: request.params.providerConfigId,
				flowId: request.params.flowId,
			});
		},
	);

	app.delete<{ Params: ProviderConfigIdParamsSchemaDto }>(
		"/me/llm-providers/:providerConfigId/oauth-account",
		{
			schema: {
				params: ProviderConfigIdParamsSchema,
			},
		},
		async (request) => {
			const currentUser = await authorizationGuard.requireCurrentUser(request);
			return toLlmProviderConfigResponseDto(
				await llmProviderOAuthService.clearOAuthCredential(currentUser.userId, request.params.providerConfigId),
			);
		},
	);

	app.get("/oauth/llm-provider-flows/openai-codex/callback", async (request, reply) => {
		const query = request.query as { state?: string; code?: string };
		const result = await llmProviderOAuthService.completeOpenAICodexCallback({
			state: query.state,
			code: query.code,
			requestBaseUrl: getRequestBaseUrl(request),
		});
		reply.code(result.statusCode);
		reply.header("content-type", "text/html; charset=utf-8");
		return result.body;
	});
};

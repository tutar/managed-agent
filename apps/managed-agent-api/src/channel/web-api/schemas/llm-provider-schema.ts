import { type Static, Type } from "@sinclair/typebox";

const NonEmptyStringSchema = Type.String({ minLength: 1 });

export const OAuthCredentialSchema = Type.Object({
	access: NonEmptyStringSchema,
	refresh: NonEmptyStringSchema,
	expires: Type.Number({ minimum: 0 }),
});

export const ProviderHeadersSchema = Type.Optional(Type.Record(Type.String(), Type.String()));

export const LlmProviderConfigRequestSchema = Type.Object({
	providerType: NonEmptyStringSchema,
	displayName: Type.Optional(NonEmptyStringSchema),
	baseUrl: Type.Optional(NonEmptyStringSchema),
	headers: ProviderHeadersSchema,
	availableModels: Type.Optional(Type.Array(NonEmptyStringSchema, { minItems: 1 })),
	defaultModelId: Type.Optional(NonEmptyStringSchema),
	defaultThinkingLevel: Type.Optional(NonEmptyStringSchema),
	enabled: Type.Optional(Type.Boolean()),
	apiKey: Type.Optional(NonEmptyStringSchema),
	oauthCredential: Type.Optional(OAuthCredentialSchema),
});

export const LlmProviderConfigPatchSchema = Type.Partial(LlmProviderConfigRequestSchema);

export const ProviderConfigIdParamsSchema = Type.Object({
	providerConfigId: NonEmptyStringSchema,
});

export const LlmProviderOAuthStartRequestSchema = Type.Object({
	enterpriseUrl: Type.Optional(NonEmptyStringSchema),
});

export const ProviderOAuthFlowParamsSchema = Type.Object({
	providerConfigId: NonEmptyStringSchema,
	flowId: NonEmptyStringSchema,
});

export type OAuthCredentialSchemaDto = Static<typeof OAuthCredentialSchema>;
export type LlmProviderConfigRequestSchemaDto = Static<typeof LlmProviderConfigRequestSchema>;
export type LlmProviderConfigPatchSchemaDto = Static<typeof LlmProviderConfigPatchSchema>;
export type ProviderConfigIdParamsSchemaDto = Static<typeof ProviderConfigIdParamsSchema>;
export type LlmProviderOAuthStartRequestSchemaDto = Static<typeof LlmProviderOAuthStartRequestSchema>;
export type ProviderOAuthFlowParamsSchemaDto = Static<typeof ProviderOAuthFlowParamsSchema>;

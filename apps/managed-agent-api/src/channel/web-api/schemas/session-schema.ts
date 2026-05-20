import { type Static, Type } from "@sinclair/typebox";

/**
 * Route schemas for the Managed Agent HTTP API.
 *
 * These schemas define the public web-api contract and keep transport
 * validation separate from control-plane orchestration.
 */
const InputTextContentItemSchema = Type.Object({
	type: Type.Literal("text"),
	text: Type.String({ minLength: 1 }),
});

const InputMediaContentItemSchema = Type.Object({
	type: Type.Union([Type.Literal("image"), Type.Literal("video")]),
	url: Type.String({ minLength: 1 }),
});

const InputContentItemSchema = Type.Union([InputTextContentItemSchema, InputMediaContentItemSchema]);

const CreateSessionInputSchema = Type.Object({
	content: Type.Array(InputContentItemSchema, {
		minItems: 1,
	}),
});

export const CreateSessionRequestSchema = Type.Object({
	providerConfigId: Type.String({ minLength: 1 }),
	modelId: Type.Optional(Type.String({ minLength: 1 })),
	capabilityTier: Type.Optional(Type.Union([Type.Literal("fast"), Type.Literal("balanced"), Type.Literal("strong")])),
	thinkingLevel: Type.Optional(Type.String({ minLength: 1 })),
	input: CreateSessionInputSchema,
});

export const CreateMessageRequestSchema = Type.Object({
	input: CreateSessionInputSchema,
});

export const UpdateSessionRequestSchema = Type.Object({
	sessionName: Type.String({ minLength: 1 }),
});

export const CreateTriggerRequestSchema = Type.Object({
	triggerType: Type.Optional(Type.String({ minLength: 1 })),
});

export const SessionIdParamsSchema = Type.Object({
	sessionId: Type.String({ minLength: 1 }),
});

export const UserIdParamsSchema = Type.Object({
	userId: Type.String({ minLength: 1 }),
});

export const ListUserSessionsQuerySchema = Type.Object({
	limit: Type.Optional(
		Type.String({
			pattern: "^(?:[1-9][0-9]?|100)$",
		}),
	),
	cursor: Type.Optional(Type.String({ minLength: 1 })),
});

export const StreamControlQuerySchema = Type.Object({
	includeProcess: Type.Optional(Type.String()),
	includeFinal: Type.Optional(Type.String()),
});

export type CreateSessionRequestSchemaDto = Static<typeof CreateSessionRequestSchema>;
export type CreateMessageRequestSchemaDto = Static<typeof CreateMessageRequestSchema>;
export type UpdateSessionRequestSchemaDto = Static<typeof UpdateSessionRequestSchema>;
export type CreateTriggerRequestSchemaDto = Static<typeof CreateTriggerRequestSchema>;
export type SessionIdParamsSchemaDto = Static<typeof SessionIdParamsSchema>;
export type UserIdParamsSchemaDto = Static<typeof UserIdParamsSchema>;
export type ListUserSessionsQuerySchemaDto = Static<typeof ListUserSessionsQuerySchema>;
export type StreamControlQuerySchemaDto = Static<typeof StreamControlQuerySchema>;

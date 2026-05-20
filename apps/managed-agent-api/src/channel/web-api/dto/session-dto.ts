import type { DemoContentItem, InputContentItem, SessionEntry } from "../../../control-plane/session/entry-factory.js";
import type {
	SessionRecord,
	SessionStatus,
	UserSessionsPageRecord,
} from "../../../control-plane/session/repositories/session-repository.js";
import { ValidationError } from "../errors/http-errors.js";
import type {
	CreateMessageRequestSchemaDto,
	CreateSessionRequestSchemaDto,
	CreateTriggerRequestSchemaDto,
	ListUserSessionsQuerySchemaDto,
	StreamControlQuerySchemaDto,
	UpdateSessionRequestSchemaDto,
} from "../schemas/session-schema.js";

/**
 * HTTP DTOs and TypeBox schemas for the Managed Agent API.
 *
 * Route schemas own request validation. The helpers below only normalize or
 * map already-validated transport data into service-facing DTOs.
 */
export type CreateSessionRequestDto = {
	providerConfigId: string;
	modelId?: string;
	thinkingLevel?: string;
	input: {
		content: InputContentItem[];
	};
};

export type CreateMessageRequestDto = {
	input: {
		content: InputContentItem[];
	};
};

export type CreateTriggerRequestDto = {
	triggerType?: string;
};

export type UpdateSessionRequestDto = {
	sessionName: string;
};

export type ListUserSessionsQueryDto = {
	limit?: number;
	cursor?: string;
};

export type SessionResponseEntryDto = {
	id: string;
	parentId: string | null;
	createdAt: string;
	messageType: SessionEntry["messageType"];
	content: DemoContentItem[];
};

export type SessionDetailResponseDto = {
	sessionId: string;
	sessionName: string;
	status: SessionStatus;
	model: string;
	thinkingLevel: string;
	providerConfigId?: string;
	providerType?: string;
	createdAt: string;
	lastActiveAt: string;
	entries: SessionResponseEntryDto[];
};

export type SessionListItemDto = {
	sessionId: string;
	sessionName: string;
	lastActiveAt: string;
};

export type UserSessionsResponseDto = {
	items: SessionListItemDto[];
	nextCursor: string | null;
	hasMore: boolean;
};

export type CancelSessionResponseDto = {
	sessionId: string;
	accepted: boolean;
};

export type TriggerAcceptedResponseDto = {
	triggerId: string;
	accepted: true;
	triggerType: string;
};

export type ErrorResponseDto = {
	error: {
		code: string;
		message: string;
	};
};

const trimOptionalString = (value?: string) => {
	if (!value) {
		return undefined;
	}

	const trimmedValue = value.trim();
	return trimmedValue.length > 0 ? trimmedValue : undefined;
};

/** Normalize a validated create-session body into the service DTO. */
export const toCreateSessionRequestDto = (body: CreateSessionRequestSchemaDto): CreateSessionRequestDto => {
	return {
		providerConfigId: body.providerConfigId.trim(),
		modelId: trimOptionalString(body.modelId),
		thinkingLevel: trimOptionalString(body.thinkingLevel),
		input: {
			content: body.input.content as InputContentItem[],
		},
	};
};

/**
 * Compatibility helper for non-route tests that still need a DTO builder
 * without spinning up Fastify validation.
 */
export const parseCreateSessionRequestDto = (body: unknown): CreateSessionRequestDto => {
	if (typeof body !== "object" || body === null) {
		throw new ValidationError("input.content is required");
	}

	const { input, providerConfigId, modelId, thinkingLevel } = body as {
		input?: { content?: unknown[] };
		providerConfigId?: unknown;
		modelId?: unknown;
		thinkingLevel?: unknown;
	};

	if (typeof providerConfigId !== "string" || providerConfigId.trim().length === 0) {
		throw new ValidationError("providerConfigId is required");
	}

	if (!input || !Array.isArray(input.content) || input.content.length === 0) {
		throw new ValidationError("input.content is required");
	}

	return {
		providerConfigId: providerConfigId.trim(),
		modelId: typeof modelId === "string" ? trimOptionalString(modelId) : undefined,
		thinkingLevel: typeof thinkingLevel === "string" ? trimOptionalString(thinkingLevel) : undefined,
		input: {
			content: input.content as InputContentItem[],
		},
	};
};

/** Normalize a validated create-message body into the service DTO. */
export const toCreateMessageRequestDto = (body: CreateMessageRequestSchemaDto): CreateMessageRequestDto => {
	return {
		input: {
			content: body.input.content as InputContentItem[],
		},
	};
};

/** Compatibility helper for non-route tests that still need message DTO parsing. */
export const parseCreateMessageRequestDto = (body: unknown): CreateMessageRequestDto => {
	if (typeof body !== "object" || body === null) {
		throw new ValidationError("input.content is required");
	}

	const { input } = body as {
		input?: { content?: unknown[] };
	};

	if (!input || !Array.isArray(input.content) || input.content.length === 0) {
		throw new ValidationError("input.content is required");
	}

	return {
		input: {
			content: input.content as InputContentItem[],
		},
	};
};

/** Normalize a validated rename body into the service DTO. */
export const toUpdateSessionRequestDto = (body: UpdateSessionRequestSchemaDto): UpdateSessionRequestDto => {
	const sessionName = body.sessionName.trim();

	if (sessionName.length === 0) {
		throw new ValidationError("sessionName is required");
	}

	return {
		sessionName,
	};
};

/** Normalize a validated trigger body into the service DTO. */
export const toCreateTriggerRequestDto = (body: CreateTriggerRequestSchemaDto): CreateTriggerRequestDto => {
	return {
		triggerType: trimOptionalString(body.triggerType),
	};
};

/** Normalize list-session query parameters after schema validation. */
export const toListUserSessionsQueryDto = (query: ListUserSessionsQuerySchemaDto): ListUserSessionsQueryDto => {
	return {
		limit: query.limit ? Number.parseInt(query.limit, 10) : undefined,
		cursor: query.cursor,
	};
};

/** Normalize the stream control query flags used by the SSE routes. */
export const toStreamControlQueryDto = (query: StreamControlQuerySchemaDto) => {
	return {
		includeProcess: query.includeProcess !== "false",
		includeFinal: query.includeFinal !== "false",
	};
};

/** Map a session domain record into the HTTP detail response shape. */
export const toSessionDetailResponseDto = (
	session: SessionRecord,
	status = session.status,
): SessionDetailResponseDto => {
	return {
		sessionId: session.sessionId,
		sessionName: session.sessionName,
		status,
		model: session.model,
		thinkingLevel: session.thinkingLevel,
		providerConfigId: session.providerConfigId,
		providerType: session.providerType,
		createdAt: session.createdAt,
		lastActiveAt: session.updatedAt,
		entries: session.entries.map((entry) => ({
			id: entry.id,
			parentId: entry.parentId,
			createdAt: entry.createdAt,
			messageType: entry.messageType,
			content: entry.content,
		})),
	};
};

/** Map the recent-session projection into the list response shape. */
export const toUserSessionsResponseDto = (page: UserSessionsPageRecord): UserSessionsResponseDto => {
	return {
		items: page.items,
		nextCursor: page.nextCursor,
		hasMore: page.hasMore,
	};
};

/** Build the cancel response DTO used by the HTTP route. */
export const toCancelSessionResponseDto = (sessionId: string, accepted: boolean): CancelSessionResponseDto => {
	return {
		sessionId,
		accepted,
	};
};

/** Build the trigger accepted response DTO used by the HTTP route. */
export const toTriggerAcceptedResponseDto = (result: {
	triggerId: string;
	accepted: true;
	triggerType: string;
}): TriggerAcceptedResponseDto => {
	return result;
};

/** Build a standard JSON error body. */
export const toErrorResponseDto = (code: string, message: string): ErrorResponseDto => {
	return {
		error: {
			code,
			message,
		},
	};
};

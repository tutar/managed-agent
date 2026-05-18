import type { FastifyInstance, FastifyReply } from "fastify";
import type {
	SessionRecord,
	SessionStatus,
	UserSessionsPageRecord,
} from "../../../control-plane/session/repositories/session-repository.js";
import type { AuthorizationGuard } from "../../../identity/authorization-guard.js";
import type { CreateMessageRequestDto, CreateSessionRequestDto } from "../dto/session-dto.js";
import {
	toCancelSessionResponseDto,
	toCreateMessageRequestDto,
	toCreateSessionRequestDto,
	toListUserSessionsQueryDto,
	toSessionDetailResponseDto,
	toStreamControlQueryDto,
	toUpdateSessionRequestDto,
	toUserSessionsResponseDto,
} from "../dto/session-dto.js";
import { NotFoundError } from "../errors/http-errors.js";
import {
	CreateMessageRequestSchema,
	type CreateMessageRequestSchemaDto,
	CreateSessionRequestSchema,
	type CreateSessionRequestSchemaDto,
	ListUserSessionsQuerySchema,
	type ListUserSessionsQuerySchemaDto,
	SessionIdParamsSchema,
	type SessionIdParamsSchemaDto,
	StreamControlQuerySchema,
	type StreamControlQuerySchemaDto,
	UpdateSessionRequestSchema,
	type UpdateSessionRequestSchemaDto,
	UserIdParamsSchema,
	type UserIdParamsSchemaDto,
} from "../schemas/session-schema.js";

/**
 * Register session CRUD, stream, and list routes.
 */
export const registerSessionRoutes = (
	app: FastifyInstance,
	{
		managedSessionService,
		authorizationGuard,
		streamResponseProxy,
	}: {
		managedSessionService: {
			createSession(input: {
				request: CreateSessionRequestDto;
				userId: string;
				includeProcess: boolean;
				includeFinal: boolean;
				origin?: string;
				response: FastifyReply["raw"];
			}): Promise<void>;
			submitMessage(input: {
				sessionId: string;
				request: CreateMessageRequestDto;
				includeProcess: boolean;
				includeFinal: boolean;
				origin?: string;
				response: FastifyReply["raw"];
			}): Promise<void>;
			getSession(sessionId: string): Promise<SessionRecord | null>;
			getSessionStatus(sessionId: string): Promise<SessionStatus | null>;
			listUserSessions(
				userId: string,
				options?: { limit?: number; cursor?: string },
			): Promise<UserSessionsPageRecord>;
			updateSessionName(sessionId: string, sessionName: string): Promise<SessionRecord>;
			archiveSession(sessionId: string): Promise<void>;
			cancelSession(sessionId: string): Promise<boolean>;
		};
		authorizationGuard: AuthorizationGuard;
		streamResponseProxy: {
			forwardCreateSession(input: {
				reply: FastifyReply;
				request: CreateSessionRequestDto;
				userId: string;
				includeProcess: boolean;
				includeFinal: boolean;
				origin?: string;
			}): Promise<FastifyReply>;
			forwardSubmitMessage(input: {
				reply: FastifyReply;
				sessionId: string;
				request: CreateMessageRequestDto;
				includeProcess: boolean;
				includeFinal: boolean;
				origin?: string;
			}): Promise<FastifyReply>;
		};
	},
) => {
	app.post<{ Body: CreateSessionRequestSchemaDto; Querystring: StreamControlQuerySchemaDto }>(
		"/sessions",
		{
			schema: {
				body: CreateSessionRequestSchema,
				querystring: StreamControlQuerySchema,
			},
		},
		async (request, reply) => {
			const currentUser = await authorizationGuard.requireCurrentUser(request);
			const streamControl = toStreamControlQueryDto(request.query);

			return streamResponseProxy.forwardCreateSession({
				reply,
				request: toCreateSessionRequestDto(request.body),
				userId: currentUser.userId,
				includeProcess: streamControl.includeProcess,
				includeFinal: streamControl.includeFinal,
				origin: typeof request.headers.origin === "string" ? request.headers.origin : undefined,
			});
		},
	);

	app.patch<{ Params: SessionIdParamsSchemaDto; Body: UpdateSessionRequestSchemaDto }>(
		"/sessions/:sessionId",
		{
			schema: {
				params: SessionIdParamsSchema,
				body: UpdateSessionRequestSchema,
			},
		},
		async (request) => {
			await authorizationGuard.requireOwnedSession(request, request.params.sessionId);
			return toSessionDetailResponseDto(
				await managedSessionService.updateSessionName(
					request.params.sessionId,
					toUpdateSessionRequestDto(request.body).sessionName,
				),
			);
		},
	);

	app.delete<{ Params: SessionIdParamsSchemaDto }>(
		"/sessions/:sessionId",
		{
			schema: {
				params: SessionIdParamsSchema,
			},
		},
		async (request, reply) => {
			await authorizationGuard.requireOwnedSession(request, request.params.sessionId);
			await managedSessionService.archiveSession(request.params.sessionId);
			reply.status(204).send();
		},
	);

	app.post<{
		Params: SessionIdParamsSchemaDto;
		Body: CreateMessageRequestSchemaDto;
		Querystring: StreamControlQuerySchemaDto;
	}>(
		"/sessions/:sessionId/messages",
		{
			schema: {
				params: SessionIdParamsSchema,
				body: CreateMessageRequestSchema,
				querystring: StreamControlQuerySchema,
			},
		},
		async (request, reply) => {
			await authorizationGuard.requireOwnedSession(request, request.params.sessionId);
			const streamControl = toStreamControlQueryDto(request.query);

			return streamResponseProxy.forwardSubmitMessage({
				reply,
				sessionId: request.params.sessionId,
				request: toCreateMessageRequestDto(request.body),
				includeProcess: streamControl.includeProcess,
				includeFinal: streamControl.includeFinal,
				origin: typeof request.headers.origin === "string" ? request.headers.origin : undefined,
			});
		},
	);

	app.get<{ Params: SessionIdParamsSchemaDto }>(
		"/sessions/:sessionId",
		{
			schema: {
				params: SessionIdParamsSchema,
			},
		},
		async (request) => {
			const { session } = await authorizationGuard.requireOwnedSession(request, request.params.sessionId);
			return toSessionDetailResponseDto(
				session,
				(await managedSessionService.getSessionStatus(request.params.sessionId)) ?? session.status,
			);
		},
	);

	app.get<{ Params: UserIdParamsSchemaDto; Querystring: ListUserSessionsQuerySchemaDto }>(
		"/users/:userId/sessions",
		{
			schema: {
				params: UserIdParamsSchema,
				querystring: ListUserSessionsQuerySchema,
			},
		},
		async (request) => {
			const currentUser = await authorizationGuard.requireCurrentUser(request);

			if (request.params.userId !== currentUser.userId) {
				throw new NotFoundError(`user session list ${request.params.userId} not found`, "session_not_found");
			}

			return toUserSessionsResponseDto(
				await managedSessionService.listUserSessions(currentUser.userId, toListUserSessionsQueryDto(request.query)),
			);
		},
	);

	app.get<{ Querystring: ListUserSessionsQuerySchemaDto }>(
		"/me/sessions",
		{
			schema: {
				querystring: ListUserSessionsQuerySchema,
			},
		},
		async (request) => {
			const currentUser = await authorizationGuard.requireCurrentUser(request);
			return toUserSessionsResponseDto(
				await managedSessionService.listUserSessions(currentUser.userId, toListUserSessionsQueryDto(request.query)),
			);
		},
	);

	app.post<{ Params: SessionIdParamsSchemaDto }>(
		"/sessions/:sessionId/cancel",
		{
			schema: {
				params: SessionIdParamsSchema,
			},
		},
		async (request) => {
			await authorizationGuard.requireOwnedSession(request, request.params.sessionId);

			return toCancelSessionResponseDto(
				request.params.sessionId,
				await managedSessionService.cancelSession(request.params.sessionId),
			);
		},
	);
};

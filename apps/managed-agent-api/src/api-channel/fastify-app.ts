import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import type { Static } from "@sinclair/typebox";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";

import type { SessionRecord, SessionStatus } from "../control-plane/repositories/session-repository.js";
import type { CurrentUserResponseDto, LoginRequestDto, RegisterRequestDto } from "../dto/auth-dto.js";
import {
	CurrentUserResponseSchema,
	LoginRequestSchema,
	LogoutResponseSchema,
	RegisterRequestSchema,
	toCurrentUserResponseDto,
	toLoginRequestDto,
	toLogoutResponseDto,
	toRegisterRequestDto,
} from "../dto/auth-dto.js";
import type {
	CreateMessageRequestDto,
	CreateSessionRequestDto,
	CreateTriggerRequestDto,
	UpdateSessionRequestDto,
} from "../dto/session-dto.js";
import {
	CreateMessageRequestSchema,
	CreateSessionRequestSchema,
	CreateTriggerRequestSchema,
	ListUserSessionsQuerySchema,
	SessionIdParamsSchema,
	StreamControlQuerySchema,
	toCancelSessionResponseDto,
	toCreateMessageRequestDto,
	toCreateSessionRequestDto,
	toCreateTriggerRequestDto,
	toListUserSessionsQueryDto,
	toSessionDetailResponseDto,
	toStreamControlQueryDto,
	toTriggerAcceptedResponseDto,
	toUpdateSessionRequestDto,
	toUserSessionsResponseDto,
	UpdateSessionRequestSchema,
	UserIdParamsSchema,
} from "../dto/session-dto.js";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "./http-errors.js";

type CreateSessionRequestBody = Static<typeof CreateSessionRequestSchema>;
type CreateMessageRequestBody = Static<typeof CreateMessageRequestSchema>;
type UpdateSessionRequestBody = Static<typeof UpdateSessionRequestSchema>;
type CreateTriggerRequestBody = Static<typeof CreateTriggerRequestSchema>;
type SessionIdParams = Static<typeof SessionIdParamsSchema>;
type UserIdParams = Static<typeof UserIdParamsSchema>;
type ListUserSessionsQuery = Static<typeof ListUserSessionsQuerySchema>;
type StreamControlQuery = Static<typeof StreamControlQuerySchema>;
type RegisterRequestBody = Static<typeof RegisterRequestSchema>;
type LoginRequestBody = Static<typeof LoginRequestSchema>;

type RouteDependencies = {
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
		): Promise<import("../control-plane/repositories/session-repository.js").UserSessionsPageRecord>;
		updateSessionName(sessionId: string, sessionName: UpdateSessionRequestDto["sessionName"]): Promise<SessionRecord>;
		archiveSession(sessionId: string): Promise<void>;
		cancelSession(sessionId: string): Promise<boolean>;
	};
	triggerService: {
		createTrigger(body: CreateTriggerRequestDto): {
			triggerId: string;
			accepted: true;
			triggerType: string;
		};
	};
	authService: {
		register(input: RegisterRequestDto): Promise<{
			user: CurrentUserResponseDto;
			loginSessionId: string;
		}>;
		login(input: LoginRequestDto): Promise<{
			user: CurrentUserResponseDto;
			loginSessionId: string;
		}>;
		logout(loginSessionId: string): Promise<void>;
	};
	currentUserResolver: {
		requireUser(loginSessionId: string | null): Promise<CurrentUserResponseDto>;
	};
	sessionCookieManager: {
		readCookieValue(request: FastifyRequest): string | null;
		setLoginSessionCookie(reply: FastifyReply, loginSessionId: string): void;
		clearLoginSessionCookie(reply: FastifyReply): void;
	};
};

/**
 * Build the Fastify application for the Managed Agent API.
 *
 * Fastify owns HTTP transport, validation, cookies, and CORS. Business
 * orchestration stays in the existing control-plane and auth services.
 */
export const createApiApp = async ({
	managedSessionService,
	triggerService,
	authService,
	currentUserResolver,
	sessionCookieManager,
}: RouteDependencies): Promise<FastifyInstance> => {
	const app = Fastify({
		logger: false,
	});
	const hasValidationPayload = (error: unknown): error is { validation: unknown } => {
		return typeof error === "object" && error !== null && "validation" in error;
	};

	await app.register(fastifyCors, {
		origin: true,
		credentials: true,
		methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
		allowedHeaders: ["content-type"],
	});
	await app.register(fastifyCookie);

	app.setErrorHandler((error, _request, reply) => {
		let statusCode = 500;
		let code = "internal_error";
		const message = error instanceof Error ? error.message : "internal error";

		if (error instanceof ValidationError || hasValidationPayload(error)) {
			statusCode = 400;
			code = "bad_request";
		} else if (error instanceof UnauthorizedError) {
			statusCode = 401;
			code = error.code;
		} else if (error instanceof NotFoundError) {
			statusCode = 404;
			code = error.code;
		} else if (error instanceof ConflictError) {
			statusCode = 409;
			code = error.code;
		}

		reply.status(statusCode).send({
			error: {
				code,
				message,
			},
		});
	});

	const getLoginSessionId = (request: FastifyRequest) => {
		return sessionCookieManager.readCookieValue(request);
	};

	const requireCurrentUser = async (request: FastifyRequest) => {
		return currentUserResolver.requireUser(getLoginSessionId(request));
	};

	const requireOwnedSession = async (request: FastifyRequest, sessionId: string) => {
		const currentUser = await requireCurrentUser(request);
		const session = await managedSessionService.getSession(sessionId);

		if (!session || session.userId !== currentUser.userId) {
			throw new NotFoundError(`session ${sessionId} not found`);
		}

		return {
			currentUser,
			session,
		};
	};

	app.get("/health", async () => {
		return { ok: true };
	});

	app.post<{ Body: RegisterRequestBody }>(
		"/auth/register",
		{
			schema: {
				body: RegisterRequestSchema,
				response: {
					200: CurrentUserResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const result = await authService.register(toRegisterRequestDto(request.body));
			sessionCookieManager.setLoginSessionCookie(reply, result.loginSessionId);
			return toCurrentUserResponseDto(result.user);
		},
	);

	app.post<{ Body: LoginRequestBody }>(
		"/auth/login",
		{
			schema: {
				body: LoginRequestSchema,
				response: {
					200: CurrentUserResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const result = await authService.login(toLoginRequestDto(request.body));
			sessionCookieManager.setLoginSessionCookie(reply, result.loginSessionId);
			return toCurrentUserResponseDto(result.user);
		},
	);

	app.post(
		"/auth/logout",
		{
			schema: {
				response: {
					200: LogoutResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const loginSessionId = getLoginSessionId(request);

			if (loginSessionId) {
				await authService.logout(loginSessionId);
			}

			sessionCookieManager.clearLoginSessionCookie(reply);
			return toLogoutResponseDto();
		},
	);

	app.get(
		"/me",
		{
			schema: {
				response: {
					200: CurrentUserResponseSchema,
				},
			},
		},
		async (request) => {
			return requireCurrentUser(request);
		},
	);

	app.post<{ Body: CreateSessionRequestBody; Querystring: StreamControlQuery }>(
		"/sessions",
		{
			schema: {
				body: CreateSessionRequestSchema,
				querystring: StreamControlQuerySchema,
			},
		},
		async (request, reply) => {
			const currentUser = await requireCurrentUser(request);
			const streamControl = toStreamControlQueryDto(request.query);

			reply.hijack();
			await managedSessionService.createSession({
				request: toCreateSessionRequestDto(request.body),
				userId: currentUser.userId,
				includeProcess: streamControl.includeProcess,
				includeFinal: streamControl.includeFinal,
				origin: typeof request.headers.origin === "string" ? request.headers.origin : undefined,
				response: reply.raw,
			});
			return reply;
		},
	);

	app.patch<{ Params: SessionIdParams; Body: UpdateSessionRequestBody }>(
		"/sessions/:sessionId",
		{
			schema: {
				params: SessionIdParamsSchema,
				body: UpdateSessionRequestSchema,
			},
		},
		async (request) => {
			await requireOwnedSession(request, request.params.sessionId);
			return toSessionDetailResponseDto(
				await managedSessionService.updateSessionName(
					request.params.sessionId,
					toUpdateSessionRequestDto(request.body).sessionName,
				),
			);
		},
	);

	app.delete<{ Params: SessionIdParams }>(
		"/sessions/:sessionId",
		{
			schema: {
				params: SessionIdParamsSchema,
			},
		},
		async (request, reply) => {
			await requireOwnedSession(request, request.params.sessionId);
			await managedSessionService.archiveSession(request.params.sessionId);
			reply.status(204).send();
		},
	);

	app.post<{ Params: SessionIdParams; Body: CreateMessageRequestBody; Querystring: StreamControlQuery }>(
		"/sessions/:sessionId/messages",
		{
			schema: {
				params: SessionIdParamsSchema,
				body: CreateMessageRequestSchema,
				querystring: StreamControlQuerySchema,
			},
		},
		async (request, reply) => {
			await requireOwnedSession(request, request.params.sessionId);
			const streamControl = toStreamControlQueryDto(request.query);

			reply.hijack();
			await managedSessionService.submitMessage({
				sessionId: request.params.sessionId,
				request: toCreateMessageRequestDto(request.body),
				includeProcess: streamControl.includeProcess,
				includeFinal: streamControl.includeFinal,
				origin: typeof request.headers.origin === "string" ? request.headers.origin : undefined,
				response: reply.raw,
			});
			return reply;
		},
	);

	app.get<{ Params: SessionIdParams }>(
		"/sessions/:sessionId",
		{
			schema: {
				params: SessionIdParamsSchema,
			},
		},
		async (request) => {
			const { session } = await requireOwnedSession(request, request.params.sessionId);
			return toSessionDetailResponseDto(
				session,
				(await managedSessionService.getSessionStatus(request.params.sessionId)) ?? session.status,
			);
		},
	);

	app.get<{ Params: UserIdParams; Querystring: ListUserSessionsQuery }>(
		"/users/:userId/sessions",
		{
			schema: {
				params: UserIdParamsSchema,
				querystring: ListUserSessionsQuerySchema,
			},
		},
		async (request) => {
			const currentUser = await requireCurrentUser(request);

			if (request.params.userId !== currentUser.userId) {
				throw new NotFoundError(`user session list ${request.params.userId} not found`, "session_not_found");
			}

			return toUserSessionsResponseDto(
				await managedSessionService.listUserSessions(currentUser.userId, toListUserSessionsQueryDto(request.query)),
			);
		},
	);

	app.get<{ Querystring: ListUserSessionsQuery }>(
		"/me/sessions",
		{
			schema: {
				querystring: ListUserSessionsQuerySchema,
			},
		},
		async (request) => {
			const currentUser = await requireCurrentUser(request);
			return toUserSessionsResponseDto(
				await managedSessionService.listUserSessions(currentUser.userId, toListUserSessionsQueryDto(request.query)),
			);
		},
	);

	app.post<{ Params: SessionIdParams }>(
		"/sessions/:sessionId/cancel",
		{
			schema: {
				params: SessionIdParamsSchema,
			},
		},
		async (request) => {
			await requireOwnedSession(request, request.params.sessionId);

			return toCancelSessionResponseDto(
				request.params.sessionId,
				await managedSessionService.cancelSession(request.params.sessionId),
			);
		},
	);

	app.post<{ Body: CreateTriggerRequestBody }>(
		"/triggers",
		{
			schema: {
				body: CreateTriggerRequestSchema,
			},
		},
		async (request) => {
			await requireCurrentUser(request);
			return toTriggerAcceptedResponseDto(triggerService.createTrigger(toCreateTriggerRequestDto(request.body)));
		},
	);

	return app;
};

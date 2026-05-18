import type { FastifyInstance, FastifyReply } from "fastify";

import type { AuthorizationGuard } from "../../../identity/authorization-guard.js";
import {
	toCurrentUserResponseDto,
	toLoginRequestDto,
	toLogoutResponseDto,
	toRegisterRequestDto,
} from "../dto/auth-dto.js";
import {
	CurrentUserResponseSchema,
	LoginRequestSchema,
	type LoginRequestSchemaDto,
	LogoutResponseSchema,
	RegisterRequestSchema,
	type RegisterRequestSchemaDto,
} from "../schemas/auth-schema.js";

/**
 * Register authentication routes for username/password login sessions.
 */
export const registerAuthRoutes = (
	app: FastifyInstance,
	{
		authService,
		authorizationGuard,
		sessionCookieManager,
	}: {
		authService: {
			register(input: { username: string; password: string }): Promise<{
				user: {
					userId: string;
					username: string;
					status: string;
					createdAt: string;
					lastLoginAt: string | null;
				};
				loginSessionId: string;
			}>;
			login(input: { username: string; password: string }): Promise<{
				user: {
					userId: string;
					username: string;
					status: string;
					createdAt: string;
					lastLoginAt: string | null;
				};
				loginSessionId: string;
			}>;
			logout(loginSessionId: string): Promise<void>;
		};
		authorizationGuard: AuthorizationGuard;
		sessionCookieManager: {
			setLoginSessionCookie(reply: FastifyReply, loginSessionId: string): void;
			clearLoginSessionCookie(reply: FastifyReply): void;
		};
	},
) => {
	app.post<{ Body: RegisterRequestSchemaDto }>(
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

	app.post<{ Body: LoginRequestSchemaDto }>(
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
			const loginSessionId = authorizationGuard.getLoginSessionId(request);

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
			return authorizationGuard.requireCurrentUser(request);
		},
	);
};

import type { FastifyInstance, FastifyReply } from "fastify";
import Fastify from "fastify";
import type { CreateMessageRequestDto, CreateSessionRequestDto } from "../channel/web-api/dto/session-dto.js";
import { registerWebApiAdapter } from "../channel/web-api-adapter.js";
import type {
	SessionRecord,
	SessionStatus,
	UserSessionsPageRecord,
} from "../control-plane/session/repositories/session-repository.js";
import type { AuthorizationGuard } from "../identity/authorization-guard.js";
import { registerErrorHandler } from "./error-handler.js";
import { registerCookiePlugin } from "./plugins/cookie.js";
import { registerCorsPlugin } from "./plugins/cors.js";

/**
 * Build the Fastify application for managed-agent-api.
 *
 * The app layer owns framework setup only. Route registration and service
 * orchestration stay delegated to the web-api adapter and lower layers.
 */
export const createApiApp = async ({
	managedSessionService,
	triggerService,
	authService,
	authorizationGuard,
	sessionCookieManager,
}: {
	managedSessionService: {
		createSession: (input: {
			request: CreateSessionRequestDto;
			userId: string;
			includeProcess: boolean;
			includeFinal: boolean;
			origin?: string;
			response: FastifyReply["raw"];
		}) => Promise<void>;
		submitMessage: (input: {
			sessionId: string;
			request: CreateMessageRequestDto;
			includeProcess: boolean;
			includeFinal: boolean;
			origin?: string;
			response: FastifyReply["raw"];
		}) => Promise<void>;
		getSession: (sessionId: string) => Promise<SessionRecord | null>;
		getSessionStatus: (sessionId: string) => Promise<SessionStatus | null>;
		listUserSessions: (
			userId: string,
			options?: { limit?: number; cursor?: string },
		) => Promise<UserSessionsPageRecord>;
		updateSessionName: (sessionId: string, sessionName: string) => Promise<SessionRecord>;
		archiveSession: (sessionId: string) => Promise<void>;
		cancelSession: (sessionId: string) => Promise<boolean>;
	};
	triggerService: {
		createTrigger(input: { triggerType?: string }): {
			triggerId: string;
			accepted: true;
			triggerType: string;
		};
	};
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
}): Promise<FastifyInstance> => {
	const app = Fastify({
		logger: false,
	});

	await registerCorsPlugin(app);
	await registerCookiePlugin(app);
	registerErrorHandler(app);
	registerWebApiAdapter(app, {
		managedSessionService,
		triggerService,
		authService,
		authorizationGuard,
		sessionCookieManager,
	});

	return app;
};

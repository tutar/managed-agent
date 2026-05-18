import type { FastifyInstance, FastifyReply } from "fastify";
import type {
	SessionRecord,
	SessionStatus,
	UserSessionsPageRecord,
} from "../control-plane/session/repositories/session-repository.js";
import type { AuthorizationGuard } from "../identity/authorization-guard.js";
import type { CreateMessageRequestDto, CreateSessionRequestDto } from "./web-api/dto/session-dto.js";
import { registerAuthRoutes } from "./web-api/routes/auth-routes.js";
import { registerHealthRoutes } from "./web-api/routes/health-routes.js";
import { registerSessionRoutes } from "./web-api/routes/session-routes.js";
import { registerTriggerRoutes } from "./web-api/routes/trigger-routes.js";
import { createStreamResponseProxy } from "./web-api/sse/stream-response-proxy.js";

/**
 * Register the standalone HTTP API adapter for managed-agent-api.
 *
 * This adapter owns Fastify route registration while delegating orchestration,
 * auth, and durable state handling to the underlying services.
 */
export const registerWebApiAdapter = (
	app: FastifyInstance,
	{
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
	},
) => {
	registerHealthRoutes(app);
	registerAuthRoutes(app, {
		authService,
		authorizationGuard,
		sessionCookieManager,
	});
	registerSessionRoutes(app, {
		managedSessionService,
		authorizationGuard,
		streamResponseProxy: createStreamResponseProxy({
			managedSessionService,
		}),
	});
	registerTriggerRoutes(app, {
		triggerService,
		authorizationGuard,
	});
};

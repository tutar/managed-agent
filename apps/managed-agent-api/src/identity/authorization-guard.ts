import type { FastifyRequest } from "fastify";

import { NotFoundError } from "../channel/web-api/errors/http-errors.js";
import type { SessionRecord } from "../control-plane/session/repositories/session-repository.js";
import type { AuthenticatedUser } from "./auth-service.js";

export type AuthorizationGuard = {
	getLoginSessionId(request: FastifyRequest): string | null;
	requireCurrentUser(request: FastifyRequest): Promise<AuthenticatedUser>;
	requireOwnedSession(
		request: FastifyRequest,
		sessionId: string,
	): Promise<{ currentUser: AuthenticatedUser; session: SessionRecord }>;
};

/**
 * Authorization helpers for request-scoped ownership checks.
 *
 * This guard keeps cookie extraction and owner-only resource visibility out of
 * individual route handlers so the transport layer stays consistent.
 */
export const createAuthorizationGuard = ({
	currentUserResolver,
	sessionCookieManager,
	managedSessionService,
}: {
	currentUserResolver: {
		requireUser(loginSessionId: string | null): Promise<AuthenticatedUser>;
	};
	sessionCookieManager: {
		readCookieValue(request: FastifyRequest): string | null;
	};
	managedSessionService: {
		getSession(sessionId: string): Promise<SessionRecord | null>;
	};
}): AuthorizationGuard => {
	return {
		getLoginSessionId(request: FastifyRequest) {
			return sessionCookieManager.readCookieValue(request);
		},
		async requireCurrentUser(request: FastifyRequest) {
			return currentUserResolver.requireUser(this.getLoginSessionId(request));
		},
		async requireOwnedSession(request: FastifyRequest, sessionId: string) {
			const currentUser = await this.requireCurrentUser(request);
			const session = await managedSessionService.getSession(sessionId);

			if (!session || session.userId !== currentUser.userId) {
				throw new NotFoundError(`session ${sessionId} not found`);
			}

			return {
				currentUser,
				session,
			};
		},
	};
};

import { UnauthorizedError } from "../channel/web-api/errors/http-errors.js";
import type { AuthenticatedUser } from "./auth-service.js";

/**
 * Resolve the current authenticated user from a login-session id.
 *
 * Fastify routes own cookie extraction. This resolver stays focused on the
 * bridge from login-session state into the control-plane's `userId` context.
 */
export const createCurrentUserResolver = ({
	authService,
}: {
	authService: {
		getCurrentUser(loginSessionId: string): Promise<AuthenticatedUser | null>;
	};
}) => {
	return {
		async resolve(loginSessionId: string | null) {
			if (!loginSessionId) {
				return null;
			}

			return authService.getCurrentUser(loginSessionId);
		},
		async requireUser(loginSessionId: string | null) {
			const user = await this.resolve(loginSessionId);

			if (!user) {
				throw new UnauthorizedError("authentication required");
			}

			return user;
		},
	};
};

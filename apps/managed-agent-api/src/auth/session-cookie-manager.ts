import type { FastifyReply, FastifyRequest } from "fastify";

const COOKIE_NAME = "managed_agent_session";
const THIRTY_DAYS_IN_SECONDS = 60 * 60 * 24 * 30;

/**
 * Cookie helpers for the managed-agent login session.
 *
 * Fastify owns cookie serialization through the official plugin, while this
 * helper keeps the cookie naming and lifetime policy centralized.
 */
export const createSessionCookieManager = () => {
	const sharedCookieOptions = {
		path: "/",
		httpOnly: true,
		sameSite: "lax" as const,
	};

	return {
		cookieName: COOKIE_NAME,
		readCookieValue(request: FastifyRequest) {
			const cookieValue = request.cookies[COOKIE_NAME];
			return typeof cookieValue === "string" && cookieValue.length > 0 ? cookieValue : null;
		},
		setLoginSessionCookie(reply: FastifyReply, loginSessionId: string) {
			reply.setCookie(COOKIE_NAME, loginSessionId, {
				...sharedCookieOptions,
				maxAge: THIRTY_DAYS_IN_SECONDS,
			});
		},
		clearLoginSessionCookie(reply: FastifyReply) {
			reply.clearCookie(COOKIE_NAME, sharedCookieOptions);
		},
	};
};

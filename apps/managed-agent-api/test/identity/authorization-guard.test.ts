/**
 * Authorization guard tests for owner-only session access.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { FastifyRequest } from "fastify";

import { createAuthorizationGuard } from "../../src/identity/authorization-guard.js";
import type { SessionRecord } from "../../src/control-plane/session/repositories/session-repository.js";

const createRequestStub = (cookieValue: string | null) => {
	return {
		cookies: cookieValue ? { managed_agent_session: cookieValue } : {},
	} as unknown as FastifyRequest;
};

const SESSION_RECORD: SessionRecord = {
	sessionId: "sess_1",
	userId: "user_1",
	sessionName: "session",
	status: "idle",
	model: "managed-agent-local",
	thinkingLevel: "medium",
	createdAt: "2026-05-19T00:00:00.000Z",
	updatedAt: "2026-05-19T00:00:00.000Z",
	entries: [],
};

test("authorization guard resolves the current user from the session cookie", async () => {
	const guard = createAuthorizationGuard({
		currentUserResolver: {
			async requireUser(loginSessionId) {
				assert.equal(loginSessionId, "login_1");
				return {
					userId: "user_1",
					username: "agentos",
					status: "active" as const,
					createdAt: "2026-05-19T00:00:00.000Z",
					lastLoginAt: "2026-05-19T00:00:00.000Z",
				};
			},
		},
		sessionCookieManager: {
			readCookieValue(request) {
				return request.cookies.managed_agent_session ?? null;
			},
		},
		managedSessionService: {
			async getSession() {
				return SESSION_RECORD;
			},
		},
	});

	const result = await guard.requireOwnedSession(createRequestStub("login_1"), "sess_1");
	assert.equal(result.currentUser.userId, "user_1");
	assert.equal(result.session.sessionId, "sess_1");
});

test("authorization guard hides missing and foreign sessions behind not found", async () => {
	const guard = createAuthorizationGuard({
		currentUserResolver: {
			async requireUser() {
				return {
					userId: "user_1",
					username: "agentos",
					status: "active" as const,
					createdAt: "2026-05-19T00:00:00.000Z",
					lastLoginAt: "2026-05-19T00:00:00.000Z",
				};
			},
		},
		sessionCookieManager: {
			readCookieValue() {
				return "login_1";
			},
		},
		managedSessionService: {
			async getSession(sessionId) {
				if (sessionId === "sess_missing") {
					return null;
				}

				return {
					...SESSION_RECORD,
					userId: "user_2",
				};
			},
		},
	});

	await assert.rejects(
		() => guard.requireOwnedSession(createRequestStub("login_1"), "sess_missing"),
		/not found/,
	);
	await assert.rejects(
		() => guard.requireOwnedSession(createRequestStub("login_1"), "sess_foreign"),
		/not found/,
	);
});

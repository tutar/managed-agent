/**
 * Identity service tests for local username/password auth.
 *
 * These tests keep the auth domain isolated from the transport layer so login
 * session issuance, expiry, and duplicate-account handling stay covered
 * without going through Fastify routes.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createAuthService } from "../../src/identity/auth-service.js";
import type {
	AuthRepository,
	AuthSessionRecord,
	LoginSessionRecord,
	UserRecord,
} from "../../src/identity/repositories/auth-repository.js";

const createInMemoryAuthRepository = (): AuthRepository & {
	loginSessions: Map<string, LoginSessionRecord>;
	users: Map<string, UserRecord>;
} => {
	const users = new Map<string, UserRecord>();
	const usersByUsername = new Map<string, UserRecord>();
	const loginSessions = new Map<string, LoginSessionRecord>();

	return {
		users,
		loginSessions,
		async createUser(user) {
			users.set(user.userId, user);
			usersByUsername.set(user.username, user);
		},
		async getUserByUsername(username) {
			return usersByUsername.get(username) ?? null;
		},
		async getUserById(userId) {
			return users.get(userId) ?? null;
		},
		async updateUserLastLogin({ userId, lastLoginAt }) {
			const user = users.get(userId);

			if (!user) {
				return;
			}

			const updatedUser = {
				...user,
				lastLoginAt,
			};

			users.set(userId, updatedUser);
			usersByUsername.set(updatedUser.username, updatedUser);
		},
		async createLoginSession(session) {
			loginSessions.set(session.loginSessionId, session);
		},
		async getLoginSession(loginSessionId) {
			const session = loginSessions.get(loginSessionId);

			if (!session) {
				return null;
			}

			const user = users.get(session.userId);

			if (!user) {
				return null;
			}

			return {
				loginSessionId: session.loginSessionId,
				userId: session.userId,
				username: user.username,
				status: session.status,
				createdAt: session.createdAt,
				expiresAt: session.expiresAt,
				lastSeenAt: session.lastSeenAt,
			} satisfies AuthSessionRecord;
		},
		async touchLoginSession({ loginSessionId, lastSeenAt }) {
			const session = loginSessions.get(loginSessionId);

			if (!session || session.status !== "active") {
				return;
			}

			loginSessions.set(loginSessionId, {
				...session,
				lastSeenAt,
			});
		},
		async revokeLoginSession(loginSessionId) {
			const session = loginSessions.get(loginSessionId);

			if (!session) {
				return;
			}

			loginSessions.set(loginSessionId, {
				...session,
				status: "revoked",
			});
		},
	};
};

test("auth service registers a user and issues a login session", async () => {
	const authRepository = createInMemoryAuthRepository();
	const authService = createAuthService({ authRepository });

	const result = await authService.register({
		username: "agentos",
		password: "agentos",
	});

	assert.equal(result.user.username, "agentos");
	assert.match(result.loginSessionId, /^login_/);

	const storedSession = authRepository.loginSessions.get(result.loginSessionId);
	assert.ok(storedSession);
	assert.equal(storedSession.userId, result.user.userId);
	assert.equal(storedSession.status, "active");
});

test("auth service rejects duplicate usernames", async () => {
	const authRepository = createInMemoryAuthRepository();
	const authService = createAuthService({ authRepository });

	await authService.register({
		username: "agentos",
		password: "agentos",
	});

	await assert.rejects(
		() =>
			authService.register({
				username: "agentos",
				password: "agentos-2",
			}),
		(error: unknown) => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /already exists/);
			return true;
		},
	);
});

test("auth service logs in an existing user and refreshes lastLoginAt", async () => {
	const authRepository = createInMemoryAuthRepository();
	const authService = createAuthService({ authRepository });

	const registered = await authService.register({
		username: "agentos",
		password: "agentos",
	});

	const result = await authService.login({
		username: "agentos",
		password: "agentos",
	});

	assert.equal(result.user.userId, registered.user.userId);
	assert.match(result.loginSessionId, /^login_/);
	assert.ok(result.user.lastLoginAt);
});

test("auth service resolves active sessions and revokes expired ones", async () => {
	const authRepository = createInMemoryAuthRepository();
	const authService = createAuthService({ authRepository });

	const registered = await authService.register({
		username: "agentos",
		password: "agentos",
	});

	const activeUser = await authService.getCurrentUser(registered.loginSessionId);
	assert.equal(activeUser?.username, "agentos");

	const activeSession = authRepository.loginSessions.get(registered.loginSessionId);
	assert.ok(activeSession);
	authRepository.loginSessions.set(registered.loginSessionId, {
		...activeSession,
		expiresAt: "2000-01-01T00:00:00.000Z",
	});

	const expiredUser = await authService.getCurrentUser(registered.loginSessionId);
	assert.equal(expiredUser, null);
	assert.equal(authRepository.loginSessions.get(registered.loginSessionId)?.status, "revoked");
});

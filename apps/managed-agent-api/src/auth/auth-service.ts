import { randomUUID } from "node:crypto";

import { ConflictError, UnauthorizedError } from "../api-channel/http-errors.js";
import { hashPassword, verifyPassword } from "./password-hasher.js";
import type { AuthRepository, AuthSessionRecord, UserRecord } from "./postgres-auth-repository.js";

const LOGIN_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export type AuthenticatedUser = {
	userId: string;
	username: string;
	status: "active";
	createdAt: string;
	lastLoginAt: string | null;
};

/**
 * Auth orchestration for local username/password login.
 *
 * This service deliberately manages only account and login-session state. It
 * must not leak managed agent session semantics into the auth domain.
 */
export const createAuthService = ({ authRepository }: { authRepository: AuthRepository }) => {
	const toAuthenticatedUser = (user: UserRecord): AuthenticatedUser => {
		return {
			userId: user.userId,
			username: user.username,
			status: user.status,
			createdAt: user.createdAt,
			lastLoginAt: user.lastLoginAt,
		};
	};

	const issueLoginSession = async ({ userId, now }: { userId: string; now: string }) => {
		const loginSessionId = `login_${randomUUID()}`;

		await authRepository.createLoginSession({
			loginSessionId,
			userId,
			status: "active",
			createdAt: now,
			expiresAt: new Date(Date.parse(now) + LOGIN_SESSION_TTL_MS).toISOString(),
			lastSeenAt: now,
		});

		return loginSessionId;
	};

	const getAuthenticatedUserFromSession = async ({ session, now }: { session: AuthSessionRecord; now: string }) => {
		if (session.status !== "active" || Date.parse(session.expiresAt) <= Date.parse(now)) {
			await authRepository.revokeLoginSession(session.loginSessionId);
			return null;
		}

		await authRepository.touchLoginSession({
			loginSessionId: session.loginSessionId,
			lastSeenAt: now,
		});

		const user = await authRepository.getUserById(session.userId);

		if (!user || user.status !== "active") {
			return null;
		}

		return toAuthenticatedUser(user);
	};

	return {
		async register({ username, password }: { username: string; password: string }) {
			const existingUser = await authRepository.getUserByUsername(username);

			if (existingUser) {
				throw new ConflictError(`username ${username} already exists`, "username_conflict");
			}

			const createdAt = new Date().toISOString();
			const user: UserRecord = {
				userId: `user_${randomUUID()}`,
				username,
				passwordHash: await hashPassword(password),
				status: "active",
				createdAt,
				lastLoginAt: createdAt,
			};

			await authRepository.createUser(user);
			await authRepository.updateUserLastLogin({
				userId: user.userId,
				lastLoginAt: createdAt,
			});

			return {
				user: toAuthenticatedUser(user),
				loginSessionId: await issueLoginSession({
					userId: user.userId,
					now: createdAt,
				}),
			};
		},
		async login({ username, password }: { username: string; password: string }) {
			const user = await authRepository.getUserByUsername(username);

			if (
				!user ||
				user.status !== "active" ||
				!(await verifyPassword({
					password,
					passwordHash: user.passwordHash,
				}))
			) {
				throw new UnauthorizedError("invalid username or password");
			}

			const now = new Date().toISOString();
			await authRepository.updateUserLastLogin({
				userId: user.userId,
				lastLoginAt: now,
			});

			return {
				user: {
					...toAuthenticatedUser(user),
					lastLoginAt: now,
				},
				loginSessionId: await issueLoginSession({
					userId: user.userId,
					now,
				}),
			};
		},
		async logout(loginSessionId: string) {
			await authRepository.revokeLoginSession(loginSessionId);
		},
		async getCurrentUser(loginSessionId: string) {
			const session = await authRepository.getLoginSession(loginSessionId);

			if (!session) {
				return null;
			}

			return getAuthenticatedUserFromSession({
				session,
				now: new Date().toISOString(),
			});
		},
		async requireCurrentUser(loginSessionId: string) {
			const user = await this.getCurrentUser(loginSessionId);

			if (!user) {
				throw new UnauthorizedError("authentication required");
			}

			return user;
		},
		async ensureDevelopmentUser({ username, password }: { username: string; password: string }) {
			const existingUser = await authRepository.getUserByUsername(username);

			if (existingUser) {
				return toAuthenticatedUser(existingUser);
			}

			const now = new Date().toISOString();
			const user: UserRecord = {
				userId: `user_${randomUUID()}`,
				username,
				passwordHash: await hashPassword(password),
				status: "active",
				createdAt: now,
				lastLoginAt: null,
			};

			await authRepository.createUser(user);
			return toAuthenticatedUser(user);
		},
	};
};

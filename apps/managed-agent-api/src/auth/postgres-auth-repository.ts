import { and, eq } from "drizzle-orm";

import type { ManagedAgentDatabase } from "../control-plane/repositories/postgres-database.js";
import { loginSessionsTable, usersTable } from "../control-plane/repositories/postgres-schema.js";

/**
 * Durable auth records stored alongside the rest of the managed metadata.
 *
 * Auth stays inside managed-agent-api, but it uses its own tables so login
 * session lifecycle never gets conflated with agent session lifecycle.
 */
export type UserRecord = {
	userId: string;
	username: string;
	passwordHash: string;
	status: "active";
	createdAt: string;
	lastLoginAt: string | null;
};

export type LoginSessionRecord = {
	loginSessionId: string;
	userId: string;
	status: "active" | "revoked";
	createdAt: string;
	expiresAt: string;
	lastSeenAt: string;
};

export type AuthSessionRecord = {
	loginSessionId: string;
	userId: string;
	username: string;
	status: "active" | "revoked";
	createdAt: string;
	expiresAt: string;
	lastSeenAt: string;
};

export interface AuthRepository {
	createUser(user: UserRecord): Promise<void>;
	getUserByUsername(username: string): Promise<UserRecord | null>;
	getUserById(userId: string): Promise<UserRecord | null>;
	updateUserLastLogin(input: { userId: string; lastLoginAt: string }): Promise<void>;
	createLoginSession(session: LoginSessionRecord): Promise<void>;
	getLoginSession(loginSessionId: string): Promise<AuthSessionRecord | null>;
	touchLoginSession(input: { loginSessionId: string; lastSeenAt: string }): Promise<void>;
	revokeLoginSession(loginSessionId: string): Promise<void>;
}

/**
 * PostgreSQL-backed auth repository.
 *
 * User records and login sessions live in the same durable store as session
 * metadata so request authentication can remain local to managed-agent-api.
 */
export const createPostgresAuthRepository = ({ db }: { db: ManagedAgentDatabase }): AuthRepository => {
	return {
		async createUser(user) {
			await db.insert(usersTable).values({
				userId: user.userId,
				username: user.username,
				passwordHash: user.passwordHash,
				status: user.status,
				createdAt: user.createdAt,
				lastLoginAt: user.lastLoginAt,
			});
		},
		async getUserByUsername(username) {
			const row = await db.query.usersTable.findFirst({
				where: eq(usersTable.username, username),
			});

			if (!row) {
				return null;
			}

			return {
				userId: row.userId,
				username: row.username,
				passwordHash: row.passwordHash,
				status: row.status as UserRecord["status"],
				createdAt: row.createdAt,
				lastLoginAt: row.lastLoginAt,
			};
		},
		async getUserById(userId) {
			const row = await db.query.usersTable.findFirst({
				where: eq(usersTable.userId, userId),
			});

			if (!row) {
				return null;
			}

			return {
				userId: row.userId,
				username: row.username,
				passwordHash: row.passwordHash,
				status: row.status as UserRecord["status"],
				createdAt: row.createdAt,
				lastLoginAt: row.lastLoginAt,
			};
		},
		async updateUserLastLogin({ userId, lastLoginAt }) {
			await db.update(usersTable).set({ lastLoginAt }).where(eq(usersTable.userId, userId));
		},
		async createLoginSession(session) {
			await db.insert(loginSessionsTable).values({
				loginSessionId: session.loginSessionId,
				userId: session.userId,
				status: session.status,
				createdAt: session.createdAt,
				expiresAt: session.expiresAt,
				lastSeenAt: session.lastSeenAt,
			});
		},
		async getLoginSession(loginSessionId) {
			const row = await db
				.select({
					loginSessionId: loginSessionsTable.loginSessionId,
					userId: loginSessionsTable.userId,
					username: usersTable.username,
					status: loginSessionsTable.status,
					createdAt: loginSessionsTable.createdAt,
					expiresAt: loginSessionsTable.expiresAt,
					lastSeenAt: loginSessionsTable.lastSeenAt,
				})
				.from(loginSessionsTable)
				.innerJoin(usersTable, eq(usersTable.userId, loginSessionsTable.userId))
				.where(eq(loginSessionsTable.loginSessionId, loginSessionId))
				.then((rows) => rows[0] ?? null);

			if (!row) {
				return null;
			}

			return {
				loginSessionId: row.loginSessionId,
				userId: row.userId,
				username: row.username,
				status: row.status as AuthSessionRecord["status"],
				createdAt: row.createdAt,
				expiresAt: row.expiresAt,
				lastSeenAt: row.lastSeenAt,
			};
		},
		async touchLoginSession({ loginSessionId, lastSeenAt }) {
			await db
				.update(loginSessionsTable)
				.set({ lastSeenAt })
				.where(and(eq(loginSessionsTable.loginSessionId, loginSessionId), eq(loginSessionsTable.status, "active")));
		},
		async revokeLoginSession(loginSessionId) {
			await db
				.update(loginSessionsTable)
				.set({ status: "revoked" })
				.where(eq(loginSessionsTable.loginSessionId, loginSessionId));
		},
	};
};

/**
 * Durable auth repository contracts.
 *
 * Login-session persistence belongs to the identity layer and must stay
 * separate from managed agent session metadata.
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

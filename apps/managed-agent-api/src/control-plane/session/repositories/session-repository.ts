import type { SessionEntry } from "../entry-factory.js";

export type SessionStatus = "idle" | "running" | "error";

/**
 * Session repository contracts for the control plane.
 *
 * The repository interface isolates durable-session concerns from the
 * orchestration layer so metadata and transcript read paths can evolve without
 * changing control-plane behavior.
 */
export type SessionRecord = {
	sessionId: string;
	userId: string;
	sessionName: string;
	status: SessionStatus;
	model: string;
	thinkingLevel: string;
	providerConfigId?: string;
	providerType?: string;
	piSessionFile?: string;
	createdAt: string;
	updatedAt: string;
	archivedAt?: string;
	entries: SessionEntry[];
};

export type SessionListItemRecord = {
	sessionId: string;
	sessionName: string;
	lastActiveAt: string;
};

export type ListUserSessionsOptions = {
	limit?: number;
	cursor?: string;
};

export type UserSessionsPageRecord = {
	items: SessionListItemRecord[];
	nextCursor: string | null;
	hasMore: boolean;
};

export interface SessionRepository {
	createSession(session: SessionRecord): Promise<void>;
	getSession(sessionId: string): Promise<SessionRecord | null>;
	updateSession(session: SessionRecord): Promise<void>;
	listUserSessions(userId: string, options?: ListUserSessionsOptions): Promise<UserSessionsPageRecord>;
}

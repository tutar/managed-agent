import type { SessionListItemRecord } from "./session-repository.js"

/**
 * Recent-session projection contracts.
 *
 * This repository isolates user-facing recency lookups from the underlying
 * session aggregate storage.
 */
export interface UserSessionProjectionRepository {
  createUserSessionProjection(
    userId: string,
    record: SessionListItemRecord,
  ): Promise<void>
  updateUserSessionProjection(
    userId: string,
    record: SessionListItemRecord,
  ): Promise<void>
  deleteUserSessionProjection(userId: string, sessionId: string): Promise<void>
  listUserSessions(userId: string): Promise<SessionListItemRecord[]>
}

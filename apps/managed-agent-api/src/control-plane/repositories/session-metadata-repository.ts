import type { SessionStatus } from "./session-repository.js"

/**
 * Session metadata persistence contracts.
 *
 * This repository owns stable session attributes and execution metadata, but
 * not transcript entries or recent-session projections.
 */
export type SessionMetadataRecord = {
  sessionId: string
  userId: string
  sessionName: string
  status: SessionStatus
  model: string
  thinkingLevel: string
  piSessionFile?: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export interface SessionMetadataRepository {
  createSessionMetadata(record: SessionMetadataRecord): Promise<void>
  getSessionMetadata(sessionId: string): Promise<SessionMetadataRecord | null>
  updateSessionMetadata(record: SessionMetadataRecord): Promise<void>
}

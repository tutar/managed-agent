/**
 * Audit persistence contracts for the control plane.
 *
 * Keeping audit records behind a dedicated repository lets the API service
 * evolve metadata storage without coupling orchestration code to a specific
 * file or database layout.
 */
export type PersistedAuditRecord = {
  action: string
  sessionId: string
  userId: string
  recordedAt: string
}

export interface AuditRepository {
  append(record: PersistedAuditRecord): Promise<void>
  list(): Promise<PersistedAuditRecord[]>
}

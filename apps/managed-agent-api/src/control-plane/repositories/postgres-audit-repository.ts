import { asc } from "drizzle-orm"

import type {
  AuditRepository,
  PersistedAuditRecord,
} from "./audit-repository.js"
import type { ManagedAgentDatabase } from "./postgres-database.js"
import { auditRecordsTable } from "./postgres-schema.js"

const normalizeUserId = (userId: string) => {
  const trimmedUserId = userId.trim()

  if (
    trimmedUserId.startsWith('"') &&
    trimmedUserId.endsWith('"') &&
    trimmedUserId.length >= 2
  ) {
    return trimmedUserId.slice(1, -1)
  }

  return trimmedUserId
}

/**
 * PostgreSQL-backed audit repository.
 */
export const createPostgresAuditRepository = ({
  db,
}: {
  db: ManagedAgentDatabase
}): AuditRepository => {
  return {
    async append(record: PersistedAuditRecord) {
      await db.insert(auditRecordsTable).values({
        action: record.action,
        sessionId: record.sessionId,
        userId: normalizeUserId(record.userId),
        recordedAt: record.recordedAt,
      })
    },
    async list() {
      const rows = await db
        .select({
          action: auditRecordsTable.action,
          sessionId: auditRecordsTable.sessionId,
          userId: auditRecordsTable.userId,
          recordedAt: auditRecordsTable.recordedAt,
        })
        .from(auditRecordsTable)
        .orderBy(asc(auditRecordsTable.id))

      return rows
    },
  }
}

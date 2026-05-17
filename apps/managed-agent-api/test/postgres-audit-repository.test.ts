/**
 * Durable repository tests for the PostgreSQL-backed audit repository.
 */
import assert from "node:assert/strict"
import test from "node:test"

import { createPostgresAuditRepository } from "../src/control-plane/repositories/postgres-audit-repository.js"
import { createTestManagedAgentDatabase } from "./test-support/create-test-database.js"

test("postgres audit repository persists and lists audit records", async () => {
  const database = await createTestManagedAgentDatabase()
  const repository = createPostgresAuditRepository({
    db: database.db,
  })

  try {
    await repository.append({
      action: "session.created",
      sessionId: "sess_audit",
      userId: '"demo-user"',
      recordedAt: "2026-05-15T00:00:00.000Z",
    })

    const records = await repository.list()

    assert.deepEqual(records, [
      {
        action: "session.created",
        sessionId: "sess_audit",
        userId: "demo-user",
        recordedAt: "2026-05-15T00:00:00.000Z",
      },
    ])
  } finally {
    await database.client.close()
  }
})

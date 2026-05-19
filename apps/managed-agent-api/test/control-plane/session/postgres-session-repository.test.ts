/**
 * Durable repository tests for the PostgreSQL-backed session repository.
 */
import assert from "node:assert/strict"
import test from "node:test"

import {
  createAssistantEntry,
  createProcessEntry,
  createUserEntry,
} from "../../../src/control-plane/session/entry-factory.js"
import { createPiFileTranscriptReader } from "../../../src/control-plane/session/pi-file-transcript-reader.js"
import { createPostgresSessionRepository } from "../../../src/control-plane/session/repositories/postgres-session-repository.js"
import type { SessionRecord } from "../../../src/control-plane/session/repositories/session-repository.js"
import { createTestManagedAgentDatabase } from "../../test-support/create-test-database.js"
import { writeManagedTranscriptFixture } from "../../test-support/managed-transcript-fixture.js"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const createSessionRecord = (): SessionRecord => {
  const userEntry = createUserEntry(
    {
      content: [{ type: "text", text: "持久化测试" }],
    },
    null,
    "2026-05-15T00:00:00.000Z",
  )
  const processEntry = createProcessEntry(userEntry.id, [], userEntry.createdAt)
  const assistantEntry = createAssistantEntry(
    processEntry.id,
    "已完成",
    undefined,
    userEntry.createdAt,
  )

  return {
    sessionId: "sess_persisted",
    userId: "demo-user",
    sessionName: "持久化测试",
    status: "idle",
    model: "managed-agent-local",
    thinkingLevel: "medium",
    piSessionFile: "test-sessions/sess_persisted.jsonl",
    createdAt: "2026-05-15T00:00:00.000Z",
    updatedAt: "2026-05-15T00:00:00.000Z",
    entries: [userEntry, processEntry, assistantEntry],
  }
}

test("postgres session repository persists sessions and projections", async () => {
  const database = await createTestManagedAgentDatabase()
  const transcriptsRoot = mkdtempSync(join(tmpdir(), "managed-agent-transcripts-"))
  const session = createSessionRecord()
  const repository = createPostgresSessionRepository({
    db: database.db,
    transcriptReader: createPiFileTranscriptReader({ transcriptsRoot }),
  })

  try {
    await writeManagedTranscriptFixture({
      transcriptsRoot,
      relativePath: session.piSessionFile!,
      sessionId: session.sessionId,
      entries: session.entries,
    })
    await repository.createSession(session)

    const storedSession = await repository.getSession(session.sessionId)
    const userSessionsPage = await repository.listUserSessions(session.userId)

    assert.deepEqual(storedSession, session)
    assert.equal(userSessionsPage.items.length, 1)
    assert.equal(userSessionsPage.items[0]?.sessionId, session.sessionId)
    assert.equal(userSessionsPage.nextCursor, null)
    assert.equal(userSessionsPage.hasMore, false)
  } finally {
    await database.client.close()
  }
})

test("postgres session repository updates recent-session projection ordering", async () => {
  const database = await createTestManagedAgentDatabase()
  const transcriptsRoot = mkdtempSync(join(tmpdir(), "managed-agent-transcripts-"))
  const repository = createPostgresSessionRepository({
    db: database.db,
    transcriptReader: createPiFileTranscriptReader({ transcriptsRoot }),
  })
  const firstSession = createSessionRecord()
  const secondSession: SessionRecord = {
    ...createSessionRecord(),
    sessionId: "sess_second",
    piSessionFile: "test-sessions/sess_second.jsonl",
    sessionName: "第二个会话",
    createdAt: "2026-05-15T00:00:01.000Z",
    updatedAt: "2026-05-15T00:00:01.000Z",
  }

  try {
    await writeManagedTranscriptFixture({
      transcriptsRoot,
      relativePath: firstSession.piSessionFile!,
      sessionId: firstSession.sessionId,
      entries: firstSession.entries,
    })
    await writeManagedTranscriptFixture({
      transcriptsRoot,
      relativePath: secondSession.piSessionFile!,
      sessionId: secondSession.sessionId,
      entries: secondSession.entries,
    })
    await repository.createSession(firstSession)
    await repository.createSession(secondSession)
    await repository.updateSession({
      ...firstSession,
      updatedAt: "2026-05-15T00:00:02.000Z",
    })

    const userSessions = await repository.listUserSessions(firstSession.userId)

    assert.deepEqual(
      userSessions.items.map((item) => item.sessionId),
      ["sess_persisted", "sess_second"],
    )
  } finally {
    await database.client.close()
  }
})

test("postgres session repository paginates recent sessions and normalizes quoted userIds", async () => {
  const database = await createTestManagedAgentDatabase()
  const transcriptsRoot = mkdtempSync(join(tmpdir(), "managed-agent-transcripts-"))
  const repository = createPostgresSessionRepository({
    db: database.db,
    transcriptReader: createPiFileTranscriptReader({ transcriptsRoot }),
  })

  try {
    for (const [index, sessionName] of ["会话一", "会话二", "会话三"].entries()) {
      const session = {
        ...createSessionRecord(),
        sessionId: `sess_${index + 1}`,
        piSessionFile: `test-sessions/sess_${index + 1}.jsonl`,
        userId: '"demo-user"',
        sessionName,
        createdAt: `2026-05-15T00:00:0${index}.000Z`,
        updatedAt: `2026-05-15T00:00:0${index}.000Z`,
      }

      await writeManagedTranscriptFixture({
        transcriptsRoot,
        relativePath: session.piSessionFile,
        sessionId: session.sessionId,
        entries: session.entries,
      })
      await repository.createSession(session)
    }

    const firstPage = await repository.listUserSessions("demo-user", {
      limit: 2,
    })
    const secondPage = await repository.listUserSessions("demo-user", {
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    })

    assert.equal(firstPage.items.length, 2)
    assert.equal(firstPage.hasMore, true)
    assert.ok(firstPage.nextCursor)
    assert.equal(secondPage.items.length, 1)
    assert.equal(secondPage.items[0]?.sessionName, "会话一")
    assert.equal(secondPage.nextCursor, null)
    assert.equal(secondPage.hasMore, false)
  } finally {
    await database.client.close()
  }
})

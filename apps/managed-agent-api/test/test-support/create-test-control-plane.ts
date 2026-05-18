/**
 * Shared API test harness backed by PostgreSQL repositories and transcript
 * fixtures.
 */
import { mkdtempSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import type { IncomingMessage, ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { SessionExecutor } from "../../../harness-worker/src/jobs/session-run-job.js"
import { createMockSessionExecutor } from "../../../harness-worker/src/runtime/mock-session-executor.js"
import { createMockTranscriptStore } from "../../../harness-worker/src/runtime/mock-transcript-store.js"
import { createLocalHarnessWorkerGateway } from "../../../harness-worker/src/session-worker-gateway.js"
import { createApiApp } from "../../src/app/create-app.js"
import { createAuditService } from "../../src/control-plane/audit/audit-service.js"
import { createActiveSessionRegistry } from "../../src/control-plane/session/active-session-registry.js"
import {
  createAssistantEntry,
  createProcessEntry,
  type DemoContentItem,
} from "../../src/control-plane/session/entry-factory.js"
import { createEventPublisher } from "../../src/control-plane/session/event-publisher.js"
import { createManagedSessionService } from "../../src/control-plane/session/managed-session-service.js"
import { createPiFileTranscriptReader } from "../../src/control-plane/session/pi-file-transcript-reader.js"
import { createPostgresSessionRepository } from "../../src/control-plane/session/repositories/postgres-session-repository.js"
import { createTriggerService } from "../../src/control-plane/trigger/trigger-service.js"
import { createPostgresAuditRepository } from "../../src/control-plane/audit/repositories/postgres-audit-repository.js"
import { createAuthorizationGuard } from "../../src/identity/authorization-guard.js"
import { createAuthService } from "../../src/identity/auth-service.js"
import { createCurrentUserResolver } from "../../src/identity/identity-resolver.js"
import { createPostgresAuthRepository } from "../../src/identity/repositories/postgres-auth-repository.js"
import { createSessionCookieManager } from "../../src/identity/session-cookie-manager.js"
import { createTestManagedAgentDatabase } from "./create-test-database.js"
import { writeManagedTranscriptFixture } from "./managed-transcript-fixture.js"

export const createResponseStub = () => {
  return {
    writeHead: () => undefined,
    write: (_chunk: string) => true,
    end: () => undefined,
    get headersSent() {
      return false
    },
  } as unknown as ServerResponse<IncomingMessage>
}

/**
 * Build a transcript-backed executor for custom service and HTTP tests.
 *
 * The helper yields the requested worker events and then persists the durable
 * transcript fixture that `GET /sessions/{id}` must later read.
 */
export const createTranscriptBackedExecutor = ({
  transcriptsRoot,
  processContent = [],
  assistantText = "",
  streamedAssistantChunks = assistantText.length > 0 ? [assistantText] : [],
  additionalEvents = [],
  completionPiSessionFile,
}: {
  transcriptsRoot: string
  processContent?: DemoContentItem[]
  assistantText?: string
  streamedAssistantChunks?: string[]
  additionalEvents?: Array<
    | {
        type: "process.delta"
        data: { text: string }
      }
    | {
        type: "action.started" | "action.completed" | "action.failed"
        data: {
          toolCallId: string
          name: string
          arguments?: string
          result?: string
          error?: string
        }
      }
  >
  completionPiSessionFile?: string
}): SessionExecutor => {
  return {
    async *run(job) {
      for (const event of additionalEvents) {
        if (event.type === "process.delta") {
          yield {
            type: "process.delta",
            data: {
              sessionId: job.sessionId,
              entryId: job.processEntryId,
              parentId: job.userEntry.id,
              text: event.data.text,
            },
          }
          continue
        }

        yield {
          type: event.type,
          data: {
            sessionId: job.sessionId,
            entryId: job.processEntryId,
            parentId: job.userEntry.id,
            ...event.data,
          },
        }
      }

      for (const chunk of streamedAssistantChunks) {
        yield {
          type: "final.output.delta",
          data: {
            sessionId: job.sessionId,
            entryId: job.finalEntryId,
            parentId: job.processEntryId,
            text: chunk,
          },
        }
      }

      yield {
        type: "final.output.completed",
        data: {
          sessionId: job.sessionId,
          entryId: job.finalEntryId,
        },
      }

      const processEntry = createProcessEntry(
        job.userEntry.id,
        processContent,
        job.userEntry.createdAt,
      )
      const assistantEntry = createAssistantEntry(
        processEntry.id,
        assistantText,
        job.finalEntryId,
        job.userEntry.createdAt,
      )
      const relativePath =
        completionPiSessionFile ?? join("test-sessions", `${job.sessionId}.jsonl`)

      await writeManagedTranscriptFixture({
        transcriptsRoot,
        relativePath,
        sessionId: job.sessionId,
        entries: [job.userEntry, processEntry, assistantEntry],
      })

      return {
        piSessionFile: relativePath,
      }
    },
  }
}

/**
 * Create a full control-plane test harness backed by PGlite and durable
 * transcript fixtures.
 */
export const createTestControlPlane = async ({
  executor,
  executorFactory,
}: {
  executor?: SessionExecutor
  executorFactory?: (input: { transcriptsRoot: string }) => SessionExecutor
} = {}) => {
  const { db, client } = await createTestManagedAgentDatabase()
  const mountRoot = mkdtempSync(join(tmpdir(), "managed-agent-test-mount-"))
  const transcriptsRoot = join(mountRoot, "transcripts")

  await mkdir(transcriptsRoot, { recursive: true })

  const sessionRepository = createPostgresSessionRepository({
    db,
    transcriptReader: createPiFileTranscriptReader({
      transcriptsRoot,
    }),
  })
  const authRepository = createPostgresAuthRepository({ db })
  const authService = createAuthService({ authRepository })
  await authService.ensureDevelopmentUser({
    username: "agentos",
    password: "agentos",
  })
  const auditRepository = createPostgresAuditRepository({ db })
  const auditService = createAuditService({ auditRepository })
  const eventPublisher = createEventPublisher()
  const activeSessionRegistry = createActiveSessionRegistry()
  const sessionCookieManager = createSessionCookieManager()
  const currentUserResolver = createCurrentUserResolver({
    authService,
  })
  const workerGateway = createLocalHarnessWorkerGateway({
    executor:
      executor ??
      executorFactory?.({ transcriptsRoot }) ??
      createMockSessionExecutor({
        transcriptStore: createMockTranscriptStore({
          transcriptsRoot,
        }),
      }),
  })
  const managedSessionService = createManagedSessionService({
    sessionRepository,
    activeSessionRegistry,
    auditService,
    eventPublisher,
    workerGateway,
  })
  const authorizationGuard = createAuthorizationGuard({
    currentUserResolver,
    sessionCookieManager,
    managedSessionService: {
      getSession: managedSessionService.getSession,
    },
  })

  return {
    db,
    client,
    transcriptsRoot,
    sessionRepository,
    auditRepository,
    auditService,
    managedSessionService,
    triggerService: createTriggerService(),
    async createApp() {
      return createApiApp({
        managedSessionService,
        triggerService: createTriggerService(),
        authService,
        authorizationGuard,
        sessionCookieManager,
      })
    },
    async close() {
      await client.close()
    },
  }
}

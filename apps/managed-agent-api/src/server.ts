import { createServer } from "node:http"

import {
  createLocalHarnessWorkerGateway,
  createRemoteHarnessWorkerGateway,
} from "../../harness-worker/src/session-worker-gateway.js"
import { createHttpHandler } from "./api-channel/http-server.js"
import { createActiveSessionRegistry } from "./control-plane/active-session-registry.js"
import { createAuditRepository } from "./control-plane/audit-repository.js"
import { createAuditService } from "./control-plane/audit-service.js"
import { createEventPublisher } from "./control-plane/event-publisher.js"
import { createManagedSessionService } from "./control-plane/managed-session-service.js"
import { createManagedAgentDatabase } from "./control-plane/repositories/postgres-database.js"
import { createSessionRepository } from "./control-plane/session-repository.js"
import { createTriggerService } from "./control-plane/trigger-service.js"

/**
 * Composition root for the Managed Agent API service.
 *
 * The long-term architecture splits these responsibilities across durable
 * storage, real workers, and sandbox infrastructure. This local entrypoint
 * keeps the framework runnable while already exercising versioned metadata
 * persistence and the selectable worker runtime boundary.
 */
const port = Number(process.env.PORT ?? "3000")
const workerTransport = process.env.MANAGED_AGENT_WORKER_TRANSPORT ?? "http"
const databaseUrl = process.env.MANAGED_AGENT_DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    "MANAGED_AGENT_DATABASE_URL is required for managed-agent-api runtime startup.",
  )
}

const durableDatabase = await createManagedAgentDatabase({
  connectionString: databaseUrl,
})
const sessionRepository = await createSessionRepository({
  db: durableDatabase.db,
})
const auditRepository = await createAuditRepository({
  db: durableDatabase.db,
})
const activeSessionRegistry = createActiveSessionRegistry()
const auditService = createAuditService({ auditRepository })
const eventPublisher = createEventPublisher()
const workerGateway =
  workerTransport === "local"
    ? createLocalHarnessWorkerGateway()
    : createRemoteHarnessWorkerGateway()
const managedSessionService = createManagedSessionService({
  sessionRepository,
  activeSessionRegistry,
  auditService,
  eventPublisher,
  workerGateway,
})
const triggerService = createTriggerService()

const server = createServer(
  createHttpHandler({
    managedSessionService,
    triggerService,
  }),
)

// Keep a single local listener so HTTP and SSE verification stays close to the
// protocol described in the design docs.
server.listen(port, () => {
  process.stdout.write(
    `managed-agent-api listening on http://127.0.0.1:${port}\n`,
  )
})

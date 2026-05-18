import { createApiApp } from "./app/create-app.js";
import { createAuditRepository } from "./control-plane/audit/audit-repository.js";
import { createAuditService } from "./control-plane/audit/audit-service.js";
import { createActiveSessionRegistry } from "./control-plane/session/active-session-registry.js";
import { createEventPublisher } from "./control-plane/session/event-publisher.js";
import { createRemoteHarnessWorkerGateway } from "./control-plane/session/harness-worker-client.js";
import { createManagedSessionService } from "./control-plane/session/managed-session-service.js";
import { createSessionRepository } from "./control-plane/session/session-repository.js";
import { createTriggerService } from "./control-plane/trigger/trigger-service.js";
import { createAuthService } from "./identity/auth-service.js";
import { createAuthorizationGuard } from "./identity/authorization-guard.js";
import { createCurrentUserResolver } from "./identity/identity-resolver.js";
import { createPostgresAuthRepository } from "./identity/repositories/postgres-auth-repository.js";
import { createSessionCookieManager } from "./identity/session-cookie-manager.js";
import { createManagedAgentDatabase } from "./infrastructure/persistence/postgres/database.js";

/**
 * Composition root for the Managed Agent API service.
 *
 * The long-term architecture splits these responsibilities across durable
 * storage, real workers, and sandbox infrastructure. This local entrypoint
 * keeps the framework runnable while already exercising versioned metadata
 * persistence and the selectable worker runtime boundary.
 */
const port = Number(process.env.PORT ?? "4173");
const databaseUrl = process.env.MANAGED_AGENT_DATABASE_URL;

if (!databaseUrl) {
	throw new Error("MANAGED_AGENT_DATABASE_URL is required for managed-agent-api runtime startup.");
}

const durableDatabase = await createManagedAgentDatabase({
	connectionString: databaseUrl,
});
const sessionRepository = await createSessionRepository({
	db: durableDatabase.db,
});
const authRepository = createPostgresAuthRepository({
	db: durableDatabase.db,
});
const auditRepository = await createAuditRepository({
	db: durableDatabase.db,
});
const activeSessionRegistry = createActiveSessionRegistry();
const auditService = createAuditService({ auditRepository });
const eventPublisher = createEventPublisher();
const workerGateway = createRemoteHarnessWorkerGateway();
const authService = createAuthService({
	authRepository,
});
const sessionCookieManager = createSessionCookieManager();
const currentUserResolver = createCurrentUserResolver({
	authService,
});
const managedSessionService = createManagedSessionService({
	sessionRepository,
	activeSessionRegistry,
	auditService,
	eventPublisher,
	workerGateway,
});
const authorizationGuard = createAuthorizationGuard({
	currentUserResolver,
	sessionCookieManager,
	managedSessionService: {
		getSession: managedSessionService.getSession,
	},
});
const triggerService = createTriggerService();
const app = await createApiApp({
	managedSessionService,
	triggerService,
	authService,
	authorizationGuard,
	sessionCookieManager,
});

// Keep a single local listener so HTTP and SSE verification stays close to the
// protocol described in the design docs.
await app.listen({
	port,
	host: "0.0.0.0",
});
process.stdout.write(`managed-agent-api listening on http://127.0.0.1:${port}\n`);

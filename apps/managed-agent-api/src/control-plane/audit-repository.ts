import { createPostgresAuditRepository } from "./repositories/postgres-audit-repository.js";
import type { ManagedAgentDatabase } from "./repositories/postgres-database.js";

/**
 * Build the audit repository used by the local API composition root.
 *
 * The API runtime now requires PostgreSQL so audit and metadata share one
 * durable transactional boundary.
 */
export const createAuditRepository = async ({ db }: { db: ManagedAgentDatabase }) => {
	return createPostgresAuditRepository({ db });
};

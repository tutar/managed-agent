import { createPiFileTranscriptReader } from "./pi-file-transcript-reader.js";
import type { ManagedAgentDatabase } from "./repositories/postgres-database.js";
import { createPostgresSessionRepository } from "./repositories/postgres-session-repository.js";

/**
 * Build the session repository used by the local API composition root.
 *
 * The API runtime now requires PostgreSQL for metadata and recent-session
 * projections while reading transcript truth from shared pi-managed session
 * files.
 */
export const createSessionRepository = async ({ db }: { db: ManagedAgentDatabase }) => {
	return createPostgresSessionRepository({
		db,
		transcriptReader: createPiFileTranscriptReader(),
	});
};

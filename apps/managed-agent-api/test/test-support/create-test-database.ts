/**
 * PGlite-backed durable metadata database for API tests.
 */
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"

import {
  initializeManagedAgentDatabase,
  managedAgentDatabaseSchema,
  type ManagedAgentDatabase,
} from "../../src/infrastructure/persistence/postgres/database.js"

/**
 * Create an isolated PostgreSQL-compatible test database without Docker.
 *
 * Tests use the same Drizzle repository implementations as production while
 * keeping setup fast and local through PGlite.
 */
export const createTestManagedAgentDatabase = async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "managed-agent-pglite-"))
  const client = new PGlite({
    dataDir,
  })

  await initializeManagedAgentDatabase(client)

  return {
    db: drizzle(client, {
      schema: managedAgentDatabaseSchema,
    }) as ManagedAgentDatabase,
    client,
  }
}

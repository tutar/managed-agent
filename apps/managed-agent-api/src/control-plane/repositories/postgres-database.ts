import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { Pool } from "pg";

import {
	auditRecordsTable,
	loginSessionsTable,
	sessionsTable,
	userSessionsTable,
	usersTable,
} from "./postgres-schema.js";

export const managedAgentDatabaseSchema = {
	sessionsTable,
	userSessionsTable,
	auditRecordsTable,
	usersTable,
	loginSessionsTable,
};

export type ManagedAgentDatabase =
	| NodePgDatabase<typeof managedAgentDatabaseSchema>
	| PgliteDatabase<typeof managedAgentDatabaseSchema>;

export const bootstrapManagedAgentDatabaseStatements = [
	`create table if not exists managed_agent_sessions (
    session_id text primary key,
    user_id text not null,
    session_name text not null,
    status text not null,
    model text not null,
    thinking_level text not null,
    pi_session_file text,
    created_at text not null,
    updated_at text not null,
    archived_at text
  )`,
	`create index if not exists managed_agent_sessions_user_lookup_idx
    on managed_agent_sessions (user_id, updated_at)`,
	`create table if not exists managed_agent_user_sessions (
    user_id text not null,
    session_id text not null,
    session_name text not null,
    last_active_at text not null,
    primary key (user_id, session_id)
  )`,
	`create index if not exists managed_agent_user_sessions_user_list_idx
    on managed_agent_user_sessions (user_id, last_active_at, session_id)`,
	`create table if not exists managed_agent_audit_records (
    id bigint generated always as identity primary key,
    action text not null,
    session_id text not null,
    user_id text not null,
    recorded_at text not null
  )`,
	`create index if not exists managed_agent_audit_records_session_idx
    on managed_agent_audit_records (session_id, recorded_at)`,
	`create table if not exists managed_agent_users (
    user_id text primary key,
    username text not null unique,
    password_hash text not null,
    status text not null,
    created_at text not null,
    last_login_at text
  )`,
	`create index if not exists managed_agent_users_username_lookup_idx
    on managed_agent_users (username)`,
	`create table if not exists managed_agent_login_sessions (
    login_session_id text primary key,
    user_id text not null,
    status text not null,
    created_at text not null,
    expires_at text not null,
    last_seen_at text not null
  )`,
	`create index if not exists managed_agent_login_sessions_user_lookup_idx
    on managed_agent_login_sessions (user_id, expires_at)`,
];

type BootstrapClient = {
	query(statement: string): Promise<unknown>;
};

/**
 * Initialize the durable metadata schema for both production PostgreSQL and
 * local PGlite-backed tests.
 */
export const initializeManagedAgentDatabase = async (client: BootstrapClient) => {
	for (const statement of bootstrapManagedAgentDatabaseStatements) {
		await client.query(statement);
	}
};

/**
 * Create and initialize the PostgreSQL client used by durable control-plane
 * repositories.
 */
export const createManagedAgentDatabase = async ({ connectionString }: { connectionString: string }) => {
	const pool = new Pool({ connectionString });

	await initializeManagedAgentDatabase(pool);

	return {
		db: drizzle(pool, {
			schema: managedAgentDatabaseSchema,
		}),
		pool,
	};
};

import { bigint, boolean, index, pgTable, primaryKey, text } from "drizzle-orm/pg-core";

/**
 * PostgreSQL schema for durable control-plane metadata.
 *
 * Transcript content is intentionally excluded here. The platform stores only
 * metadata, projections, and audit in PostgreSQL, while transcript truth stays
 * in pi-managed files.
 */
export const sessionsTable = pgTable(
	"managed_agent_sessions",
	{
		sessionId: text("session_id").primaryKey(),
		userId: text("user_id").notNull(),
		sessionName: text("session_name").notNull(),
		status: text("status").notNull(),
		model: text("model").notNull(),
		thinkingLevel: text("thinking_level").notNull(),
		providerConfigId: text("provider_config_id"),
		providerType: text("provider_type"),
		piSessionFile: text("pi_session_file"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
		archivedAt: text("archived_at"),
	},
	(table) => ({
		userLookupIdx: index("managed_agent_sessions_user_lookup_idx").on(table.userId, table.updatedAt),
	}),
);

export const userSessionsTable = pgTable(
	"managed_agent_user_sessions",
	{
		userId: text("user_id").notNull(),
		sessionId: text("session_id").notNull(),
		sessionName: text("session_name").notNull(),
		lastActiveAt: text("last_active_at").notNull(),
	},
	(table) => ({
		pk: primaryKey({
			columns: [table.userId, table.sessionId],
			name: "managed_agent_user_sessions_pk",
		}),
		userListIdx: index("managed_agent_user_sessions_user_list_idx").on(
			table.userId,
			table.lastActiveAt,
			table.sessionId,
		),
	}),
);

export const auditRecordsTable = pgTable(
	"managed_agent_audit_records",
	{
		id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
		action: text("action").notNull(),
		sessionId: text("session_id").notNull(),
		userId: text("user_id").notNull(),
		recordedAt: text("recorded_at").notNull(),
	},
	(table) => ({
		sessionAuditIdx: index("managed_agent_audit_records_session_idx").on(table.sessionId, table.recordedAt),
	}),
);

export const usersTable = pgTable(
	"managed_agent_users",
	{
		userId: text("user_id").primaryKey(),
		username: text("username").notNull().unique(),
		passwordHash: text("password_hash").notNull(),
		status: text("status").notNull(),
		createdAt: text("created_at").notNull(),
		lastLoginAt: text("last_login_at"),
	},
	(table) => ({
		usernameLookupIdx: index("managed_agent_users_username_lookup_idx").on(table.username),
	}),
);

export const loginSessionsTable = pgTable(
	"managed_agent_login_sessions",
	{
		loginSessionId: text("login_session_id").primaryKey(),
		userId: text("user_id").notNull(),
		status: text("status").notNull(),
		createdAt: text("created_at").notNull(),
		expiresAt: text("expires_at").notNull(),
		lastSeenAt: text("last_seen_at").notNull(),
	},
	(table) => ({
		userLookupIdx: index("managed_agent_login_sessions_user_lookup_idx").on(table.userId, table.expiresAt),
	}),
);

export const llmProviderConfigsTable = pgTable(
	"managed_agent_llm_provider_configs",
	{
		providerConfigId: text("provider_config_id").primaryKey(),
		userId: text("user_id").notNull(),
		providerType: text("provider_type").notNull(),
		displayName: text("display_name").notNull(),
		authMode: text("auth_mode").notNull(),
		encryptedSecret: text("encrypted_secret"),
		baseUrl: text("base_url"),
		apiType: text("api_type"),
		headersJson: text("headers_json"),
		providerOptionsJson: text("provider_options_json"),
		availableModelsJson: text("available_models_json").notNull(),
		defaultModelId: text("default_model_id").notNull(),
		defaultThinkingLevel: text("default_thinking_level").notNull(),
		enabled: boolean("enabled").notNull().default(true),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
	},
	(table) => ({
		userLookupIdx: index("managed_agent_llm_provider_configs_user_lookup_idx").on(table.userId, table.updatedAt),
	}),
);

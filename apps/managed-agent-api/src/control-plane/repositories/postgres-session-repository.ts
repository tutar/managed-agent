import { and, desc, eq, isNull, lt, or } from "drizzle-orm";

import { ValidationError } from "../../api-channel/http-errors.js";
import type { TranscriptReader } from "../transcript-reader.js";
import type { ManagedAgentDatabase } from "./postgres-database.js";
import { sessionsTable, userSessionsTable } from "./postgres-schema.js";
import type { SessionRecord, SessionRepository, UserSessionsPageRecord } from "./session-repository.js";

const normalizeUserId = (userId: string) => {
	const trimmedUserId = userId.trim();

	if (trimmedUserId.startsWith('"') && trimmedUserId.endsWith('"') && trimmedUserId.length >= 2) {
		return trimmedUserId.slice(1, -1);
	}

	return trimmedUserId;
};

const encodeCursor = (item: { lastActiveAt: string; sessionId: string }) => {
	return Buffer.from(
		JSON.stringify({
			lastActiveAt: item.lastActiveAt,
			sessionId: item.sessionId,
		}),
		"utf8",
	).toString("base64url");
};

const decodeCursor = (cursor: string) => {
	let payload: {
		lastActiveAt?: unknown;
		sessionId?: unknown;
	};

	try {
		payload = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
			lastActiveAt?: unknown;
			sessionId?: unknown;
		};
	} catch {
		throw new ValidationError("cursor is invalid");
	}

	if (typeof payload.lastActiveAt !== "string" || typeof payload.sessionId !== "string") {
		throw new ValidationError("cursor is invalid");
	}

	return {
		lastActiveAt: payload.lastActiveAt,
		sessionId: payload.sessionId,
	};
};

/**
 * PostgreSQL-backed session metadata repository.
 *
 * The repository persists session metadata and recent-session projections in
 * PostgreSQL. Transcript entries are read through `TranscriptReader` from
 * pi-managed durable session files.
 */
export const createPostgresSessionRepository = ({
	db,
	transcriptReader,
}: {
	db: ManagedAgentDatabase;
	transcriptReader: TranscriptReader;
}): SessionRepository => {
	return {
		async createSession(session) {
			const normalizedUserId = normalizeUserId(session.userId);

			await db.transaction(async (tx) => {
				await tx.insert(sessionsTable).values({
					sessionId: session.sessionId,
					userId: normalizedUserId,
					sessionName: session.sessionName,
					status: session.status,
					model: session.model,
					thinkingLevel: session.thinkingLevel,
					piSessionFile: session.piSessionFile,
					createdAt: session.createdAt,
					updatedAt: session.updatedAt,
					archivedAt: session.archivedAt,
				});
				await tx
					.insert(userSessionsTable)
					.values({
						userId: normalizedUserId,
						sessionId: session.sessionId,
						sessionName: session.sessionName,
						lastActiveAt: session.updatedAt,
					})
					.onConflictDoUpdate({
						target: [userSessionsTable.userId, userSessionsTable.sessionId],
						set: {
							sessionName: session.sessionName,
							lastActiveAt: session.updatedAt,
						},
					});
			});
		},
		async getSession(sessionId) {
			const row = await db.query.sessionsTable.findFirst({
				where: and(eq(sessionsTable.sessionId, sessionId), isNull(sessionsTable.archivedAt)),
			});

			if (!row) {
				return null;
			}

			return {
				sessionId: row.sessionId,
				userId: row.userId,
				sessionName: row.sessionName,
				status: row.status as SessionRecord["status"],
				model: row.model,
				thinkingLevel: row.thinkingLevel,
				piSessionFile: row.piSessionFile ?? undefined,
				createdAt: row.createdAt,
				updatedAt: row.updatedAt,
				archivedAt: row.archivedAt ?? undefined,
				entries: await transcriptReader.readSessionEntries({
					sessionId: row.sessionId,
					piSessionFile: row.piSessionFile ?? undefined,
				}),
			};
		},
		async updateSession(session) {
			const normalizedUserId = normalizeUserId(session.userId);

			await db.transaction(async (tx) => {
				await tx
					.insert(sessionsTable)
					.values({
						sessionId: session.sessionId,
						userId: normalizedUserId,
						sessionName: session.sessionName,
						status: session.status,
						model: session.model,
						thinkingLevel: session.thinkingLevel,
						piSessionFile: session.piSessionFile,
						createdAt: session.createdAt,
						updatedAt: session.updatedAt,
						archivedAt: session.archivedAt,
					})
					.onConflictDoUpdate({
						target: sessionsTable.sessionId,
						set: {
							userId: normalizedUserId,
							sessionName: session.sessionName,
							status: session.status,
							model: session.model,
							thinkingLevel: session.thinkingLevel,
							piSessionFile: session.piSessionFile,
							createdAt: session.createdAt,
							updatedAt: session.updatedAt,
							archivedAt: session.archivedAt,
						},
					});

				if (session.archivedAt) {
					await tx
						.delete(userSessionsTable)
						.where(
							and(
								eq(userSessionsTable.userId, normalizedUserId),
								eq(userSessionsTable.sessionId, session.sessionId),
							),
						);
					return;
				}

				await tx
					.insert(userSessionsTable)
					.values({
						userId: normalizedUserId,
						sessionId: session.sessionId,
						sessionName: session.sessionName,
						lastActiveAt: session.updatedAt,
					})
					.onConflictDoUpdate({
						target: [userSessionsTable.userId, userSessionsTable.sessionId],
						set: {
							sessionName: session.sessionName,
							lastActiveAt: session.updatedAt,
						},
					});
			});
		},
		async listUserSessions(userId, options) {
			const normalizedUserId = normalizeUserId(userId);
			const limit = options?.limit ?? 20;
			const cursor = options?.cursor ? decodeCursor(options.cursor) : null;
			const rows = await db
				.select({
					sessionId: userSessionsTable.sessionId,
					sessionName: userSessionsTable.sessionName,
					lastActiveAt: userSessionsTable.lastActiveAt,
				})
				.from(userSessionsTable)
				.where(
					cursor
						? and(
								eq(userSessionsTable.userId, normalizedUserId),
								or(
									lt(userSessionsTable.lastActiveAt, cursor.lastActiveAt),
									and(
										eq(userSessionsTable.lastActiveAt, cursor.lastActiveAt),
										lt(userSessionsTable.sessionId, cursor.sessionId),
									),
								),
							)
						: eq(userSessionsTable.userId, normalizedUserId),
				)
				.orderBy(desc(userSessionsTable.lastActiveAt), desc(userSessionsTable.sessionId))
				.limit(limit + 1);

			const hasMore = rows.length > limit;
			const items = rows.slice(0, limit);
			const lastItem = items.at(-1);

			return {
				items,
				hasMore,
				nextCursor: hasMore && lastItem ? encodeCursor(lastItem) : null,
			} satisfies UserSessionsPageRecord;
		},
	};
};

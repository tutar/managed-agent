import type { SessionEntry } from "../entry-factory.js";

/**
 * Transcript persistence contracts.
 *
 * Transcript storage is kept separate from session metadata so future durable
 * backends can map entries to their own table or document family.
 */
export type SessionTranscriptRecord = {
	sessionId: string;
	entries: SessionEntry[];
};

export interface TranscriptRepository {
	createTranscript(record: SessionTranscriptRecord): Promise<void>;
	getTranscript(sessionId: string): Promise<SessionTranscriptRecord | null>;
	updateTranscript(record: SessionTranscriptRecord): Promise<void>;
}

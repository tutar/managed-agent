import type { SessionEntry } from "./entry-factory.js";

/**
 * Transcript read contracts for the control plane.
 *
 * The production path treats pi-managed transcript files as the durable
 * transcript truth. The API reads them on demand and maps them into the
 * platform's session-detail DTO shape.
 */
export type TranscriptReadInput = {
	sessionId: string;
	piSessionFile?: string;
};

export interface TranscriptReader {
	readSessionEntries(input: TranscriptReadInput): Promise<SessionEntry[]>;
}

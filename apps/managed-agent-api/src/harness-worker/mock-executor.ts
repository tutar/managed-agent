import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { SessionExecutor, SessionRunCompletion, SessionRunEvent, SessionRunJob } from "@managed-agent/contracts";
import type { SessionEntry } from "../control-plane/session/entry-factory.js";

type MockTranscriptRecord =
	| {
			type: "managed_session";
			sessionId: string;
			runtime: "mock";
			timestamp: string;
	  }
	| {
			type: "managed_entry";
			sessionId: string;
			entry: {
				id: string;
				parentId: string | null;
				createdAt: string;
				messageType: SessionEntry["messageType"];
				content: SessionEntry["content"];
				input?: unknown;
			};
	  };

const toMockRecords = (sessionId: string, entries: SessionEntry[]): MockTranscriptRecord[] => {
	const header: MockTranscriptRecord = {
		type: "managed_session",
		sessionId,
		runtime: "mock",
		timestamp: entries[0]?.createdAt ?? new Date().toISOString(),
	};

	const entryRecords = entries.map((entry) => ({
		type: "managed_entry" as const,
		sessionId,
		entry: {
			id: entry.id,
			parentId: entry.parentId,
			createdAt: entry.createdAt,
			messageType: entry.messageType,
			content: entry.content,
			...(entry.messageType === "user" ? { input: (entry as SessionEntry & { input?: unknown }).input } : {}),
		},
	}));

	return [header, ...entryRecords];
};

/**
 * Write (or append to) the managed transcript JSONL fixture that
 * pi-file-transcript-reader consumes.
 *
 * On the first run for a session this creates a new file.  On continuation
 * runs it appends the new entries so that getSession() sees the full history.
 */
const writeMockTranscript = async ({
	transcriptsRoot,
	sessionId,
	entries,
	isContinuation,
}: {
	transcriptsRoot: string;
	sessionId: string;
	entries: SessionEntry[];
	isContinuation: boolean;
}) => {
	const relativePath = `mock-sessions/${sessionId}.jsonl`;
	const transcriptPath = join(transcriptsRoot, relativePath);

	await mkdir(dirname(transcriptPath), { recursive: true });

	const records = toMockRecords(sessionId, entries);

	if (isContinuation) {
		await appendFile(transcriptPath, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
	} else {
		await writeFile(transcriptPath, `${records.map((r) => JSON.stringify(r)).join("\n")}\n`, "utf8");
	}

	return relativePath;
};

/**
 * Mock session executor for development / testing.
 *
 * When `transcriptsRoot` is provided, the executor writes a managed
 * transcript JSONL fixture so that getSession() can read entries back.
 */
export const createMockSessionExecutor = (opts?: { transcriptsRoot?: string }): SessionExecutor => {
	return {
		async *run(job: SessionRunJob): AsyncGenerator<SessionRunEvent, SessionRunCompletion> {
			const processText = `mock: processing "${job.input.content.map((c) => (c.type === "text" ? c.text : "")).join("")}"`;
			const assistantText = `mock response for session ${job.sessionId}`;

			yield {
				type: "process.delta",
				data: {
					sessionId: job.sessionId,
					entryId: job.processEntryId,
					parentId: job.userEntry.id,
					text: processText,
				},
			};

			yield {
				type: "final.output.delta",
				data: {
					sessionId: job.sessionId,
					entryId: job.finalEntryId,
					parentId: job.processEntryId,
					text: assistantText,
				},
			};

			yield {
				type: "final.output.completed",
				data: {
					sessionId: job.sessionId,
					entryId: job.finalEntryId,
				},
			};

			if (opts?.transcriptsRoot) {
				const piSessionFile = await writeMockTranscript({
					transcriptsRoot: opts.transcriptsRoot,
					sessionId: job.sessionId,
					entries: [
						job.userEntry,
						{
							id: job.processEntryId,
							parentId: job.userEntry.id,
							createdAt: job.userEntry.createdAt,
							messageType: "process",
							content: [{ type: "text", text: processText }],
						},
						{
							id: job.finalEntryId,
							parentId: job.processEntryId,
							createdAt: job.userEntry.createdAt,
							messageType: "assistant",
							content: [{ type: "text", text: assistantText }],
						},
					],
					isContinuation: !!job.piSessionFile,
				});

				return { piSessionFile };
			}

			return {};
		},
	};
};

// Legacy transcript store stub: kept for test backward-compat.
export const createMockTranscriptStore = (_opts: Record<string, unknown> = {}) => {
	return {
		async appendRunTranscript() {},
		async getRunTranscript() {
			return [];
		},
	};
};

import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { SessionRunJob } from "../jobs/session-run-job.js";
import { resolveManagedAgentMountPaths } from "./mount-paths.js";

type ManagedTranscriptRecord =
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
				messageType: "user" | "process" | "assistant";
				content: Array<
					| {
							type: "text";
							text: string;
					  }
					| {
							type: "tool_call";
							toolCallId: string;
							toolName: string;
							status: "started" | "completed" | "error";
							arguments?: string;
							result?: string;
							error?: string;
					  }
				>;
				input?: SessionRunJob["input"];
			};
	  };

type MockTranscriptStoreDependencies = {
	appendFile(filePath: string, content: string): Promise<void>;
	ensureDir(directoryPath: string): Promise<void>;
};

const createDefaultDependencies = (): MockTranscriptStoreDependencies => {
	return {
		appendFile(filePath, content) {
			return appendFile(filePath, content, "utf8");
		},
		async ensureDir(directoryPath) {
			await mkdir(directoryPath, { recursive: true });
		},
	};
};

/**
 * Persist mock-runtime transcript entries under the shared durable mount root.
 *
 * Mock runs do not have a pi-native session file, so they serialize platform
 * entry data directly into a JSONL transcript that the API can read back
 * through the same durable transcript boundary as the pi path.
 */
export const createMockTranscriptStore = ({
	transcriptsRoot = resolveManagedAgentMountPaths().transcriptsRoot,
	dependencies = createDefaultDependencies(),
}: {
	transcriptsRoot?: string;
	dependencies?: MockTranscriptStoreDependencies;
} = {}) => {
	return {
		async appendRunTranscript({
			job,
			summaryText,
			toolCallId,
			finalText,
		}: {
			job: SessionRunJob;
			summaryText: string;
			toolCallId: string;
			finalText: string;
		}) {
			const relativePath = job.piSessionFile ?? join("mock-sessions", `${job.sessionId}.jsonl`);
			const transcriptPath = join(transcriptsRoot, relativePath);

			await dependencies.ensureDir(dirname(transcriptPath));

			const records: ManagedTranscriptRecord[] = [];

			if (!job.piSessionFile) {
				records.push({
					type: "managed_session",
					sessionId: job.sessionId,
					runtime: "mock",
					timestamp: job.userEntry.createdAt,
				});
			}

			records.push(
				{
					type: "managed_entry",
					sessionId: job.sessionId,
					entry: {
						id: job.userEntry.id,
						parentId: job.userEntry.parentId,
						createdAt: job.userEntry.createdAt,
						messageType: "user",
						content: job.userEntry.content.flatMap((item) => {
							if (item.type !== "text") {
								return [];
							}

							return [{ type: "text" as const, text: item.text }];
						}),
						input: job.userEntry.input,
					},
				},
				{
					type: "managed_entry",
					sessionId: job.sessionId,
					entry: {
						id: job.processEntryId,
						parentId: job.userEntry.id,
						createdAt: job.userEntry.createdAt,
						messageType: "process",
						content: [
							{
								type: "text",
								text: summaryText,
							},
							{
								type: "tool_call",
								toolCallId,
								toolName: "mock-harness-worker",
								status: "completed",
								...(job.input.content[0]?.type === "text" ? { arguments: job.input.content[0].text } : {}),
								result: "ok",
							},
						],
					},
				},
				{
					type: "managed_entry",
					sessionId: job.sessionId,
					entry: {
						id: job.finalEntryId,
						parentId: job.processEntryId,
						createdAt: new Date().toISOString(),
						messageType: "assistant",
						content: [
							{
								type: "text",
								text: finalText,
							},
						],
					},
				},
			);

			await dependencies.appendFile(
				transcriptPath,
				`${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
			);

			return relativePath;
		},
	};
};

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveManagedAgentMountPaths } from "../../infrastructure/storage/mount-paths.js";
import type { AssistantEntry, ProcessEntry, SessionEntry, UserEntry } from "./entry-factory.js";

/**
 * Read sandbox JSONL transcript back into platform entries.
 *
 * Sandbox transcripts are append-only event logs. Rehydration must preserve
 * turn order, so this reader rebuilds one user/process/assistant chain at a
 * time instead of grouping all users first and all assistant chunks later.
 */
export const readSandboxTranscript = async (sessionId: string): Promise<SessionEntry[]> => {
	const transcriptsRoot = resolveManagedAgentMountPaths().transcriptsRoot;
	const path = join(transcriptsRoot, "pi-sessions", `${sessionId}.jsonl`);

	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch {
		return [];
	}

	const lines = raw
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	if (lines.length === 0) {
		return [];
	}

	const entries: SessionEntry[] = [];
	const fallbackTimestamp = new Date().toISOString();
	let currentUserEntry: UserEntry | null = null;
	let currentProcessEntry: ProcessEntry | null = null;
	let currentAssistantEntry: AssistantEntry | null = null;

	const flushCurrentTurn = () => {
		if (currentUserEntry) {
			entries.push(currentUserEntry);
		}

		if (currentProcessEntry) {
			entries.push(currentProcessEntry);
		}

		if (currentAssistantEntry) {
			const assistantText = currentAssistantEntry.content
				.filter((item) => item.type === "text")
				.map((item) => item.text)
				.join("");

			if (assistantText.length > 0) {
				entries.push(currentAssistantEntry);
			}
		}

		currentUserEntry = null;
		currentProcessEntry = null;
		currentAssistantEntry = null;
	};

	const ensureProcessEntry = (data: Record<string, unknown>) => {
		if (currentProcessEntry) {
			return currentProcessEntry;
		}

		currentProcessEntry = {
			id: typeof data.entryId === "string" ? data.entryId : `sp_${entries.length}`,
			parentId: typeof data.parentId === "string" ? data.parentId : (currentUserEntry?.id ?? "orphan"),
			createdAt: fallbackTimestamp,
			messageType: "process",
			content: [],
		};

		return currentProcessEntry;
	};

	const ensureAssistantEntry = (data: Record<string, unknown>) => {
		if (currentAssistantEntry) {
			return currentAssistantEntry;
		}

		const processEntry = ensureProcessEntry(data);
		currentAssistantEntry = {
			id: typeof data.entryId === "string" ? data.entryId : `sa_${entries.length}`,
			parentId: typeof data.parentId === "string" ? data.parentId : processEntry.id,
			createdAt: fallbackTimestamp,
			messageType: "assistant",
			content: [{ type: "text", text: "" }],
		};

		return currentAssistantEntry;
	};

	for (const line of lines) {
		let event: { type: string; data?: Record<string, unknown> };
		try {
			event = JSON.parse(line) as { type: string; data?: Record<string, unknown> };
		} catch {
			continue;
		}

		const data = event.data ?? {};

		if (event.type === "user_entry") {
			flushCurrentTurn();
			const rawUserEntry = event as unknown as Record<string, unknown>;
			const userText = typeof rawUserEntry.text === "string" ? rawUserEntry.text : "";

			currentUserEntry = {
				id: typeof rawUserEntry.entryId === "string" ? rawUserEntry.entryId : `su_${entries.length}`,
				parentId: typeof rawUserEntry.parentId === "string" ? rawUserEntry.parentId : (entries.at(-1)?.id ?? null),
				createdAt: typeof rawUserEntry.createdAt === "string" ? rawUserEntry.createdAt : fallbackTimestamp,
				messageType: "user",
				content: [{ type: "text", text: userText }],
				input: {
					content: [{ type: "text", text: userText }],
				},
			};
			continue;
		}

		if (event.type === "process.delta") {
			ensureProcessEntry(data).content.push({
				type: "text",
				text: typeof data.text === "string" ? data.text : "",
			});
			continue;
		}

		if (event.type === "action.started" || event.type === "action.completed" || event.type === "action.failed") {
			const processEntry = ensureProcessEntry(data);
			processEntry.content.push({
				type: "tool_call",
				toolCallId: typeof data.toolCallId === "string" ? data.toolCallId : `tool_${processEntry.content.length}`,
				toolName: typeof data.name === "string" ? data.name : "unknown_tool",
				status:
					event.type === "action.started" ? "started" : event.type === "action.completed" ? "completed" : "error",
				...(typeof data.arguments === "string" ? { arguments: data.arguments } : {}),
				...(event.type === "action.completed" && typeof data.result === "string" ? { result: data.result } : {}),
				...(event.type === "action.failed" && typeof data.error === "string" ? { error: data.error } : {}),
			});
			continue;
		}

		if (event.type === "final.output.delta") {
			const assistantEntry = ensureAssistantEntry(data);
			const firstContentItem = assistantEntry.content[0];

			if (firstContentItem?.type === "text") {
				firstContentItem.text += typeof data.text === "string" ? data.text : "";
			}
			continue;
		}

		if (event.type === "run.failed") {
			const assistantEntry = ensureAssistantEntry(data);
			const firstContentItem = assistantEntry.content[0];

			if (firstContentItem?.type === "text" && firstContentItem.text.length === 0) {
				firstContentItem.text = typeof data.message === "string" ? `执行失败：${data.message}` : "执行失败";
			}
			flushCurrentTurn();
			continue;
		}

		if (event.type === "final.output.completed") {
			flushCurrentTurn();
		}
	}

	flushCurrentTurn();
	return entries;
};

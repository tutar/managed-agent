import { join } from "node:path";
import type { SessionExecutor, SessionRunCompletion, SessionRunEvent, SessionRunJob } from "@managed-agent/contracts";
import type { HarnessEvent } from "@managed-agent/harness";
import { resolveAdapter } from "@managed-agent/harness";
import { resolveManagedAgentMountPaths } from "../infrastructure/storage/mount-paths.js";

export const createPiSessionExecutor = ({
	transcriptsRoot = resolveManagedAgentMountPaths().transcriptsRoot,
}: {
	transcriptsRoot?: string;
} = {}): SessionExecutor => {
	return {
		async *run(job: SessionRunJob): AsyncGenerator<SessionRunEvent, SessionRunCompletion> {
			const userText = job.input.content?.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";

			const adapter = await resolveAdapter();
			const iterator = adapter.run({
				model: job.model,
				thinkingLevel: job.thinkingLevel,
				prompt: userText,
				piSessionFile: job.piSessionFile,
				sessionDir: join(transcriptsRoot, "pi-sessions"),
				llmProvider: job.llmProvider,
			});

			let result = iterator.next();
			while (true) {
				const next = await result;
				if (next.done) {
					return { piSessionFile: next.value?.piSessionFile };
				}
				yield mapEvent(next.value, job);
				result = iterator.next();
			}
		},
	};
};

const mapEvent = (event: HarnessEvent, job: SessionRunJob): SessionRunEvent => {
	switch (event.type) {
		case "agent_start":
			return { type: "process.delta", data: { sessionId: job.sessionId, entryId: job.processEntryId, parentId: job.userEntry.id, text: "harness runtime 已接管当前请求。" } };
		case "agent_end":
			return { type: "final.output.completed", data: { sessionId: job.sessionId, entryId: job.finalEntryId } };
		case "text_delta":
			return { type: "final.output.delta", data: { sessionId: job.sessionId, entryId: job.finalEntryId, parentId: job.processEntryId, text: event.text } };
		case "tool_start":
			return { type: "action.started", data: { sessionId: job.sessionId, entryId: job.processEntryId, parentId: job.userEntry.id, toolCallId: event.toolCallId, name: event.name, arguments: event.arguments } };
		case "tool_end":
			return { type: "action.completed", data: { sessionId: job.sessionId, entryId: job.processEntryId, parentId: job.userEntry.id, toolCallId: event.toolCallId, name: event.name, result: event.result } };
	}
};

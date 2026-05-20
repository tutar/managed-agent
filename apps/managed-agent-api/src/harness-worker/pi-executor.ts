import { isAbsolute, join, relative } from "node:path";
import type { SessionExecutor, SessionRunCompletion, SessionRunEvent, SessionRunJob } from "@managed-agent/contracts";
import type { HarnessEvent } from "@managed-agent/harness";
import { runHarness } from "@managed-agent/harness";
import { resolveManagedAgentMountPaths } from "../infrastructure/storage/mount-paths.js";

export const createPiSessionExecutor = ({
	runHarnessImpl = runHarness,
	transcriptsRoot = resolveManagedAgentMountPaths().transcriptsRoot,
}: {
	runHarnessImpl?: typeof runHarness;
	transcriptsRoot?: string;
} = {}): SessionExecutor => {
	return {
		async *run(job: SessionRunJob): AsyncGenerator<SessionRunEvent, SessionRunCompletion> {
			const userText = job.input.content?.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";

			const iterator = runHarnessImpl({
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
					return {
						piSessionFile: normalizePiSessionFile(next.value?.piSessionFile, transcriptsRoot),
					};
				}
				const mappedEvent = mapEvent(next.value, job);
				if (mappedEvent) {
					yield mappedEvent;
				}
				result = iterator.next();
			}
		},
	};
};

/**
 * Persist relative pi session paths so the API can reopen them against the
 * shared transcripts root regardless of the current working directory.
 */
const normalizePiSessionFile = (piSessionFile: string | undefined, transcriptsRoot: string) => {
	if (!piSessionFile || piSessionFile.length === 0) {
		return undefined;
	}

	if (isAbsolute(piSessionFile)) {
		return relative(transcriptsRoot, piSessionFile);
	}

	return piSessionFile;
};

const mapEvent = (event: HarnessEvent, job: SessionRunJob): SessionRunEvent | null => {
	switch (event.type) {
		case "agent_start":
			return null;
		case "agent_end":
			return {
				type: "final.output.completed",
				data: {
					sessionId: job.sessionId,
					entryId: job.finalEntryId,
				},
			};
		case "text_delta":
			return {
				type: "final.output.delta",
				data: {
					sessionId: job.sessionId,
					entryId: job.finalEntryId,
					parentId: job.processEntryId,
					text: event.text,
				},
			};
		case "tool_start":
			return {
				type: "action.started",
				data: {
					sessionId: job.sessionId,
					entryId: job.processEntryId,
					parentId: job.userEntry.id,
					toolCallId: event.toolCallId,
					name: event.name,
					arguments: event.arguments,
				},
			};
		case "tool_end": {
			const toolExecutionFailed = "isError" in event && event.isError === true;
			return {
				type: toolExecutionFailed ? "action.failed" : "action.completed",
				data: {
					sessionId: job.sessionId,
					entryId: job.processEntryId,
					parentId: job.userEntry.id,
					toolCallId: event.toolCallId,
					name: event.name,
					...(toolExecutionFailed ? { error: event.result } : { result: event.result }),
				},
			};
		}
	}
};

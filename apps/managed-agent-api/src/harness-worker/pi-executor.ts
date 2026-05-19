import type { SessionExecutor, SessionRunCompletion, SessionRunEvent, SessionRunJob } from "@managed-agent/contracts";
import type { HarnessEvent } from "@managed-agent/harness";
import { runHarness } from "@managed-agent/harness";

export const createPiSessionExecutor = ({
	runHarnessImpl = runHarness,
}: {
	runHarnessImpl?: typeof runHarness;
} = {}): SessionExecutor => {
	return {
		async *run(job: SessionRunJob): AsyncGenerator<SessionRunEvent, SessionRunCompletion> {
			const userText = job.input.content?.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";

			const iterator = runHarnessImpl({
				model: job.model,
				thinkingLevel: job.thinkingLevel,
				prompt: userText,
				piSessionFile: job.piSessionFile,
			});

			let result = iterator.next();
			while (true) {
				const next = await result;
				if (next.done) {
					return { piSessionFile: next.value?.piSessionFile };
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

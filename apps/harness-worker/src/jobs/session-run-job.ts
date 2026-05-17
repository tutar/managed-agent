import type { DemoInput, UserEntry } from "../../../managed-agent-api/src/control-plane/entry-factory.js";

/**
 * Worker job contracts shared between the API service and harness worker.
 *
 * The API side prepares a normalized session run job. The worker side consumes
 * it and emits a small event stream that the control plane can translate into
 * SSE output and transcript updates.
 */
export type SessionRunJob = {
	sessionId: string;
	model: string;
	thinkingLevel: string;
	input: DemoInput;
	piSessionFile?: string;
	userEntry: UserEntry;
	processEntryId: string;
	finalEntryId: string;
};

export type SessionRunEvent =
	| {
			type: "process.delta";
			data: {
				sessionId: string;
				entryId: string;
				parentId: string;
				text: string;
			};
	  }
	| {
			type: "action.started" | "action.completed" | "action.failed";
			data: {
				sessionId: string;
				entryId: string;
				parentId: string;
				toolCallId: string;
				name: string;
				arguments?: string;
				result?: string;
				error?: string;
			};
	  }
	| {
			type: "final.output.delta";
			data: {
				sessionId: string;
				entryId: string;
				parentId: string;
				text: string;
			};
	  }
	| {
			type: "final.output.completed";
			data: {
				sessionId: string;
				entryId: string;
			};
	  }
	| {
			type: "run.failed";
			data: {
				sessionId: string;
				entryId: string;
				parentId: string;
				code: string;
				message: string;
			};
	  };

export type SessionRunCompletion = {
	piSessionFile?: string;
};

export interface SessionExecutor {
	run(job: SessionRunJob): AsyncGenerator<SessionRunEvent, SessionRunCompletion>;
}

import type {
	DemoInput,
	SessionRunCompletion,
	SessionRunEvent,
	SessionRunJob,
	UserEntry,
} from "@managed-agent/contracts";

/**
 * Worker job contracts shared between the API service and harness worker.
 *
 * The API side prepares a normalized session run job. The worker side consumes
 * it and emits a small event stream that the control plane can translate into
 * SSE output and transcript updates.
 */
export type { DemoInput, SessionRunCompletion, SessionRunEvent, SessionRunJob, UserEntry };

export interface SessionExecutor {
	run(job: SessionRunJob): AsyncGenerator<SessionRunEvent, SessionRunCompletion>;
}

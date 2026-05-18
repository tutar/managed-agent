import type { SessionRunCompletion, SessionRunEvent, SessionRunJob } from "@managed-agent/contracts";

/**
 * HTTP worker client contract used by the managed session control plane.
 *
 * managed-agent-api only talks to harness-worker over the worker HTTP
 * surface. It must not import worker-internal runtime modules directly.
 */
export interface HarnessWorkerGateway {
	execute(job: SessionRunJob): AsyncGenerator<SessionRunEvent, SessionRunCompletion>;
}

export class HarnessWorkerExecutionError extends Error {
	readonly code: string;

	constructor(message: string, options?: { code?: string; cause?: unknown }) {
		super(message, { cause: options?.cause });
		this.name = "HarnessWorkerExecutionError";
		this.code = options?.code ?? "worker_execution_failed";
	}
}

type WorkerCompletionEvent = {
	type: "run.completed";
	data: SessionRunCompletion;
};

const parseSseFrames = async (
	response: Response,
	onEvent: (event: SessionRunEvent | WorkerCompletionEvent) => void,
) => {
	const reader = response.body?.getReader();

	if (!reader) {
		throw new Error("worker response body is not readable");
	}

	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const next = await reader.read();

		if (next.done) {
			break;
		}

		buffer += decoder.decode(next.value, { stream: true });
		const frames = buffer.split("\n\n");
		buffer = frames.pop() ?? "";

		for (const frame of frames) {
			const eventName = frame
				.split("\n")
				.find((line) => line.startsWith("event:"))
				?.slice("event:".length)
				.trim();
			const dataLine = frame
				.split("\n")
				.find((line) => line.startsWith("data:"))
				?.slice("data:".length)
				.trim();

			if (!eventName || !dataLine) {
				continue;
			}

			onEvent({
				type: eventName,
				data: JSON.parse(dataLine) as unknown,
			} as SessionRunEvent | WorkerCompletionEvent);
		}
	}
};

/**
 * Create the HTTP client used by managed-agent-api to call harness-worker.
 */
export const createRemoteHarnessWorkerGateway = ({
	baseUrl = process.env.MANAGED_AGENT_WORKER_BASE_URL ?? "http://127.0.0.1:4000",
	fetchImpl = fetch,
}: {
	baseUrl?: string;
	fetchImpl?: typeof fetch;
} = {}): HarnessWorkerGateway => {
	return {
		async *execute(job: SessionRunJob): AsyncGenerator<SessionRunEvent, SessionRunCompletion> {
			const response = await fetchImpl(new URL("/internal/session-runs", baseUrl).toString(), {
				method: "POST",
				headers: {
					"content-type": "application/json",
				},
				body: JSON.stringify(job),
			});

			if (!response.ok) {
				let message = `worker request failed with status ${response.status}`;

				try {
					const payload = (await response.json()) as {
						error?: { message?: string };
					};
					message = payload.error?.message ?? message;
				} catch {
					// Keep the status-derived message when the worker body is not JSON.
				}

				throw new HarnessWorkerExecutionError(message, {
					code: "worker_transport_failed",
				});
			}

			const queuedEvents: SessionRunEvent[] = [];
			let completion: SessionRunCompletion = {};
			let isFinished = false;
			let parsingError: unknown = null;
			let notify: (() => void) | null = null;

			const waitForNextEvent = () => {
				return new Promise<void>((resolve) => {
					notify = resolve;
				});
			};

			void parseSseFrames(response, (event) => {
				if (event.type === "run.completed") {
					completion = event.data;
				} else {
					queuedEvents.push(event);
				}

				notify?.();
				notify = null;
			})
				.catch((error: unknown) => {
					parsingError = error;
				})
				.finally(() => {
					isFinished = true;
					notify?.();
					notify = null;
				});

			while (!isFinished || queuedEvents.length > 0) {
				if (queuedEvents.length === 0) {
					await waitForNextEvent();
					continue;
				}

				const nextEvent = queuedEvents.shift();

				if (nextEvent) {
					yield nextEvent;
				}
			}

			if (parsingError) {
				throw new HarnessWorkerExecutionError(
					parsingError instanceof Error ? parsingError.message : "worker stream parsing failed",
					{
						code: "worker_stream_failed",
						cause: parsingError,
					},
				);
			}

			return completion;
		},
	};
};

/**
 * In-memory worker HTTP transport used by managed-agent-api tests.
 *
 * The API test suite must stay on the HTTP worker client path, but the sandbox
 * does not allow binding local TCP ports. This helper emulates the worker's
 * HTTP surface with fetch-compatible responses.
 */
import type { SessionRunJob } from "@managed-agent/contracts";

import type { SessionExecutor } from "@managed-agent/contracts";

const INTERNAL_RUN_PATH = "/internal/session-runs";

const isSessionRunJob = (value: unknown): value is SessionRunJob => {
	return (
		typeof value === "object" &&
		value !== null &&
		"sessionId" in value &&
		typeof value.sessionId === "string" &&
		"model" in value &&
		typeof value.model === "string" &&
		"thinkingLevel" in value &&
		typeof value.thinkingLevel === "string" &&
		"input" in value &&
		typeof value.input === "object" &&
		value.input !== null &&
		"userEntry" in value &&
		typeof value.userEntry === "object" &&
		value.userEntry !== null &&
		"processEntryId" in value &&
		typeof value.processEntryId === "string" &&
		"finalEntryId" in value &&
		typeof value.finalEntryId === "string"
	);
};

const createJsonResponse = (status: number, body: unknown) => {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json; charset=utf-8",
		},
	});
};

/**
 * Create a fetch implementation that mirrors the worker HTTP contract closely
 * enough for API tests without requiring a bound TCP port.
 */
export const createTestWorkerFetch = ({ executor }: { executor: SessionExecutor }): typeof fetch => {
	return async (input, init) => {
		const requestUrl = typeof input === "string" ? input : input.toString();
		const url = new URL(requestUrl);
		const method = init?.method ?? "GET";

		if (method === "POST" && url.pathname === INTERNAL_RUN_PATH) {
			const rawBody = init?.body;
			const bodyText =
				typeof rawBody === "string"
					? rawBody
					: rawBody instanceof Uint8Array
						? new TextDecoder().decode(rawBody)
						: "{}";
			const parsedBody = JSON.parse(bodyText) as unknown;

			if (!isSessionRunJob(parsedBody)) {
				return createJsonResponse(400, {
					error: {
						code: "invalid_job",
						message: "request body is not a valid session run job",
					},
				});
			}

			const encoder = new TextEncoder();

			return new Response(
				new ReadableStream({
					async start(controller) {
						const writeEvent = (eventName: string, data: unknown) => {
							controller.enqueue(encoder.encode(`event: ${eventName}\n`));
							controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
						};

						try {
							const iterator = executor.run(parsedBody);

							while (true) {
								const next = await iterator.next();

								if (next.done) {
									writeEvent("run.completed", next.value);
									controller.close();
									return;
								}

								writeEvent(next.value.type, next.value.data);
							}
						} catch (error) {
							controller.error(error);
						}
					},
				}),
				{
					status: 200,
					headers: {
						"content-type": "text/event-stream; charset=utf-8",
					},
				},
			);
		}

		return createJsonResponse(404, {
			error: {
				code: "not_found",
				message: "route not found",
			},
		});
	};
};

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * SSE helpers used by the managed session event publisher.
 *
 * Fastify now owns normal JSON transport, but the control-plane still writes
 * SSE frames directly to the raw Node response for the session stream routes.
 */
const createSseCorsHeaders = (origin?: string) => {
	if (!origin) {
		return {
			"access-control-allow-origin": "*",
			"access-control-allow-headers": "content-type",
			"access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
		};
	}

	return {
		"access-control-allow-origin": origin,
		"access-control-allow-credentials": "true",
		"access-control-allow-headers": "content-type",
		"access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
	};
};

export const openSse = (response: ServerResponse<IncomingMessage>, origin?: string) => {
	response.writeHead(200, {
		...createSseCorsHeaders(origin),
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-cache, no-transform",
		connection: "keep-alive",
	});
};

export const writeSseEvent = (response: ServerResponse<IncomingMessage>, eventName: string, data: unknown) => {
	response.write(`event: ${eventName}\n`);
	response.write(`data: ${JSON.stringify(data)}\n\n`);
};

export const closeSse = (response: ServerResponse<IncomingMessage>) => {
	response.end();
};

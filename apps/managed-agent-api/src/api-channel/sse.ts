import type { IncomingMessage, ServerResponse } from "node:http"
import { ValidationError } from "./http-errors.js"

/**
 * Small transport helpers for HTTP JSON parsing and SSE framing.
 *
 * The local server keeps them together because both API routes and the event publisher
 * rely on the same response encoding semantics.
 */
const MAX_BODY_BYTES = 1024 * 64
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
}

/** Read a bounded JSON request body so the local API does not accept unbounded input. */
export const readJsonBody = async (
  request: IncomingMessage,
): Promise<unknown> => {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of request) {
    if (!(chunk instanceof Buffer)) {
      continue
    }

    totalBytes += chunk.length

    if (totalBytes > MAX_BODY_BYTES) {
      throw new ValidationError("request body too large")
    }

    chunks.push(chunk)
  }

  if (chunks.length === 0) {
    return {}
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
  } catch {
    throw new ValidationError("request body must be valid JSON")
  }
}

export const openSse = (response: ServerResponse<IncomingMessage>) => {
  response.writeHead(200, {
    ...CORS_HEADERS,
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  })
}

export const writeSseEvent = (
  response: ServerResponse<IncomingMessage>,
  eventName: string,
  data: unknown,
) => {
  response.write(`event: ${eventName}\n`)
  response.write(`data: ${JSON.stringify(data)}\n\n`)
}

export const closeSse = (response: ServerResponse<IncomingMessage>) => {
  response.end()
}

export const sendJson = (
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  body: unknown,
) => {
  response.writeHead(statusCode, {
    ...CORS_HEADERS,
    "content-type": "application/json; charset=utf-8",
  })
  response.end(JSON.stringify(body))
}

/** Respond to browser preflight checks for the standalone web application. */
export const sendPreflight = (response: ServerResponse<IncomingMessage>) => {
  response.writeHead(204, CORS_HEADERS)
  response.end()
}

export const sendNotFound = (response: ServerResponse<IncomingMessage>) => {
  sendJson(response, 404, {
    error: {
      code: "not_found",
      message: "route not found",
    },
  })
}

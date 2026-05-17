/**
 * Internal HTTP transport for the standalone Harness Worker service.
 *
 * The worker owns execution. The API remains the orchestration owner and sends
 * one fully prepared job per request.
 */
import type { IncomingMessage, ServerResponse } from "node:http"

import type {
  SessionExecutor,
  SessionRunCompletion,
  SessionRunEvent,
  SessionRunJob,
} from "../jobs/session-run-job.js"

const MAX_BODY_BYTES = 1024 * 256

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
}

type WorkerCompletionEvent = {
  type: "run.completed"
  data: SessionRunCompletion
}

const readJsonBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of request) {
    if (!(chunk instanceof Buffer)) {
      continue
    }

    totalBytes += chunk.length

    if (totalBytes > MAX_BODY_BYTES) {
      throw new Error("request body too large")
    }

    chunks.push(chunk)
  }

  if (chunks.length === 0) {
    return {}
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
}

const writeSseEvent = (
  response: ServerResponse<IncomingMessage>,
  eventName: string,
  data: unknown,
) => {
  response.write(`event: ${eventName}\n`)
  response.write(`data: ${JSON.stringify(data)}\n\n`)
}

const openSse = (response: ServerResponse<IncomingMessage>) => {
  response.writeHead(200, {
    ...CORS_HEADERS,
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  })
}

const sendJson = (
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

const sendPreflight = (response: ServerResponse<IncomingMessage>) => {
  response.writeHead(204, CORS_HEADERS)
  response.end()
}

const isRunJob = (value: unknown): value is SessionRunJob => {
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
  )
}

/**
 * Build the internal HTTP handler for the standalone Harness Worker service.
 */
export const createInternalRunHttpHandler = ({
  executor,
}: {
  executor: SessionExecutor
}) => {
  return async (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>,
  ) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1")

      if (request.method === "OPTIONS") {
        sendPreflight(response)
        return
      }

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true })
        return
      }

      if (
        request.method === "POST" &&
        url.pathname === "/internal/session-runs"
      ) {
        const body = await readJsonBody(request)

        if (!isRunJob(body)) {
          sendJson(response, 400, {
            error: {
              code: "invalid_job",
              message: "request body is not a valid session run job",
            },
          })
          return
        }

        openSse(response)
        const iterator = executor.run(body)

        while (true) {
          const next = await iterator.next()

          if (next.done) {
            const completionEvent: WorkerCompletionEvent = {
              type: "run.completed",
              data: next.value,
            }
            writeSseEvent(response, completionEvent.type, completionEvent.data)
            response.end()
            return
          }

          const event: SessionRunEvent = next.value
          writeSseEvent(response, event.type, event.data)
        }
      }

      sendJson(response, 404, {
        error: {
          code: "not_found",
          message: "route not found",
        },
      })
    } catch (error) {
      sendJson(response, 500, {
        error: {
          code: "internal_error",
          message: error instanceof Error ? error.message : "internal error",
        },
      })
    }
  }
}

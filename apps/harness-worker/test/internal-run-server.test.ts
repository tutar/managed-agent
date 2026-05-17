/**
 * Transport tests for the standalone Harness Worker HTTP surface.
 */
import assert from "node:assert/strict"
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http"
import { Readable } from "node:stream"
import test from "node:test"

import type { SessionExecutor } from "../src/jobs/session-run-job.js"
import { createInternalRunHttpHandler } from "../src/http/internal-run-server.js"

type ResponseCapture = {
  body: string
  headers: Record<string, string>
  statusCode: number
}

const createRequest = ({
  method,
  url,
  body,
  headers,
}: {
  method: string
  url: string
  body?: string
  headers?: IncomingHttpHeaders
}) => {
  const chunks = body ? [Buffer.from(body)] : []
  const request = Readable.from(chunks) as IncomingMessage

  request.method = method
  request.url = url
  request.headers = headers ?? {}

  return request
}

const createResponseCapture = () => {
  const chunks: string[] = []
  const headers: Record<string, string> = {}
  let statusCode = 200

  const response = {
    writeHead(nextStatusCode: number, nextHeaders?: Record<string, string>) {
      statusCode = nextStatusCode

      if (nextHeaders) {
        Object.assign(headers, nextHeaders)
      }

      return this
    },
    write(chunk: string) {
      chunks.push(chunk)
      return true
    },
    end(chunk?: string) {
      if (typeof chunk === "string") {
        chunks.push(chunk)
      }
    },
  } as unknown as ServerResponse<IncomingMessage>

  return {
    response,
    read(): ResponseCapture {
      return {
        body: chunks.join(""),
        headers,
        statusCode,
      }
    },
  }
}

const createTestJob = () => {
  return {
    sessionId: "sess_1",
    model: "deepseek/chat",
    thinkingLevel: "medium",
    input: {
      content: [{ type: "text", text: "hello" }],
    },
    userEntry: {
      id: "entry_user",
      parentId: null,
      messageType: "user",
      content: [{ type: "text", text: "hello" }],
      input: {
        content: [{ type: "text", text: "hello" }],
      },
    },
    processEntryId: "entry_process",
    finalEntryId: "entry_final",
  }
}

test("internal harness worker server streams run events and completion", async () => {
  const executor: SessionExecutor = {
    async *run() {
      yield {
        type: "process.delta",
        data: {
          sessionId: "sess_1",
          entryId: "entry_process",
          parentId: "entry_user",
          text: "working",
        },
      }

      yield {
        type: "final.output.delta",
        data: {
          sessionId: "sess_1",
          entryId: "entry_final",
          parentId: "entry_process",
          text: "done",
        },
      }

      return {
        piSessionFile: "pi-session.jsonl",
      }
    },
  }

  const handler = createInternalRunHttpHandler({ executor })
  const capture = createResponseCapture()

  await handler(
    createRequest({
      method: "POST",
      url: "/internal/session-runs",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(createTestJob()),
    }),
    capture.response,
  )

  const result = capture.read()
  assert.equal(result.statusCode, 200)
  assert.equal(
    result.headers["content-type"],
    "text/event-stream; charset=utf-8",
  )
  assert.match(result.body, /event: process\.delta/)
  assert.match(result.body, /event: final\.output\.delta/)
  assert.match(result.body, /event: run\.completed/)
  assert.match(result.body, /pi-session\.jsonl/)
})

test("internal harness worker server validates the posted run job", async () => {
  const executor: SessionExecutor = {
    async *run() {
      return {}
    },
  }

  const handler = createInternalRunHttpHandler({ executor })
  const capture = createResponseCapture()

  await handler(
    createRequest({
      method: "POST",
      url: "/internal/session-runs",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ sessionId: "sess_1" }),
    }),
    capture.response,
  )

  const result = capture.read()
  assert.equal(result.statusCode, 400)
  assert.match(result.body, /invalid_job/)
})

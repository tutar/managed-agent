/**
 * Transport-level tests for the API surface without opening sockets.
 */
import assert from "node:assert/strict"
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http"
import { Readable } from "node:stream"
import test from "node:test"

import type { SessionExecutor } from "../../harness-worker/src/jobs/session-run-job.js"
import { createTranscriptBackedExecutor, createTestControlPlane } from "./test-support/create-test-control-plane.js"

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
  let headersSent = false

  const response = {
    writeHead(nextStatusCode: number, nextHeaders?: Record<string, string>) {
      statusCode = nextStatusCode
      headersSent = true

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
    get headersSent() {
      return headersSent
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

test("http handler supports creating a session and appending a message", async () => {
  const harness = await createTestControlPlane()
  const handler = harness.createHandler()

  try {
    const createCapture = createResponseCapture()

    await handler(
      createRequest({
        method: "POST",
        url: "/sessions?userId=demo-user",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "managed-agent-local",
          thinkingLevel: "medium",
          input: {
            content: [{ type: "text", text: "第一次输入" }],
          },
        }),
      }),
      createCapture.response,
    )

    const createResult = createCapture.read()
    const sessionIdMatch = createResult.body.match(/"sessionId":"([^"]+)"/)

    assert.equal(createResult.statusCode, 200)
    assert.equal(
      createResult.headers["content-type"],
      "text/event-stream; charset=utf-8",
    )
    assert.ok(sessionIdMatch)

    const messageResponseCapture = createResponseCapture()
    const sessionId = sessionIdMatch[1]

    await handler(
      createRequest({
        method: "POST",
        url: `/sessions/${sessionId}/messages`,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: {
            content: [{ type: "text", text: "第二次输入" }],
          },
        }),
      }),
      messageResponseCapture.response,
    )

    const messageResult = messageResponseCapture.read()
    const sessionResponseCapture = createResponseCapture()

    await handler(
      createRequest({
        method: "GET",
        url: `/sessions/${sessionId}`,
      }),
      sessionResponseCapture.response,
    )

    const sessionResult = sessionResponseCapture.read()
    const sessionBody = JSON.parse(sessionResult.body) as {
      entries: Array<{ messageType: string }>
    }

    assert.equal(messageResult.statusCode, 200)
    assert.match(messageResult.body, /event: message.accepted/)
    assert.equal(sessionResult.statusCode, 200)
    assert.deepEqual(
      sessionBody.entries.map((entry) => entry.messageType),
      ["user", "process", "assistant", "user", "process", "assistant"],
    )
  } finally {
    await harness.close()
  }
})

test("http handler answers CORS preflight requests for the standalone web-ui", async () => {
  const harness = await createTestControlPlane()
  const handler = harness.createHandler()

  try {
    const preflightCapture = createResponseCapture()

    await handler(
      createRequest({
        method: "OPTIONS",
        url: "/sessions",
      }),
      preflightCapture.response,
    )

    const preflightResult = preflightCapture.read()
    assert.equal(preflightResult.statusCode, 204)
    assert.equal(preflightResult.headers["access-control-allow-origin"], "*")
    assert.equal(
      preflightResult.headers["access-control-allow-methods"],
      "GET,POST,PATCH,DELETE,OPTIONS",
    )
  } finally {
    await harness.close()
  }
})

test("http handler returns SSE failure events when worker execution fails", async () => {
  const harness = await createTestControlPlane({
    executor: {
      async *run() {
        throw new Error("runtime exploded")
      },
    },
  })
  const handler = harness.createHandler()

  try {
    const createCapture = createResponseCapture()

    await handler(
      createRequest({
        method: "POST",
        url: "/sessions?userId=demo-user",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "managed-agent-local",
          thinkingLevel: "medium",
          input: {
            content: [{ type: "text", text: "触发失败" }],
          },
        }),
      }),
      createCapture.response,
    )

    const createResult = createCapture.read()

    assert.equal(createResult.statusCode, 200)
    assert.match(createResult.body, /event: run.failed/)
    assert.match(createResult.body, /执行失败：runtime exploded/)
  } finally {
    await harness.close()
  }
})

test("http handler persists the full assistant transcript after chunked SSE output", async () => {
  const harness = await createTestControlPlane({
    executorFactory: ({ transcriptsRoot }) =>
      createTranscriptBackedExecutor({
        transcriptsRoot,
        processContent: [
          { type: "text", text: "正在分析请求。" },
          {
            type: "tool_call",
            toolCallId: "tool_read_workspace",
            toolName: "read_workspace",
            status: "started",
            arguments: '{"path":"."}',
          },
          {
            type: "tool_call",
            toolCallId: "tool_read_workspace",
            toolName: "read_workspace",
            status: "completed",
            arguments: '{"path":"."}',
            result: '{"files":["README.md"]}',
          },
        ],
        assistantText: "介绍下你自己。",
        streamedAssistantChunks: ["介绍", "下你自己。"],
        additionalEvents: [
          { type: "process.delta", data: { text: "正在分析请求。" } },
          {
            type: "action.started",
            data: {
              toolCallId: "tool_read_workspace",
              name: "read_workspace",
              arguments: '{"path":"."}',
            },
          },
          {
            type: "action.completed",
            data: {
              toolCallId: "tool_read_workspace",
              name: "read_workspace",
              arguments: '{"path":"."}',
              result: '{"files":["README.md"]}',
            },
          },
        ],
      }),
  })
  const handler = harness.createHandler()

  try {
    const createCapture = createResponseCapture()

    await handler(
      createRequest({
        method: "POST",
        url: "/sessions?userId=demo-user",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "managed-agent-local",
          thinkingLevel: "medium",
          input: {
            content: [{ type: "text", text: "介绍下你自己。" }],
          },
        }),
      }),
      createCapture.response,
    )

    const createResult = createCapture.read()
    const sessionIdMatch = createResult.body.match(/"sessionId":"([^"]+)"/)

    assert.ok(sessionIdMatch)

    const sessionResponseCapture = createResponseCapture()

    await handler(
      createRequest({
        method: "GET",
        url: `/sessions/${sessionIdMatch[1]}`,
      }),
      sessionResponseCapture.response,
    )

    const sessionResult = sessionResponseCapture.read()
    const sessionBody = JSON.parse(sessionResult.body) as {
      status: string
      createdAt: string
      lastActiveAt: string
      entries: Array<{
        createdAt: string
        messageType: string
        content: Array<{
          type: string
          text?: string
          toolCallId?: string
          toolName?: string
          status?: string
          arguments?: string
          result?: string
        }>
      }>
    }

    assert.equal(sessionBody.status, "idle")
    assert.match(sessionBody.createdAt, /^\d{4}-\d{2}-\d{2}T/)
    assert.match(sessionBody.lastActiveAt, /^\d{4}-\d{2}-\d{2}T/)
    assert.match(sessionBody.entries[0]?.createdAt ?? "", /^\d{4}-\d{2}-\d{2}T/)
    assert.equal(sessionBody.entries.at(-1)?.content[0]?.text, "介绍下你自己。")
    assert.deepEqual(sessionBody.entries[1]?.content, [
      {
        type: "text",
        text: "正在分析请求。",
      },
      {
        type: "tool_call",
        toolCallId: "tool_read_workspace",
        toolName: "read_workspace",
        status: "started",
        arguments: '{"path":"."}',
      },
      {
        type: "tool_call",
        toolCallId: "tool_read_workspace",
        toolName: "read_workspace",
        status: "completed",
        arguments: '{"path":"."}',
        result: '{"files":["README.md"]}',
      },
    ])
  } finally {
    await harness.close()
  }
})

test("http handler returns 404 when cancelling a missing session", async () => {
  const harness = await createTestControlPlane()
  const handler = harness.createHandler()

  try {
    const cancelCapture = createResponseCapture()

    await handler(
      createRequest({
        method: "POST",
        url: "/sessions/sess_missing/cancel",
      }),
      cancelCapture.response,
    )

    const cancelResult = cancelCapture.read()

    assert.equal(cancelResult.statusCode, 404)
    assert.match(cancelResult.body, /"code":"session_not_found"/)
    assert.match(cancelResult.body, /session sess_missing not found/)
  } finally {
    await harness.close()
  }
})

test("http handler supports renaming a session", async () => {
  const harness = await createTestControlPlane()
  const handler = harness.createHandler()

  try {
    const createCapture = createResponseCapture()

    await handler(
      createRequest({
        method: "POST",
        url: "/sessions?userId=demo-user",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: {
            content: [{ type: "text", text: "初始标题" }],
          },
        }),
      }),
      createCapture.response,
    )

    const sessionId = createCapture.read().body.match(/"sessionId":"([^"]+)"/)?.[1]
    assert.ok(sessionId)

    const renameCapture = createResponseCapture()
    await handler(
      createRequest({
        method: "PATCH",
        url: `/sessions/${sessionId}`,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sessionName: "新的标题",
        }),
      }),
      renameCapture.response,
    )

    const renameResult = renameCapture.read()
    const renamedSession = JSON.parse(renameResult.body) as { sessionName: string }

    assert.equal(renameResult.statusCode, 200)
    assert.equal(renamedSession.sessionName, "新的标题")
  } finally {
    await harness.close()
  }
})

test("http handler returns 400 when rename payload is invalid", async () => {
  const harness = await createTestControlPlane()
  const handler = harness.createHandler()

  try {
    const renameCapture = createResponseCapture()

    await handler(
      createRequest({
        method: "PATCH",
        url: "/sessions/sess_missing",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sessionName: "   ",
        }),
      }),
      renameCapture.response,
    )

    const renameResult = renameCapture.read()

    assert.equal(renameResult.statusCode, 400)
    assert.match(renameResult.body, /"code":"bad_request"/)
    assert.match(renameResult.body, /sessionName is required/)
  } finally {
    await harness.close()
  }
})

test("http handler soft-deletes archived sessions from detail and list views", async () => {
  const harness = await createTestControlPlane()
  const handler = harness.createHandler()

  try {
    const createCapture = createResponseCapture()

    await handler(
      createRequest({
        method: "POST",
        url: "/sessions?userId=demo-user",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: {
            content: [{ type: "text", text: "待归档会话" }],
          },
        }),
      }),
      createCapture.response,
    )

    const sessionId = createCapture.read().body.match(/"sessionId":"([^"]+)"/)?.[1]
    assert.ok(sessionId)

    const deleteCapture = createResponseCapture()
    await handler(
      createRequest({
        method: "DELETE",
        url: `/sessions/${sessionId}`,
      }),
      deleteCapture.response,
    )

    assert.equal(deleteCapture.read().statusCode, 204)

    const detailCapture = createResponseCapture()
    await handler(
      createRequest({
        method: "GET",
        url: `/sessions/${sessionId}`,
      }),
      detailCapture.response,
    )

    const listCapture = createResponseCapture()
    await handler(
      createRequest({
        method: "GET",
        url: "/users/demo-user/sessions",
      }),
      listCapture.response,
    )

    const listResult = JSON.parse(listCapture.read().body) as {
      items: Array<{ sessionId: string }>
    }

    assert.equal(detailCapture.read().statusCode, 404)
    assert.equal(listResult.items.length, 0)
  } finally {
    await harness.close()
  }
})

test("http handler returns 409 when deleting a running session", async () => {
  const slowExecutor: SessionExecutor = {
    async *run(job) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      yield {
        type: "final.output.delta",
        data: {
          sessionId: job.sessionId,
          entryId: job.finalEntryId,
          parentId: job.processEntryId,
          text: "still running",
        },
      }
      yield {
        type: "final.output.completed",
        data: {
          sessionId: job.sessionId,
          entryId: job.finalEntryId,
        },
      }

      return {}
    },
  }
  const harness = await createTestControlPlane({
    executor: slowExecutor,
  })
  const handler = harness.createHandler()

  try {
    const createCapture = createResponseCapture()

    const createPromise = handler(
      createRequest({
        method: "POST",
        url: "/sessions?userId=demo-user",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          input: {
            content: [{ type: "text", text: "长时间执行" }],
          },
        }),
      }),
      createCapture.response,
    )

    await new Promise((resolve) => setTimeout(resolve, 5))

    const sessionId = createCapture.read().body.match(/"sessionId":"([^"]+)"/)?.[1]
    assert.ok(sessionId)

    const deleteCapture = createResponseCapture()
    await handler(
      createRequest({
        method: "DELETE",
        url: `/sessions/${sessionId}`,
      }),
      deleteCapture.response,
    )

    const deleteResult = deleteCapture.read()

    assert.equal(deleteResult.statusCode, 409)
    assert.match(deleteResult.body, /"code":"session_state_conflict"/)

    await createPromise
  } finally {
    await harness.close()
  }
})

test("http handler paginates recent sessions with nextCursor and hasMore", async () => {
  const harness = await createTestControlPlane()
  const handler = harness.createHandler()

  try {
    for (const title of ["会话一", "会话二", "会话三"]) {
      const capture = createResponseCapture()
      await handler(
        createRequest({
          method: "POST",
          url: "/sessions?userId=demo-user",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            input: {
              content: [{ type: "text", text: title }],
            },
          }),
        }),
        capture.response,
      )
    }

    const firstPageCapture = createResponseCapture()
    await handler(
      createRequest({
        method: "GET",
        url: "/users/demo-user/sessions?limit=2",
      }),
      firstPageCapture.response,
    )

    const firstPage = JSON.parse(firstPageCapture.read().body) as {
      items: Array<{ sessionName: string }>
      nextCursor: string | null
      hasMore: boolean
    }

    assert.equal(firstPage.items.length, 2)
    assert.equal(firstPage.hasMore, true)
    assert.ok(firstPage.nextCursor)

    const secondPageCapture = createResponseCapture()
    await handler(
      createRequest({
        method: "GET",
        url: `/users/demo-user/sessions?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
      }),
      secondPageCapture.response,
    )

    const secondPage = JSON.parse(secondPageCapture.read().body) as {
      items: Array<{ sessionName: string }>
      nextCursor: string | null
      hasMore: boolean
    }

    assert.equal(secondPage.items.length, 1)
    assert.equal(secondPage.items[0]?.sessionName, "会话一")
    assert.equal(secondPage.nextCursor, null)
    assert.equal(secondPage.hasMore, false)
  } finally {
    await harness.close()
  }
})

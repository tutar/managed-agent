/**
 * Tests for the local harness worker gateway boundary.
 */
import assert from "node:assert/strict"
import test from "node:test"

import { createMockSessionExecutor } from "../src/runtime/mock-session-executor.js"
import {
  createLocalHarnessWorkerGateway,
  createRemoteHarnessWorkerGateway,
  HarnessWorkerExecutionError,
} from "../src/session-worker-gateway.js"

test("local harness worker gateway delegates execution to the selected executor", async () => {
  const gateway = createLocalHarnessWorkerGateway({
    executor: createMockSessionExecutor(),
  })

  const events: string[] = []

  for await (const event of gateway.execute({
    sessionId: "sess_gateway",
    model: "managed-agent-local",
    thinkingLevel: "medium",
    input: {
      content: [{ type: "text", text: "验证 worker gateway" }],
    },
    userEntry: {
      id: "entry_user",
      parentId: null,
      createdAt: "2026-05-16T12:10:00.000Z",
      messageType: "user",
      content: [{ type: "text", text: "验证 worker gateway" }],
      input: {
        content: [{ type: "text", text: "验证 worker gateway" }],
      },
    },
    processEntryId: "entry_process",
    finalEntryId: "entry_final",
  })) {
    events.push(event.type)
  }

  assert.deepEqual(events, [
    "process.delta",
    "action.started",
    "action.completed",
    "final.output.delta",
    "final.output.completed",
  ])
})

test("local harness worker gateway normalizes executor failures", async () => {
  const gateway = createLocalHarnessWorkerGateway({
    executor: {
      async *run() {
        throw new Error("mock executor failed")
      },
    },
  })

  await assert.rejects(
    async () => {
      for await (const _event of gateway.execute({
        sessionId: "sess_gateway_failed",
        model: "managed-agent-local",
        thinkingLevel: "medium",
        input: {
          content: [{ type: "text", text: "触发失败" }],
        },
        userEntry: {
          id: "entry_user",
          parentId: null,
          createdAt: "2026-05-16T12:10:00.000Z",
          messageType: "user",
          content: [{ type: "text", text: "触发失败" }],
          input: {
            content: [{ type: "text", text: "触发失败" }],
          },
        },
        processEntryId: "entry_process",
        finalEntryId: "entry_final",
      })) {
        // No-op.
      }
    },
    (error: unknown) => {
      assert.ok(error instanceof HarnessWorkerExecutionError)
      assert.equal(error.code, "worker_execution_failed")
      assert.match(error.message, /mock executor failed/)
      return true
    },
  )
})

test("remote harness worker gateway replays worker SSE and completion", async () => {
  const gateway = createRemoteHarnessWorkerGateway({
    baseUrl: "http://worker.internal",
    fetchImpl: async () => {
      const encoder = new TextEncoder()

      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'event: process.delta\ndata: {"sessionId":"sess_1","entryId":"entry_process","parentId":"entry_user","text":"working"}\n\n',
              ),
            )
            controller.enqueue(
              encoder.encode(
                'event: run.completed\ndata: {"piSessionFile":"pi-session.jsonl"}\n\n',
              ),
            )
            controller.close()
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
          },
        },
      )
    },
  })

  const iterator = gateway.execute({
    sessionId: "sess_1",
    model: "managed-agent-local",
    thinkingLevel: "medium",
    input: {
      content: [{ type: "text", text: "验证 remote worker gateway" }],
    },
    userEntry: {
      id: "entry_user",
      parentId: null,
      createdAt: "2026-05-16T12:10:00.000Z",
      messageType: "user",
      content: [{ type: "text", text: "验证 remote worker gateway" }],
      input: {
        content: [{ type: "text", text: "验证 remote worker gateway" }],
      },
    },
    processEntryId: "entry_process",
    finalEntryId: "entry_final",
  })

  const first = await iterator.next()
  assert.equal(first.done, false)
  assert.equal(first.value.type, "process.delta")

  const completion = await iterator.next()
  assert.equal(completion.done, true)
  assert.deepEqual(completion.value, {
    piSessionFile: "pi-session.jsonl",
  })
})

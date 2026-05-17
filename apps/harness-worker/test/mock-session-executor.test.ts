/**
 * Tests for the default mock worker executor.
 */
import assert from "node:assert/strict"
import test from "node:test"

import { createMockSessionExecutor } from "../src/runtime/mock-session-executor.js"

test("mock session executor emits the expected event sequence", async () => {
  const executor = createMockSessionExecutor({
    transcriptStore: {
      async appendRunTranscript() {
        return "mock-sessions/sess_1.jsonl"
      },
    },
  })

  const events = []
  for await (const event of executor.run({
    sessionId: "sess_1",
    model: "demo-model",
    thinkingLevel: "medium",
    input: {
      content: [{ type: "text", text: "分析当前项目结构" }],
    },
    userEntry: {
      id: "entry_user",
      parentId: null,
      createdAt: "2026-05-16T12:10:00.000Z",
      messageType: "user",
      content: [{ type: "text", text: "分析当前项目结构" }],
      input: {
        content: [{ type: "text", text: "分析当前项目结构" }],
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

test("mock session executor persists a durable transcript file for the API read path", async () => {
  let appendedContent = ""

  const executor = createMockSessionExecutor({
    transcriptStore: {
      async appendRunTranscript({ job, summaryText, toolCallId, finalText }) {
        appendedContent = JSON.stringify({
          sessionId: job.sessionId,
          summaryText,
          toolCallId,
          finalText,
        })
        return "mock-sessions/sess_1.jsonl"
      },
    },
  })

  const iterator = executor.run({
    sessionId: "sess_1",
    model: "demo-model",
    thinkingLevel: "medium",
    input: {
      content: [{ type: "text", text: "分析当前项目结构" }],
    },
    userEntry: {
      id: "entry_user",
      parentId: null,
      createdAt: "2026-05-16T12:10:00.000Z",
      messageType: "user",
      content: [{ type: "text", text: "分析当前项目结构" }],
      input: {
        content: [{ type: "text", text: "分析当前项目结构" }],
      },
    },
    processEntryId: "entry_process",
    finalEntryId: "entry_final",
  })

  let completion: IteratorResult<unknown, { piSessionFile?: string }>
  do {
    completion = await iterator.next()
  } while (!completion.done)

  assert.match(appendedContent, /mock harness worker/)
  assert.equal(completion.value.piSessionFile, "mock-sessions/sess_1.jsonl")
})

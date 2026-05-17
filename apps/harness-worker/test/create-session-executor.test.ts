/**
 * Tests for runtime mode selection.
 */
import assert from "node:assert/strict"
import test from "node:test"

import { createSessionExecutor } from "../src/runtime/create-session-executor.js"

test("createSessionExecutor defaults to the mock runtime", async () => {
  const previousRuntime = process.env.MANAGED_AGENT_RUNTIME
  delete process.env.MANAGED_AGENT_RUNTIME

  try {
    const executor = createSessionExecutor()
    const iterator = executor.run({
      sessionId: "sess_1",
      model: "demo-model",
      thinkingLevel: "medium",
      piSessionFile: "/tmp/demo-session.jsonl",
      input: {
        content: [{ type: "text", text: "hello" }],
      },
      userEntry: {
        id: "entry_user",
        parentId: null,
        createdAt: "2026-05-16T12:10:00.000Z",
        messageType: "user",
        content: [{ type: "text", text: "hello" }],
        input: {
          content: [{ type: "text", text: "hello" }],
        },
      },
      processEntryId: "entry_process",
      finalEntryId: "entry_final",
    })

    const firstEvent = await iterator.next()
    assert.equal(firstEvent.done, false)
    if (firstEvent.done) {
      throw new Error("expected the mock executor to emit at least one event")
    }
    assert.equal(firstEvent.value.type, "process.delta")

    let completion = await iterator.next()
    while (!completion.done) {
      completion = await iterator.next()
    }

    assert.equal(completion.value?.piSessionFile, "/tmp/demo-session.jsonl")
  } finally {
    if (previousRuntime) {
      process.env.MANAGED_AGENT_RUNTIME = previousRuntime
    }
  }
})

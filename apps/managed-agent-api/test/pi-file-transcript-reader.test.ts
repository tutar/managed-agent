/**
 * Transcript reader tests for pi-managed durable session files.
 */
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { createPiFileTranscriptReader } from "../src/control-plane/session/pi-file-transcript-reader.js"

test("pi file transcript reader maps pi JSONL messages into platform session entries", async () => {
  const baseDir = mkdtempSync(join(tmpdir(), "managed-agent-transcript-"))
  const transcriptPath = join(baseDir, "session.jsonl")

  writeFileSync(
    transcriptPath,
    [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "pi_sess_1",
        timestamp: "2026-05-16T15:00:00.000Z",
      }),
      JSON.stringify({
        type: "message",
        id: "msg_user_1",
        parentId: null,
        timestamp: "2026-05-16T15:00:01.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "介绍下自己" }],
          timestamp: 1778943601000,
        },
      }),
      JSON.stringify({
        type: "message",
        id: "msg_assistant_1",
        parentId: "msg_user_1",
        timestamp: "2026-05-16T15:00:02.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "分析上下文。" },
            { type: "text", text: "我是一个 managed agent。" },
          ],
          timestamp: 1778943602000,
        },
      }),
      JSON.stringify({
        type: "message",
        id: "msg_user_2",
        parentId: "msg_assistant_1",
        timestamp: "2026-05-16T15:00:03.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "继续介绍" }],
          timestamp: 1778943603000,
        },
      }),
    ].join("\n"),
    "utf8",
  )

  const reader = createPiFileTranscriptReader()
  const entries = await reader.readSessionEntries({
    sessionId: "sess_1",
    piSessionFile: transcriptPath,
  })

  assert.deepEqual(
    entries.map((entry) => entry.messageType),
    ["user", "process", "assistant", "user"],
  )
  assert.equal(entries[0]?.id, "pi_user_msg_user_1")
  assert.equal(entries[1]?.parentId, "pi_user_msg_user_1")
  assert.deepEqual(entries[1]?.content, [
    {
      type: "text",
      text: "分析上下文。",
    },
  ])
  assert.deepEqual(entries[2]?.content, [
    {
      type: "text",
      text: "我是一个 managed agent。",
    },
  ])
  assert.equal(entries[3]?.parentId, "pi_assistant_msg_assistant_1")
})

test("pi file transcript reader derives relative transcript paths from MANAGED_AGENT_MOUNT_ROOT", async () => {
  const previousMountRoot = process.env.MANAGED_AGENT_MOUNT_ROOT
  const mountRoot = mkdtempSync(join(tmpdir(), "managed-agent-mount-root-"))
  const transcriptRoot = join(mountRoot, "transcripts")
  const transcriptPath = join(transcriptRoot, "pi-sessions", "session.jsonl")

  process.env.MANAGED_AGENT_MOUNT_ROOT = mountRoot
  mkdirSync(join(transcriptRoot, "pi-sessions"), { recursive: true })
  writeFileSync(
    transcriptPath,
    [
      JSON.stringify({
        type: "message",
        id: "msg_user_1",
        parentId: null,
        timestamp: "2026-05-16T15:00:01.000Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "hello" }],
        },
      }),
    ].join("\n"),
    "utf8",
  )

  try {
    const reader = createPiFileTranscriptReader()
    const entries = await reader.readSessionEntries({
      sessionId: "sess_mount_root",
      piSessionFile: join("pi-sessions", "session.jsonl"),
    })

    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.id, "pi_user_msg_user_1")
  } finally {
    if (previousMountRoot === undefined) {
      delete process.env.MANAGED_AGENT_MOUNT_ROOT
    } else {
      process.env.MANAGED_AGENT_MOUNT_ROOT = previousMountRoot
    }
  }
})

test("pi file transcript reader returns an empty entry list when the host cannot see a relative runtime file", async () => {
  const mountRoot = mkdtempSync(join(tmpdir(), "managed-agent-missing-runtime-file-"))
  const previousMountRoot = process.env.MANAGED_AGENT_MOUNT_ROOT

  process.env.MANAGED_AGENT_MOUNT_ROOT = mountRoot

  try {
    const reader = createPiFileTranscriptReader()
    const entries = await reader.readSessionEntries({
      sessionId: "sess_missing",
      piSessionFile: "sandbox-runtime-sessions/sess_missing.jsonl",
    })

    assert.deepEqual(entries, [])
  } finally {
    if (previousMountRoot === undefined) {
      delete process.env.MANAGED_AGENT_MOUNT_ROOT
    } else {
      process.env.MANAGED_AGENT_MOUNT_ROOT = previousMountRoot
    }
  }
})

test("pi file transcript reader maps managed mock transcript entries into platform session entries", async () => {
  const baseDir = mkdtempSync(join(tmpdir(), "managed-agent-mock-transcript-"))
  const transcriptPath = join(baseDir, "session.jsonl")

  writeFileSync(
    transcriptPath,
    [
      JSON.stringify({
        type: "managed_session",
        sessionId: "sess_mock_1",
        runtime: "mock",
        timestamp: "2026-05-17T10:00:00.000Z",
      }),
      JSON.stringify({
        type: "managed_entry",
        sessionId: "sess_mock_1",
        entry: {
          id: "entry_user_1",
          parentId: null,
          createdAt: "2026-05-17T10:00:01.000Z",
          messageType: "user",
          content: [{ type: "text", text: "介绍下自己" }],
          input: {
            content: [{ type: "text", text: "介绍下自己" }],
          },
        },
      }),
      JSON.stringify({
        type: "managed_entry",
        sessionId: "sess_mock_1",
        entry: {
          id: "entry_process_1",
          parentId: "entry_user_1",
          createdAt: "2026-05-17T10:00:01.000Z",
          messageType: "process",
          content: [
            { type: "text", text: "已接收请求：介绍下自己" },
            {
              type: "tool_call",
              toolCallId: "tool_call_mock_1",
              toolName: "mock-harness-worker",
              status: "completed",
              arguments: "介绍下自己",
              result: "ok",
            },
          ],
        },
      }),
      JSON.stringify({
        type: "managed_entry",
        sessionId: "sess_mock_1",
        entry: {
          id: "entry_assistant_1",
          parentId: "entry_process_1",
          createdAt: "2026-05-17T10:00:02.000Z",
          messageType: "assistant",
          content: [{ type: "text", text: "我是一个 mock agent。" }],
        },
      }),
    ].join("\n"),
    "utf8",
  )

  const reader = createPiFileTranscriptReader()
  const entries = await reader.readSessionEntries({
    sessionId: "sess_mock_1",
    piSessionFile: transcriptPath,
  })

  assert.deepEqual(
    entries.map((entry) => entry.messageType),
    ["user", "process", "assistant"],
  )
  assert.equal(entries[1]?.content[1]?.type, "tool_call")
  assert.equal(
    entries[1]?.content[1]?.type === "tool_call"
      ? entries[1].content[1].toolName
      : "",
    "mock-harness-worker",
  )
  assert.deepEqual(entries[2]?.content, [
    {
      type: "text",
      text: "我是一个 mock agent。",
    },
  ])
})

test("pi file transcript reader collapses tool-use assistant chains into one final assistant message", async () => {
  const baseDir = mkdtempSync(join(tmpdir(), "managed-agent-pi-tool-use-"))
  const transcriptPath = join(baseDir, "session.jsonl")

  writeFileSync(
    transcriptPath,
    [
      JSON.stringify({
        type: "message",
        id: "msg_user_1",
        parentId: null,
        timestamp: "2026-05-17T00:34:47.569Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "介绍deepseek v4" }],
          timestamp: 1778978087569,
        },
      }),
      JSON.stringify({
        type: "message",
        id: "msg_assistant_tool_use",
        parentId: "msg_user_1",
        timestamp: "2026-05-17T00:34:59.495Z",
        message: {
          role: "assistant",
          stopReason: "toolUse",
          content: [
            { type: "thinking", thinking: "先检查项目内是否有 DeepSeek。" },
            {
              type: "text",
              text: "I don't have specific knowledge about a \"DeepSeek V4\" model. Let me check what the project knows about DeepSeek.",
            },
            {
              type: "toolCall",
              id: "call_1",
              name: "bash",
              arguments: {
                command: "rg -i deepseek .",
              },
            },
          ],
          timestamp: 1778978087569,
        },
      }),
      JSON.stringify({
        type: "message",
        id: "msg_tool_result_1",
        parentId: "msg_assistant_tool_use",
        timestamp: "2026-05-17T00:34:59.531Z",
        message: {
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "bash",
          content: [{ type: "text", text: "(no output)" }],
          isError: false,
          timestamp: 1778978099531,
        },
      }),
      JSON.stringify({
        type: "message",
        id: "msg_assistant_final",
        parentId: "msg_tool_result_1",
        timestamp: "2026-05-17T00:35:10.184Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "项目内没有相关引用。" },
            {
              type: "text",
              text: "这个项目中没有任何与 DeepSeek 相关的引用或集成。",
            },
          ],
          timestamp: 1778978099531,
        },
      }),
    ].join("\n"),
    "utf8",
  )

  const reader = createPiFileTranscriptReader()
  const entries = await reader.readSessionEntries({
    sessionId: "sess_tool_use",
    piSessionFile: transcriptPath,
  })

  assert.deepEqual(
    entries.map((entry) => entry.messageType),
    ["user", "process", "assistant"],
  )
  assert.deepEqual(entries[1]?.content, [
    {
      type: "text",
      text: "先检查项目内是否有 DeepSeek。",
    },
    {
      type: "text",
      text: "I don't have specific knowledge about a \"DeepSeek V4\" model. Let me check what the project knows about DeepSeek.",
    },
    {
      type: "tool_call",
      toolCallId: "call_1",
      toolName: "bash",
      status: "started",
      arguments: "{\"command\":\"rg -i deepseek .\"}",
    },
    {
      type: "tool_call",
      toolCallId: "call_1",
      toolName: "bash",
      status: "completed",
      result: "(no output)",
    },
  ])
  assert.deepEqual(entries[2]?.content, [
    {
      type: "text",
      text: "这个项目中没有任何与 DeepSeek 相关的引用或集成。",
    },
  ])
})

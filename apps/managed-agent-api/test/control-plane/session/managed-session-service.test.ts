/**
 * Integration-style tests for the managed session service.
 */
import assert from "node:assert/strict"
import test from "node:test"

import type { SessionExecutor } from "@managed-agent/contracts"
import { createProcessEntry, type DemoContentItem } from "../../../src/control-plane/session/entry-factory.js"
import {
  parseCreateMessageRequestDto,
  parseCreateSessionRequestDto,
} from "../../../src/channel/web-api/dto/session-dto.js"
import {
  createResponseStub,
  createTestControlPlane,
  createTranscriptBackedExecutor,
} from "../../test-support/create-test-control-plane.js"
import { writeManagedTranscriptFixture } from "../../test-support/managed-transcript-fixture.js"

test("managed session service creates a session and updates projections", async () => {
  const harness = await createTestControlPlane()
  const userId = harness.developmentUser.userId

  try {
    await harness.managedSessionService.createSession({
      request: parseCreateSessionRequestDto({
        providerConfigId: harness.defaultProviderConfig.providerConfigId,
        input: {
          content: [{ type: "text", text: "分析当前项目结构" }],
        },
      }),
      userId,
      includeProcess: true,
      includeFinal: true,
      response: createResponseStub(),
    })

    const sessionsPage = await harness.managedSessionService.listUserSessions(
      userId,
    )
    assert.equal(sessionsPage.items.length, 1)
    assert.equal(sessionsPage.items[0]?.sessionName, "分析当前项目结构")

    const session = await harness.managedSessionService.getSession(
      sessionsPage.items[0]!.sessionId,
    )
    assert.ok(session)
    assert.equal(session?.entries.length, 3)
    assert.equal(
      await harness.managedSessionService.cancelSession(
        sessionsPage.items[0]!.sessionId,
      ),
      false,
    )
    assert.deepEqual((await harness.auditService.list()).map((item) => item.action), [
      "session.created",
    ])
  } finally {
    await harness.close()
  }
})

test("managed session service can continue an existing session", async () => {
  const harness = await createTestControlPlane()
  const userId = harness.developmentUser.userId

  try {
    await harness.managedSessionService.createSession({
      request: parseCreateSessionRequestDto({
        providerConfigId: harness.defaultProviderConfig.providerConfigId,
        input: {
          content: [{ type: "text", text: "第一次输入" }],
        },
      }),
      userId,
      includeProcess: true,
      includeFinal: true,
      response: createResponseStub(),
    })

    const sessionId = (
      await harness.managedSessionService.listUserSessions(userId)
    ).items[0]!.sessionId

    await harness.managedSessionService.submitMessage({
      sessionId,
      request: parseCreateMessageRequestDto({
        input: {
          content: [{ type: "text", text: "第二次输入" }],
        },
      }),
      includeProcess: true,
      includeFinal: true,
      response: createResponseStub(),
    })

    const session = await harness.managedSessionService.getSession(sessionId)
    assert.ok(session)
    assert.equal(session?.entries.length, 6)
    assert.equal(session?.entries[3]?.messageType, "user")
    assert.deepEqual((await harness.auditService.list()).map((item) => item.action), [
      "session.created",
      "session.message_submitted",
    ])
  } finally {
    await harness.close()
  }
})

test("managed session service persists and reuses piSessionFile across prompts", async () => {
  const seenPiSessionFiles: Array<string | undefined> = []
  const harness = await createTestControlPlane({
    executorFactory: ({ transcriptsRoot }) => {
      const relativePath = "test-sessions/persisted.jsonl"

      return {
        async *run(job) {
          seenPiSessionFiles.push(job.piSessionFile)
          const processEntry = createProcessEntry(
            job.userEntry.id,
            [{ type: "text", text: "processing" }],
            job.userEntry.createdAt,
          )

          await writeManagedTranscriptFixture({
            transcriptsRoot,
            relativePath,
            sessionId: job.sessionId,
            entries: [
              job.userEntry,
              processEntry,
              {
                id: job.finalEntryId,
                parentId: processEntry.id,
                createdAt: job.userEntry.createdAt,
                messageType: "assistant",
                content: [{ type: "text", text: "done" }],
              },
            ],
          })

          yield {
            type: "process.delta",
            data: {
              sessionId: job.sessionId,
              entryId: job.processEntryId,
              parentId: job.userEntry.id,
              text: "processing",
            },
          }
          yield {
            type: "final.output.delta",
            data: {
              sessionId: job.sessionId,
              entryId: job.finalEntryId,
              parentId: job.processEntryId,
              text: "done",
            },
          }
          yield {
            type: "final.output.completed",
            data: {
              sessionId: job.sessionId,
              entryId: job.finalEntryId,
            },
          }

          return {
            piSessionFile: relativePath,
          }
        },
      } satisfies SessionExecutor
    },
  })
  const userId = harness.developmentUser.userId

  try {
    await harness.managedSessionService.createSession({
      request: parseCreateSessionRequestDto({
        providerConfigId: harness.defaultProviderConfig.providerConfigId,
        input: {
          content: [{ type: "text", text: "第一次输入" }],
        },
      }),
      userId,
      includeProcess: true,
      includeFinal: true,
      response: createResponseStub(),
    })

    const sessionId = (
      await harness.managedSessionService.listUserSessions(userId)
    ).items[0]!.sessionId
    const createdSession = await harness.managedSessionService.getSession(sessionId)

    assert.equal(createdSession?.piSessionFile, "test-sessions/persisted.jsonl")

    await harness.managedSessionService.submitMessage({
      sessionId,
      request: parseCreateMessageRequestDto({
        input: {
          content: [{ type: "text", text: "第二次输入" }],
        },
      }),
      includeProcess: true,
      includeFinal: true,
      response: createResponseStub(),
    })

    const continuedSession = await harness.managedSessionService.getSession(sessionId)

    assert.deepEqual(seenPiSessionFiles, [undefined, "test-sessions/persisted.jsonl"])
    assert.equal(continuedSession?.piSessionFile, "test-sessions/persisted.jsonl")
  } finally {
    await harness.close()
  }
})

test("managed session service stores the full assistant transcript from streamed deltas", async () => {
  const processContent: DemoContentItem[] = [
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
  ]
  const harness = await createTestControlPlane({
    executorFactory: ({ transcriptsRoot }) =>
      createTranscriptBackedExecutor({
        transcriptsRoot,
        processContent,
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
  const userId = harness.developmentUser.userId

  try {
    await harness.managedSessionService.createSession({
      request: parseCreateSessionRequestDto({
        providerConfigId: harness.defaultProviderConfig.providerConfigId,
        input: {
          content: [{ type: "text", text: "介绍下你自己。" }],
        },
      }),
      userId,
      includeProcess: true,
      includeFinal: true,
      response: createResponseStub(),
    })

    const sessionId = (
      await harness.managedSessionService.listUserSessions(userId)
    ).items[0]!.sessionId
    const session = await harness.managedSessionService.getSession(sessionId)
    const assistantContent = session?.entries.at(-1)?.content[0]

    assert.equal(
      assistantContent?.type === "text" ? assistantContent.text : "",
      "介绍下你自己。",
    )
    assert.deepEqual(session?.entries[1]?.content, processContent)
  } finally {
    await harness.close()
  }
})

test("managed session service records worker failures into audit and error status", async () => {
  const harness = await createTestControlPlane({
    executor: {
      async *run() {
        throw new Error("runtime exploded")
      },
    },
  })
  const userId = harness.developmentUser.userId

  try {
    await harness.managedSessionService.createSession({
      request: parseCreateSessionRequestDto({
        providerConfigId: harness.defaultProviderConfig.providerConfigId,
        input: {
          content: [{ type: "text", text: "触发失败" }],
        },
      }),
      userId,
      includeProcess: true,
      includeFinal: true,
      response: createResponseStub(),
    })

    const sessionId = (
      await harness.managedSessionService.listUserSessions(userId)
    ).items[0]!.sessionId
    const session = await harness.managedSessionService.getSession(sessionId)

    assert.equal(session?.status, "error")
    assert.deepEqual((await harness.auditService.list()).map((item) => item.action), [
      "session.created",
      "session.run_failed",
    ])
  } finally {
    await harness.close()
  }
})

test("managed session service treats streamed run.failed events as execution failures", async () => {
  const harness = await createTestControlPlane({
    executor: {
      async *run() {
        yield {
          type: "run.failed",
          data: {
            sessionId: "sess_failed",
            entryId: "entry_final",
            parentId: "entry_process",
            code: "execution_error",
            message: "sandbox exploded",
          },
        }

        return {}
      },
    },
  })
  const userId = harness.developmentUser.userId

  try {
    await harness.managedSessionService.createSession({
      request: parseCreateSessionRequestDto({
        providerConfigId: harness.defaultProviderConfig.providerConfigId,
        input: {
          content: [{ type: "text", text: "触发 sandbox 失败" }],
        },
      }),
      userId,
      includeProcess: true,
      includeFinal: true,
      response: createResponseStub(),
    })

    const sessionId = (await harness.managedSessionService.listUserSessions(userId)).items[0]!.sessionId
    const session = await harness.managedSessionService.getSession(sessionId)

    assert.equal(session?.status, "error")
    assert.deepEqual((await harness.auditService.list()).map((item) => item.action), [
      "session.created",
      "session.run_failed",
    ])
  } finally {
    await harness.close()
  }
})

test("managed session service emits run.cancelled and closes the run as idle", async () => {
  const harness = await createTestControlPlane({
    executor: {
      async *run() {
        await new Promise((resolve) => setTimeout(resolve, 50))
        yield {
          type: "final.output.delta",
          data: {
            sessionId: "sess_unused",
            entryId: "entry_unused",
            parentId: "entry_process",
            text: "should not be observed",
          },
        }
        yield {
          type: "final.output.completed",
          data: {
            sessionId: "sess_unused",
            entryId: "entry_unused",
          },
        }

        return {}
      },
    },
  })
  const userId = harness.developmentUser.userId

  try {
    const createPromise = harness.managedSessionService.createSession({
      request: parseCreateSessionRequestDto({
        providerConfigId: harness.defaultProviderConfig.providerConfigId,
        input: {
          content: [{ type: "text", text: "请取消当前执行" }],
        },
      }),
      userId,
      includeProcess: true,
      includeFinal: true,
      response: createResponseStub(),
    })

    await new Promise((resolve) => setTimeout(resolve, 5))

    const sessionId = (
      await harness.managedSessionService.listUserSessions(userId)
    ).items[0]!.sessionId
    assert.equal(await harness.managedSessionService.cancelSession(sessionId), true)

    await createPromise

    const session = await harness.managedSessionService.getSession(sessionId)

    assert.equal(session?.status, "idle")
    assert.deepEqual((await harness.auditService.list()).map((item) => item.action), [
      "session.created",
      "session.run_cancelled",
    ])
  } finally {
    await harness.close()
  }
})

test("managed session service persists failed tool calls in the process transcript", async () => {
  const processContent: DemoContentItem[] = [
    {
      type: "tool_call",
      toolCallId: "tool_call_1",
      toolName: "read_workspace",
      status: "error",
      arguments: '{"path":"."}',
      error: "permission denied",
    },
  ]
  const harness = await createTestControlPlane({
    executorFactory: ({ transcriptsRoot }) =>
      createTranscriptBackedExecutor({
        transcriptsRoot,
        processContent,
        assistantText: "工具调用失败。",
        additionalEvents: [
          {
            type: "action.failed",
            data: {
              toolCallId: "tool_call_1",
              name: "read_workspace",
              arguments: '{"path":"."}',
              error: "permission denied",
            },
          },
        ],
      }),
  })
  const userId = harness.developmentUser.userId

  try {
    await harness.managedSessionService.createSession({
      request: parseCreateSessionRequestDto({
        providerConfigId: harness.defaultProviderConfig.providerConfigId,
        input: {
          content: [{ type: "text", text: "模拟失败工具调用" }],
        },
      }),
      userId,
      includeProcess: true,
      includeFinal: true,
      response: createResponseStub(),
    })

    const sessionId = (
      await harness.managedSessionService.listUserSessions(userId)
    ).items[0]!.sessionId
    const processEntry = (await harness.managedSessionService.getSession(sessionId))
      ?.entries[1]

    assert.deepEqual(processEntry?.content, processContent)
  } finally {
    await harness.close()
  }
})

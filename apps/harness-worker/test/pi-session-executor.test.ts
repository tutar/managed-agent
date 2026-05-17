/**
 * Tests for the pi-backed session executor recovery path.
 */
import assert from "node:assert/strict"
import test from "node:test"

import { createPiSessionExecutor } from "../src/runtime/pi-session-executor.js"

const createJob = (piSessionFile?: string) => {
  return {
    sessionId: "sess_pi",
    model: "provider/model",
    thinkingLevel: "medium",
    piSessionFile,
    input: {
      content: [{ type: "text" as const, text: "继续执行" }],
    },
    userEntry: {
      id: "entry_user",
      parentId: null,
      createdAt: "2026-05-16T12:10:00.000Z",
      messageType: "user" as const,
      content: [{ type: "text" as const, text: "继续执行" }],
      input: {
        content: [{ type: "text" as const, text: "继续执行" }],
      },
    },
    processEntryId: "entry_process",
    finalEntryId: "entry_final",
  }
}

test("pi session executor creates a new session manager when no piSessionFile exists", async () => {
  let createCalled = false
  let openCalled = false
  let ensuredSessionDir: string | undefined

  const executor = createPiSessionExecutor({
    createAuthStorage() {
      return {} as never
    },
    createModelRegistry() {
      return {
        find() {
          return undefined
        },
      } as never
    },
    ensureSessionDir(sessionDir) {
      ensuredSessionDir = sessionDir
      return Promise.resolve()
    },
    openSessionManager() {
      openCalled = true
      return { sessionFile: "opened.jsonl" }
    },
    createSessionManager() {
      createCalled = true
      return { sessionFile: "created.jsonl" }
    },
    async createSession() {
      return {
        session: {
          sessionFile: "created.jsonl",
          state: { messages: [] },
          subscribe() {
            return () => undefined
          },
          prompt() {
            return Promise.resolve()
          },
          dispose() {
            return undefined
          },
        },
      }
    },
    getCwd() {
      return "/tmp/managed-agent"
    },
  })

  const iterator = executor.run(createJob())
  let completion = await iterator.next()
  while (!completion.done) {
    completion = await iterator.next()
  }

  assert.equal(createCalled, true)
  assert.equal(openCalled, false)
  assert.equal(ensuredSessionDir, "/mnt/transcripts/pi-sessions")
  assert.equal(completion.value.piSessionFile, "created.jsonl")
})

test("pi session executor derives the transcript session path from MANAGED_AGENT_MOUNT_ROOT", async () => {
  const previousMountRoot = process.env.MANAGED_AGENT_MOUNT_ROOT
  let ensuredSessionDir: string | undefined

  process.env.MANAGED_AGENT_MOUNT_ROOT = "/tmp/managed-agent-mount"

  try {
    const executor = createPiSessionExecutor({
      createAuthStorage() {
        return {} as never
      },
      createModelRegistry() {
        return {
          find() {
            return undefined
          },
        } as never
      },
      ensureSessionDir(sessionDir) {
        ensuredSessionDir = sessionDir
        return Promise.resolve()
      },
      openSessionManager() {
        return { sessionFile: "opened.jsonl" }
      },
      createSessionManager() {
        return { sessionFile: "created.jsonl" }
      },
      async createSession() {
        return {
          session: {
            sessionFile: "created.jsonl",
            state: { messages: [] },
            subscribe() {
              return () => undefined
            },
            prompt() {
              return Promise.resolve()
            },
            dispose() {
              return undefined
            },
          },
        }
      },
      getCwd() {
        return "/tmp/ignored-cwd"
      },
    })

    const iterator = executor.run(createJob())
    let completion = await iterator.next()
    while (!completion.done) {
      completion = await iterator.next()
    }

    assert.equal(
      ensuredSessionDir,
      "/tmp/managed-agent-mount/transcripts/pi-sessions",
    )
  } finally {
    if (previousMountRoot === undefined) {
      delete process.env.MANAGED_AGENT_MOUNT_ROOT
    } else {
      process.env.MANAGED_AGENT_MOUNT_ROOT = previousMountRoot
    }
  }
})

test("pi session executor reopens an existing session manager when piSessionFile exists", async () => {
  let createCalled = false
  let openCalled = false
  let openedFile: string | undefined

  const executor = createPiSessionExecutor({
    createAuthStorage() {
      return {} as never
    },
    createModelRegistry() {
      return {
        find() {
          return undefined
        },
      } as never
    },
    ensureSessionDir() {
      return Promise.resolve()
    },
    openSessionManager(piSessionFile) {
      openCalled = true
      openedFile = piSessionFile
      return { sessionFile: piSessionFile }
    },
    createSessionManager() {
      createCalled = true
      return { sessionFile: "created.jsonl" }
    },
    async createSession() {
      return {
        session: {
          sessionFile: "persisted.jsonl",
          state: {
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: "final text" }],
              },
            ],
          },
          subscribe(listener) {
            listener({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                delta: "final text",
              },
            } as never)
            return () => undefined
          },
          prompt() {
            return Promise.resolve()
          },
          dispose() {
            return undefined
          },
        },
      }
    },
    getCwd() {
      return "/tmp/managed-agent"
    },
  })

  const iterator = executor.run(createJob("persisted.jsonl"))
  const eventTypes: string[] = []
  let completion = await iterator.next()
  while (!completion.done) {
    eventTypes.push(completion.value.type)
    completion = await iterator.next()
  }

  assert.equal(createCalled, false)
  assert.equal(openCalled, true)
  assert.equal(openedFile, "persisted.jsonl")
  assert.equal(completion.value.piSessionFile, "persisted.jsonl")
  assert.deepEqual(eventTypes, [
    "process.delta",
    "final.output.delta",
    "final.output.completed",
  ])
})

test("pi session executor normalizes overlapping text chunks into append-only deltas", async () => {
  const executor = createPiSessionExecutor({
    createAuthStorage() {
      return {} as never
    },
    createModelRegistry() {
      return {
        find() {
          return undefined
        },
      } as never
    },
    ensureSessionDir() {
      return Promise.resolve()
    },
    openSessionManager(piSessionFile) {
      return { sessionFile: piSessionFile }
    },
    createSessionManager() {
      return { sessionFile: "created.jsonl" }
    },
    async createSession() {
      return {
        session: {
          sessionFile: "persisted.jsonl",
          state: {
            messages: [
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: "我的知识截止日期是 **2025 年 4 月初**。",
                  },
                ],
              },
            ],
          },
          subscribe(listener) {
            listener({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                delta: "我的知识",
              },
            } as never)
            listener({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                delta: "知识截止",
              },
            } as never)
            listener({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                delta: "截止日期是",
              },
            } as never)
            listener({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                delta: "日期是 **2025",
              },
            } as never)
            listener({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                delta: "2025 年 4 月初**。",
              },
            } as never)
            return () => undefined
          },
          prompt() {
            return Promise.resolve()
          },
          dispose() {
            return undefined
          },
        },
      }
    },
    getCwd() {
      return "/tmp/managed-agent"
    },
  })

  const iterator = executor.run(createJob("persisted.jsonl"))
  const textDeltas: string[] = []
  let completion = await iterator.next()
  while (!completion.done) {
    if (completion.value.type === "final.output.delta") {
      textDeltas.push(completion.value.data.text)
    }
    completion = await iterator.next()
  }

  assert.deepEqual(textDeltas, [
    "我的知识",
    "截止",
    "日期是",
    " **2025",
    " 年 4 月初**。",
  ])
})

test("pi session executor only emits the missing suffix when finalText extends streamed text", async () => {
  const executor = createPiSessionExecutor({
    createAuthStorage() {
      return {} as never
    },
    createModelRegistry() {
      return {
        find() {
          return undefined
        },
      } as never
    },
    ensureSessionDir() {
      return Promise.resolve()
    },
    openSessionManager(piSessionFile) {
      return { sessionFile: piSessionFile }
    },
    createSessionManager() {
      return { sessionFile: "created.jsonl" }
    },
    async createSession() {
      return {
        session: {
          sessionFile: "persisted.jsonl",
          state: {
            messages: [
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: '就我所知，DeepSeek 没有公开发布过 "V4" 版本。',
                  },
                ],
              },
            ],
          },
          subscribe(listener) {
            listener({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                delta: "就我所知，DeepSeek 没有",
              },
            } as never)
            return () => undefined
          },
          prompt() {
            return Promise.resolve()
          },
          dispose() {
            return undefined
          },
        },
      }
    },
    getCwd() {
      return "/tmp/managed-agent"
    },
  })

  const iterator = executor.run(createJob("persisted.jsonl"))
  const textDeltas: string[] = []
  let completion = await iterator.next()
  while (!completion.done) {
    if (completion.value.type === "final.output.delta") {
      textDeltas.push(completion.value.data.text)
    }
    completion = await iterator.next()
  }

  assert.deepEqual(textDeltas, [
    "就我所知，DeepSeek 没有",
    '公开发布过 "V4" 版本。',
  ])
})

test("pi session executor derives append-only output from partial assistant snapshots", async () => {
  const executor = createPiSessionExecutor({
    createAuthStorage() {
      return {} as never
    },
    createModelRegistry() {
      return {
        find() {
          return undefined
        },
      } as never
    },
    ensureSessionDir() {
      return Promise.resolve()
    },
    openSessionManager(piSessionFile) {
      return { sessionFile: piSessionFile }
    },
    createSessionManager() {
      return { sessionFile: "created.jsonl" }
    },
    async createSession() {
      return {
        session: {
          sessionFile: "persisted.jsonl",
          state: {
            messages: [
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: "DeepSeek V4 是新一代模型。",
                  },
                ],
              },
            ],
          },
          subscribe(listener) {
            listener({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                delta: "Deep",
                partial: {
                  content: [{ type: "text", text: "Deep" }],
                },
              },
            } as never)
            listener({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                delta: "Se",
                partial: {
                  content: [{ type: "text", text: "DeepSe" }],
                },
              },
            } as never)
            listener({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                delta: "k V",
                partial: {
                  content: [{ type: "text", text: "DeepSeek V" }],
                },
              },
            } as never)
            listener({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                delta: "4 是",
                partial: {
                  content: [{ type: "text", text: "DeepSeek V4 是" }],
                },
              },
            } as never)
            listener({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                delta: "新一代模型。",
                partial: {
                  content: [{ type: "text", text: "DeepSeek V4 是新一代模型。" }],
                },
              },
            } as never)
            return () => undefined
          },
          prompt() {
            return Promise.resolve()
          },
          dispose() {
            return undefined
          },
        },
      }
    },
    getCwd() {
      return "/tmp/managed-agent"
    },
  })

  const iterator = executor.run(createJob("persisted.jsonl"))
  const textDeltas: string[] = []
  let completion = await iterator.next()
  while (!completion.done) {
    if (completion.value.type === "final.output.delta") {
      textDeltas.push(completion.value.data.text)
    }
    completion = await iterator.next()
  }

  assert.deepEqual(textDeltas, [
    "Deep",
    "Se",
    "ek V",
    "4 是",
    "新一代模型。",
  ])
})

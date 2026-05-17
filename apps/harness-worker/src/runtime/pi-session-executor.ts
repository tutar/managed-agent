import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import {
  type AgentSessionEvent,
  AuthStorage,
  createAgentSession,
  type ModelCycleResult,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent"

import type {
  SessionExecutor,
  SessionRunCompletion,
  SessionRunEvent,
  SessionRunJob,
} from "../jobs/session-run-job.js"
import { resolveManagedAgentMountPaths } from "./mount-paths.js"

type SessionLike = {
  sessionFile?: string
  state: {
    messages: unknown[]
  }
  subscribe(listener: (event: AgentSessionEvent) => void): () => void
  prompt(input: string): Promise<void>
  dispose(): void
}

type PiSessionExecutorDependencies = {
  createAuthStorage(): ReturnType<typeof AuthStorage.create>
  createModelRegistry(
    authStorage: ReturnType<typeof AuthStorage.create>,
  ): ReturnType<typeof ModelRegistry.create>
  ensureSessionDir(sessionDir: string): Promise<unknown>
  openSessionManager(
    piSessionFile: string,
    sessionDir: string,
    cwd: string,
  ): unknown
  createSessionManager(cwd: string, sessionDir: string): unknown
  createSession(input: {
    cwd: string
    authStorage: ReturnType<typeof AuthStorage.create>
    modelRegistry: ReturnType<typeof ModelRegistry.create>
    model: ReturnType<ReturnType<typeof ModelRegistry.create>["find"]>
    thinkingLevel: ModelCycleResult["thinkingLevel"]
    sessionManager: unknown
  }): Promise<{ session: SessionLike }>
  getCwd(): string
}

/**
 * pi-backed worker executor.
 *
 * This path is responsible for reopening durable pi sessions when the control
 * plane already has a persisted `piSessionFile`. It keeps the recovery seam
 * explicit so the API and worker integration can be validated before moving to
 * a separate worker transport or database-backed scheduler.
 */
const parseRequestedModel = (
  value: string,
): { provider: string; modelId: string } | null => {
  const [provider, ...rest] = value.split("/")

  if (!provider || rest.length === 0) {
    return null
  }

  return {
    provider,
    modelId: rest.join("/"),
  }
}

const hasTextContent = (
  value: unknown,
): value is { type: "text"; text: string } => {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "text" &&
    "text" in value &&
    typeof value.text === "string"
  )
}

const hasPartialAssistantText = (
  value: unknown,
): value is {
  partial: {
    content?: unknown
  }
} => {
  return (
    typeof value === "object" &&
    value !== null &&
    "partial" in value &&
    typeof value.partial === "object" &&
    value.partial !== null
  )
}

const hasAssistantRole = (
  value: unknown,
): value is { role: "assistant"; content?: unknown } => {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    value.role === "assistant"
  )
}

const readFinalAssistantText = (messages: unknown[]) => {
  const assistantMessages = messages.filter(hasAssistantRole)
  const lastAssistant = assistantMessages.at(-1)

  if (!lastAssistant || !Array.isArray(lastAssistant.content)) {
    return ""
  }

  return lastAssistant.content
    .filter(hasTextContent)
    .map((item) => item.text)
    .join("")
}

const readPartialAssistantText = (value: unknown) => {
  if (
    !hasPartialAssistantText(value) ||
    !Array.isArray(value.partial.content)
  ) {
    return ""
  }

  return value.partial.content
    .filter(hasTextContent)
    .map((item) => item.text)
    .join("")
}

const readToolCallId = (event: AgentSessionEvent, fallback: string) => {
  if (
    "toolCallId" in event &&
    typeof event.toolCallId === "string" &&
    event.toolCallId.length > 0
  ) {
    return event.toolCallId
  }

  return fallback
}

const toStructuredText = (value: unknown) => {
  if (typeof value === "string") {
    return value
  }

  return JSON.stringify(value)
}

/**
 * Normalize provider-emitted text chunks into a true append-only suffix.
 *
 * Some providers emit overlapping or cumulative fragments instead of strict
 * token deltas. The managed-agent SSE contract, however, requires each
 * `final.output.delta` frame to be append-only so downstream consumers do not
 * need transport-level deduplication.
 */
const toAppendOnlyDelta = (accumulatedText: string, incomingText: string) => {
  if (incomingText.length === 0) {
    return ""
  }

  if (accumulatedText.length === 0) {
    return incomingText
  }

  if (incomingText.startsWith(accumulatedText)) {
    return incomingText.slice(accumulatedText.length)
  }

  if (accumulatedText.endsWith(incomingText)) {
    return ""
  }

  const maxOverlapLength = Math.min(accumulatedText.length, incomingText.length)

  for (
    let overlapLength = maxOverlapLength;
    overlapLength > 0;
    overlapLength -= 1
  ) {
    if (accumulatedText.endsWith(incomingText.slice(0, overlapLength))) {
      return incomingText.slice(overlapLength)
    }
  }

  return incomingText
}

const createDefaultDependencies = (): PiSessionExecutorDependencies => {
  return {
    createAuthStorage() {
      return AuthStorage.create()
    },
    createModelRegistry(authStorage) {
      return ModelRegistry.create(authStorage)
    },
    ensureSessionDir(sessionDir) {
      return mkdir(sessionDir, { recursive: true })
    },
    openSessionManager(piSessionFile, sessionDir, cwd) {
      return SessionManager.open(piSessionFile, sessionDir, cwd)
    },
    createSessionManager(cwd, sessionDir) {
      return SessionManager.create(cwd, sessionDir)
    },
    createSession(input) {
      return createAgentSession({
        cwd: input.cwd,
        authStorage: input.authStorage,
        modelRegistry: input.modelRegistry,
        model: input.model,
        thinkingLevel: input.thinkingLevel,
        sessionManager: input.sessionManager as SessionManager,
      })
    },
    getCwd() {
      return process.cwd()
    },
  }
}

/**
 * Create the smallest real pi runtime adapter we can use during scaffold stage.
 *
 * If the requested model cannot be resolved from the local pi registry, the
 * session falls back to pi defaults. Consumers should treat this as a runtime
 * recovery slice, not as the final production worker contract.
 */
export const createPiSessionExecutor = (
  dependencies: PiSessionExecutorDependencies = createDefaultDependencies(),
): SessionExecutor => {
  return {
    async *run(
      job: SessionRunJob,
    ): AsyncGenerator<SessionRunEvent, SessionRunCompletion> {
      const cwd = dependencies.getCwd()
      const authStorage = dependencies.createAuthStorage()
      const modelRegistry = dependencies.createModelRegistry(authStorage)
      const parsedModel = parseRequestedModel(job.model)
      const selectedModel = parsedModel
        ? modelRegistry.find(parsedModel.provider, parsedModel.modelId)
        : undefined
      const sessionDir = join(
        resolveManagedAgentMountPaths().transcriptsRoot,
        "pi-sessions",
      )
      await dependencies.ensureSessionDir(sessionDir)
      const sessionManager = job.piSessionFile
        ? dependencies.openSessionManager(job.piSessionFile, sessionDir, cwd)
        : dependencies.createSessionManager(cwd, sessionDir)

      const { session } = await dependencies.createSession({
        cwd,
        authStorage,
        modelRegistry,
        model: selectedModel,
        thinkingLevel: job.thinkingLevel as ModelCycleResult["thinkingLevel"],
        sessionManager,
      })

      const bufferedEvents: SessionRunEvent[] = []
      let streamedFinalText = ""
      let nextToolCallIndex = 1
      const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent.type === "text_delta"
        ) {
          /**
           * Provider `delta` payloads are not guaranteed to be strict append-only
           * tokens. DeepSeek can emit corrective or overlapping fragments while
           * `partial` still carries the authoritative assistant text snapshot.
           * We therefore derive SSE output from the growing `partial` text, not
           * from the raw `delta`, so web clients receive one append-only stream.
           */
          const partialAssistantText = readPartialAssistantText(
            event.assistantMessageEvent,
          )
          const normalizedDelta = toAppendOnlyDelta(
            streamedFinalText,
            partialAssistantText.length > 0
              ? partialAssistantText
              : event.assistantMessageEvent.delta,
          )

          if (normalizedDelta.length === 0) {
            return
          }

          streamedFinalText += normalizedDelta
          bufferedEvents.push({
            type: "final.output.delta",
            data: {
              sessionId: job.sessionId,
              entryId: job.finalEntryId,
              parentId: job.processEntryId,
              text: normalizedDelta,
            },
          })
        }

        if (event.type === "tool_execution_start") {
          const toolCallId = readToolCallId(
            event,
            `tool_call_${nextToolCallIndex++}`,
          )
          bufferedEvents.push({
            type: "action.started",
            data: {
              sessionId: job.sessionId,
              entryId: job.processEntryId,
              parentId: job.userEntry.id,
              toolCallId,
              name: event.toolName,
              arguments:
                "params" in event ? toStructuredText(event.params) : undefined,
            },
          })
        }

        if (event.type === "tool_execution_end") {
          const toolCallId = readToolCallId(
            event,
            `tool_call_${nextToolCallIndex++}`,
          )
          bufferedEvents.push({
            type: "action.completed",
            data: {
              sessionId: job.sessionId,
              entryId: job.processEntryId,
              parentId: job.userEntry.id,
              toolCallId,
              name: event.toolName,
              arguments:
                "params" in event ? toStructuredText(event.params) : undefined,
              result:
                "result" in event ? toStructuredText(event.result) : undefined,
            },
          })
        }
      })

      try {
        const promptText =
          job.input.content.find((item) => item.type === "text")?.text ??
          "Describe the input."

        yield {
          type: "process.delta",
          data: {
            sessionId: job.sessionId,
            entryId: job.processEntryId,
            parentId: job.userEntry.id,
            text: "pi runtime 已接管当前请求。",
          },
        }

        await session.prompt(promptText)

        for (const event of bufferedEvents) {
          yield event
        }

        const finalText = readFinalAssistantText(session.state.messages)

        const trailingDelta = toAppendOnlyDelta(streamedFinalText, finalText)

        if (trailingDelta.length > 0) {
          yield {
            type: "final.output.delta",
            data: {
              sessionId: job.sessionId,
              entryId: job.finalEntryId,
              parentId: job.processEntryId,
              text: trailingDelta,
            },
          }
        }

        yield {
          type: "final.output.completed",
          data: {
            sessionId: job.sessionId,
            entryId: job.finalEntryId,
          },
        }

        return {
          piSessionFile: session.sessionFile,
        }
      } finally {
        unsubscribe()
        session.dispose()
      }
    },
  }
}

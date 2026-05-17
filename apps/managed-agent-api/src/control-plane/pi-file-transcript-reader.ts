import { readFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

import type {
  DemoContentItem,
  InputContentItem,
  SessionEntry,
} from "./entry-factory.js"
import { resolveManagedAgentMountPaths } from "./mount-paths.js"
import type {
  TranscriptReader,
  TranscriptReadInput,
} from "./transcript-reader.js"

type PiSessionJsonlRecord =
  | {
      type: "session" | "model_change" | "thinking_level_change"
      id?: string
      parentId?: string | null
      timestamp?: string
    }
  | {
      type: "message"
      id: string
      parentId: string | null
      timestamp: string
      message: {
        role: "user" | "assistant" | "toolResult"
        content?: unknown[]
        timestamp?: number
        toolCallId?: string
        toolName?: string
        isError?: boolean
      }
      stopReason?: string
    }

type ManagedTranscriptRecord =
  | {
      type: "managed_session"
      sessionId: string
      runtime: "mock"
      timestamp?: string
    }
  | {
      type: "managed_entry"
      sessionId: string
      entry: {
        id: string
        parentId: string | null
        createdAt: string
        messageType: "user" | "process" | "assistant"
        content?: unknown[]
        input?: {
          content?: unknown[]
        }
      }
    }

type PiContentItem =
  | {
      type: "text"
      text: string
    }
  | {
      type: "image" | "video"
      url: string
    }
  | {
      type: "thinking"
      thinking: string
    }
  | {
      type: "toolCall"
      id: string
      name: string
      arguments?: unknown
    }

type ManagedToolCallItem = {
  type: "tool_call"
  toolCallId: string
  toolName: string
  status: "started" | "completed" | "error"
  arguments?: string
  result?: string
  error?: string
}

type ManagedTextItem = {
  type: "text"
  text: string
}

const hasObjectShape = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null
}

const isManagedTextItem = (value: unknown): value is ManagedTextItem => {
  return (
    hasObjectShape(value) &&
    value.type === "text" &&
    typeof value.text === "string"
  )
}

const isManagedToolCallItem = (
  value: unknown,
): value is ManagedToolCallItem => {
  return (
    hasObjectShape(value) &&
    value.type === "tool_call" &&
    typeof value.toolCallId === "string" &&
    typeof value.toolName === "string" &&
    (value.status === "started" ||
      value.status === "completed" ||
      value.status === "error")
  )
}

const isPiContentItem = (value: unknown): value is PiContentItem => {
  if (!hasObjectShape(value) || typeof value.type !== "string") {
    return false
  }

  if (value.type === "text" && typeof value.text === "string") {
    return true
  }

  if (
    (value.type === "image" || value.type === "video") &&
    typeof value.url === "string"
  ) {
    return true
  }

  if (value.type === "thinking" && typeof value.thinking === "string") {
    return true
  }

  if (
    value.type === "toolCall" &&
    typeof value.id === "string" &&
    typeof value.name === "string"
  ) {
    return true
  }

  return false
}

const isPiMessageRecord = (
  value: unknown,
): value is Extract<PiSessionJsonlRecord, { type: "message" }> => {
  return (
    hasObjectShape(value) &&
    value.type === "message" &&
    typeof value.id === "string" &&
    "message" in value &&
    hasObjectShape(value.message) &&
    (value.parentId === null || typeof value.parentId === "string") &&
    typeof value.timestamp === "string" &&
    (value.message.role === "user" ||
      value.message.role === "assistant" ||
      value.message.role === "toolResult")
  )
}

const isManagedTranscriptRecord = (
  value: unknown,
): value is ManagedTranscriptRecord => {
  return (
    hasObjectShape(value) &&
    ((value.type === "managed_session" &&
      typeof value.sessionId === "string" &&
      value.runtime === "mock") ||
      (value.type === "managed_entry" &&
        typeof value.sessionId === "string" &&
        "entry" in value &&
        hasObjectShape(value.entry) &&
        typeof value.entry.id === "string" &&
        (value.entry.parentId === null ||
          typeof value.entry.parentId === "string") &&
        typeof value.entry.createdAt === "string" &&
        (value.entry.messageType === "user" ||
          value.entry.messageType === "process" ||
          value.entry.messageType === "assistant")))
  )
}

const toCreatedAt = (
  record: Extract<PiSessionJsonlRecord, { type: "message" }>,
) => {
  if (typeof record.message.timestamp === "number") {
    return new Date(record.message.timestamp).toISOString()
  }

  return record.timestamp
}

const toUserContent = (content: unknown[]): InputContentItem[] => {
  const normalizedContent: InputContentItem[] = []

  for (const item of content) {
    if (!isPiContentItem(item)) {
      continue
    }

    if (item.type === "text") {
      normalizedContent.push({ type: "text", text: item.text })
      continue
    }

    if (item.type === "image" || item.type === "video") {
      normalizedContent.push({ type: item.type, url: item.url })
    }
  }

  return normalizedContent
}

const toProcessContent = (content: unknown[]): DemoContentItem[] => {
  return content.flatMap((item) => {
    if (!isPiContentItem(item) || item.type !== "thinking") {
      return []
    }

    return [{ type: "text", text: item.thinking }]
  })
}

const toAssistantText = (content: unknown[]) => {
  return content
    .flatMap((item) => {
      if (!isPiContentItem(item) || item.type !== "text") {
        return []
      }

      return [item.text]
    })
    .join("")
}

const toAssistantPreamble = (content: unknown[]) => {
  const firstToolCallIndex = content.findIndex(
    (item) => isPiContentItem(item) && item.type === "toolCall",
  )
  const contentBeforeToolCalls =
    firstToolCallIndex >= 0 ? content.slice(0, firstToolCallIndex) : content

  return contentBeforeToolCalls
    .flatMap((item) => {
      if (!isPiContentItem(item) || item.type !== "text") {
        return []
      }

      return [item.text]
    })
    .join("")
}

const toToolCallContent = (content: unknown[]): DemoContentItem[] => {
  return content.flatMap((item) => {
    if (!isPiContentItem(item) || item.type !== "toolCall") {
      return []
    }

    return [
      {
        type: "tool_call" as const,
        toolCallId: item.id,
        toolName: item.name,
        status: "started" as const,
        ...(item.arguments !== undefined
          ? { arguments: JSON.stringify(item.arguments) }
          : {}),
      },
    ]
  })
}

const toToolResultText = (content: unknown[]) => {
  return content
    .flatMap((item) => {
      if (!isPiContentItem(item) || item.type !== "text") {
        return []
      }

      return [item.text]
    })
    .join("")
}

const resolveTranscriptPath = (
  piSessionFile: string,
  transcriptsRoot: string,
) => {
  if (isAbsolute(piSessionFile)) {
    return piSessionFile
  }

  return join(transcriptsRoot, piSessionFile)
}

const toManagedTranscriptContent = (content: unknown[]): DemoContentItem[] => {
  const normalizedContent: DemoContentItem[] = []

  for (const item of content) {
    if (isManagedTextItem(item)) {
      normalizedContent.push({ type: "text", text: item.text })
      continue
    }

    if (isManagedToolCallItem(item)) {
      normalizedContent.push({
        type: "tool_call",
        toolCallId: item.toolCallId,
        toolName: item.toolName,
        status: item.status,
        ...(item.arguments ? { arguments: item.arguments } : {}),
        ...(item.result ? { result: item.result } : {}),
        ...(item.error ? { error: item.error } : {}),
      })
    }
  }

  return normalizedContent
}

const toManagedUserInputContent = (content: unknown[]): InputContentItem[] => {
  return content.flatMap((item) => {
    if (!isManagedTextItem(item)) {
      return []
    }

    return [{ type: "text" as const, text: item.text }]
  })
}

/**
 * Read pi-managed JSONL transcript files and map them into platform entries.
 *
 * The API keeps control of the DTO shape, but it does not maintain an
 * independent transcript truth. This reader is the seam between pi's durable
 * session log and the platform-facing session detail API.
 */
export const createPiFileTranscriptReader = ({
  transcriptsRoot = resolveManagedAgentMountPaths().transcriptsRoot,
}: {
  transcriptsRoot?: string
} = {}): TranscriptReader => {
  return {
    async readSessionEntries({
      piSessionFile,
    }: TranscriptReadInput): Promise<SessionEntry[]> {
      if (!piSessionFile) {
        return []
      }

      const rawJsonl = await readFile(
        resolveTranscriptPath(piSessionFile, transcriptsRoot),
        "utf8",
      )
      const lines = rawJsonl
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      const entries: SessionEntry[] = []
      const platformEntryIdByPiMessageId = new Map<string, string>()
      const processEntryIdByPiMessageId = new Map<string, string>()
      const processEntryIndexById = new Map<string, number>()

      for (const line of lines) {
        const parsed = JSON.parse(line) as unknown

        if (
          isManagedTranscriptRecord(parsed) &&
          parsed.type === "managed_entry"
        ) {
          const content: DemoContentItem[] = Array.isArray(parsed.entry.content)
            ? toManagedTranscriptContent(parsed.entry.content)
            : []

          if (parsed.entry.messageType === "user") {
            entries.push({
              id: parsed.entry.id,
              parentId: parsed.entry.parentId,
              createdAt: parsed.entry.createdAt,
              messageType: "user",
              content,
              input: {
                content: toManagedUserInputContent(
                  Array.isArray(parsed.entry.input?.content)
                    ? parsed.entry.input.content
                    : (parsed.entry.content ?? []),
                ),
              },
            })
            continue
          }

          if (parsed.entry.messageType === "process") {
            if (parsed.entry.parentId === null) {
              continue
            }

            entries.push({
              id: parsed.entry.id,
              parentId: parsed.entry.parentId,
              createdAt: parsed.entry.createdAt,
              messageType: "process",
              content,
            })
            continue
          }

          if (parsed.entry.parentId === null) {
            continue
          }

          entries.push({
            id: parsed.entry.id,
            parentId: parsed.entry.parentId,
            createdAt: parsed.entry.createdAt,
            messageType: "assistant",
            content,
          })
          continue
        }

        if (!isPiMessageRecord(parsed)) {
          continue
        }

        const messageContent = Array.isArray(parsed.message.content)
          ? parsed.message.content
          : []
        const createdAt = toCreatedAt(parsed)

        if (parsed.message.role === "user") {
          const userEntryId = `pi_user_${parsed.id}`
          const parentId =
            parsed.parentId && platformEntryIdByPiMessageId.has(parsed.parentId)
              ? (platformEntryIdByPiMessageId.get(parsed.parentId) ?? null)
              : null
          const inputContent = toUserContent(messageContent)

          entries.push({
            id: userEntryId,
            parentId,
            createdAt,
            messageType: "user",
            content: inputContent,
            input: {
              content: inputContent,
            },
          })
          platformEntryIdByPiMessageId.set(parsed.id, userEntryId)
          continue
        }

        if (parsed.message.role === "toolResult") {
          if (!parsed.parentId) {
            continue
          }

          const processEntryId = processEntryIdByPiMessageId.get(
            parsed.parentId,
          )

          if (!processEntryId) {
            continue
          }

          const processEntryIndex = processEntryIndexById.get(processEntryId)

          if (processEntryIndex === undefined) {
            continue
          }

          const processEntry = entries[processEntryIndex]

          if (!processEntry || processEntry.messageType !== "process") {
            continue
          }

          processEntry.content.push({
            type: "tool_call",
            toolCallId: parsed.message.toolCallId ?? parsed.id,
            toolName: parsed.message.toolName ?? "tool",
            status: parsed.message.isError ? "error" : "completed",
            result: toToolResultText(messageContent),
          })
          processEntryIdByPiMessageId.set(parsed.id, processEntryId)
          continue
        }

        const userParentId =
          parsed.parentId && platformEntryIdByPiMessageId.has(parsed.parentId)
            ? (platformEntryIdByPiMessageId.get(parsed.parentId) ?? null)
            : null
        const chainedProcessEntryId = parsed.parentId
          ? processEntryIdByPiMessageId.get(parsed.parentId)
          : undefined
        const processEntryId = `pi_process_${parsed.id}`
        const assistantEntryId = `pi_assistant_${parsed.id}`

        if (parsed.stopReason === "toolUse") {
          const processContent = [...toProcessContent(messageContent)]
          const assistantPreamble = toAssistantPreamble(messageContent)

          if (assistantPreamble.length > 0) {
            processContent.push({
              type: "text",
              text: assistantPreamble,
            })
          }

          processContent.push(...toToolCallContent(messageContent))
          entries.push({
            id: processEntryId,
            parentId:
              typeof userParentId === "string"
                ? userParentId
                : `pi_orphan_${parsed.id}`,
            createdAt,
            messageType: "process",
            content: processContent,
          })
          processEntryIdByPiMessageId.set(parsed.id, processEntryId)
          processEntryIndexById.set(processEntryId, entries.length - 1)
          continue
        }

        if (chainedProcessEntryId) {
          entries.push({
            id: assistantEntryId,
            parentId: chainedProcessEntryId,
            createdAt,
            messageType: "assistant",
            content: [
              {
                type: "text",
                text: toAssistantText(messageContent),
              },
            ],
          })
          platformEntryIdByPiMessageId.set(parsed.id, assistantEntryId)
          continue
        }

        entries.push({
          id: processEntryId,
          parentId:
            typeof userParentId === "string"
              ? userParentId
              : `pi_orphan_${parsed.id}`,
          createdAt,
          messageType: "process",
          content: toProcessContent(messageContent),
        })
        processEntryIndexById.set(processEntryId, entries.length - 1)
        entries.push({
          id: assistantEntryId,
          parentId: processEntryId,
          createdAt,
          messageType: "assistant",
          content: [
            {
              type: "text",
              text: toAssistantText(messageContent),
            },
          ],
        })
        platformEntryIdByPiMessageId.set(parsed.id, assistantEntryId)
      }

      return entries.filter((entry) => {
        if (entry.messageType === "process") {
          return !entry.parentId.startsWith("pi_orphan_")
        }

        return true
      })
    },
  }
}

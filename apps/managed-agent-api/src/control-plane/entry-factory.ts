import { randomUUID } from "node:crypto"

/**
 * Transcript entry constructors for the local session model.
 *
 * Keeping entry creation centralized preserves the parent/child structure the
 * API returns and makes later migration to durable transcript storage safer.
 */
export type TextContentItem = {
  type: "text"
  text: string
}

export type MediaContentItem = {
  type: "image" | "video"
  url: string
}

export type ToolCallContentItem = {
  type: "tool_call"
  toolCallId: string
  toolName: string
  status: "started" | "completed" | "error"
  arguments?: string
  result?: string
  error?: string
}

export type InputContentItem = TextContentItem | MediaContentItem

/**
 * Transcript content items returned to frontend clients.
 *
 * The response model already needs more than plain text because `GET /sessions`
 * must be able to rehydrate process/tool activity after the original SSE stream
 * has finished.
 */
export type DemoContentItem =
  | TextContentItem
  | MediaContentItem
  | ToolCallContentItem

export type DemoInput = {
  content: InputContentItem[]
}

type BaseEntry = {
  id: string
  parentId: string | null
  createdAt: string
}

export type UserEntry = {
  messageType: "user"
  content: DemoContentItem[]
  input: DemoInput
} & BaseEntry

export type ProcessEntry = {
  messageType: "process"
  content: DemoContentItem[]
} & BaseEntry & { parentId: string }

export type AssistantEntry = {
  messageType: "assistant"
  content: DemoContentItem[]
} & BaseEntry & { parentId: string }

export type SessionEntry = UserEntry | ProcessEntry | AssistantEntry

/**
 * Create process-stable unique ids for sessions and transcript nodes.
 *
 * Incrementing counters are not safe once metadata moves to PostgreSQL,
 * because process restarts would reuse primary keys and corrupt durable state.
 */
const createId = (prefix: string) => `${prefix}_${randomUUID()}`

/** Create the user-facing transcript entry that seeds a new execution chain. */
export const createUserEntry = (
  input: DemoInput,
  parentId: string | null,
  createdAt = new Date().toISOString(),
): UserEntry => {
  return {
    id: createId("entry"),
    parentId,
    createdAt,
    messageType: "user",
    content: input.content,
    input,
  }
}

/** Create the process node that hangs off the accepted user message. */
export const createProcessEntry = (
  parentId: string,
  content: DemoContentItem[] = [],
  createdAt = new Date().toISOString(),
): ProcessEntry => {
  return {
    id: createId("entry"),
    parentId,
    createdAt,
    messageType: "process",
    content,
  }
}

/** Create the final assistant node. Callers may pass an explicit id to preserve event linkage. */
export const createAssistantEntry = (
  parentId: string,
  text: string,
  id?: string,
  createdAt = new Date().toISOString(),
): AssistantEntry => {
  return {
    id: id ?? createId("entry"),
    parentId,
    createdAt,
    messageType: "assistant",
    content: [
      {
        type: "text",
        text,
      },
    ],
  }
}

export const createSessionId = () => createId("sess")

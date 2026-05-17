import { ValidationError } from "../api-channel/http-errors.js"
import type {
  DemoContentItem,
  InputContentItem,
  SessionEntry,
} from "../control-plane/entry-factory.js"
import type {
  SessionRecord,
  SessionStatus,
  UserSessionsPageRecord,
} from "../control-plane/repositories/session-repository.js"

/**
 * HTTP request/response DTOs for the Managed Agent API.
 *
 * Keep transport shapes here so control-plane services can operate on domain
 * records instead of directly returning API response objects.
 */
export type CreateSessionRequestDto = {
  model?: string
  thinkingLevel?: string
  input: {
    content: InputContentItem[]
  }
}

export type CreateMessageRequestDto = {
  input: {
    content: InputContentItem[]
  }
}

export type CreateTriggerRequestDto = {
  triggerType?: string
}

export type UpdateSessionRequestDto = {
  sessionName: string
}

export type ListUserSessionsQueryDto = {
  limit?: number
  cursor?: string
}

export type SessionResponseEntryDto = {
  id: string
  parentId: string | null
  createdAt: string
  messageType: SessionEntry["messageType"]
  content: DemoContentItem[]
}

export type SessionDetailResponseDto = {
  sessionId: string
  sessionName: string
  status: SessionStatus
  model: string
  thinkingLevel: string
  createdAt: string
  lastActiveAt: string
  entries: SessionResponseEntryDto[]
}

export type SessionListItemDto = {
  sessionId: string
  sessionName: string
  lastActiveAt: string
}

export type UserSessionsResponseDto = {
  items: SessionListItemDto[]
  nextCursor: string | null
  hasMore: boolean
}

export type CancelSessionResponseDto = {
  sessionId: string
  accepted: boolean
}

export type TriggerAcceptedResponseDto = {
  triggerId: string
  accepted: true
  triggerType: string
}

export type ErrorResponseDto = {
  error: {
    code: string
    message: string
  }
}

const parseInputBody = (body: unknown): CreateSessionRequestDto["input"] => {
  if (typeof body !== "object" || body === null || !("input" in body)) {
    throw new ValidationError("input.content is required")
  }

  const { input } = body as {
    input?: unknown
  }

  if (
    typeof input !== "object" ||
    input === null ||
    !("content" in input) ||
    !Array.isArray(input.content) ||
    input.content.length === 0
  ) {
    throw new ValidationError("input.content is required")
  }

  return {
    content: input.content as InputContentItem[],
  }
}

/** Validate and normalize the create-session request body. */
export const parseCreateSessionRequestDto = (
  body: unknown,
): CreateSessionRequestDto => {
  if (typeof body !== "object" || body === null) {
    throw new ValidationError("input.content is required")
  }

  const { model, thinkingLevel } = body as {
    model?: unknown
    thinkingLevel?: unknown
  }

  return {
    model: typeof model === "string" ? model : undefined,
    thinkingLevel:
      typeof thinkingLevel === "string" ? thinkingLevel : undefined,
    input: parseInputBody(body),
  }
}

/** Validate and normalize the submit-message request body. */
export const parseCreateMessageRequestDto = (
  body: unknown,
): CreateMessageRequestDto => {
  return {
    input: parseInputBody(body),
  }
}

/** Validate and normalize the update-session request body. */
export const parseUpdateSessionRequestDto = (
  body: unknown,
): UpdateSessionRequestDto => {
  if (
    typeof body !== "object" ||
    body === null ||
    !("sessionName" in body) ||
    typeof body.sessionName !== "string" ||
    body.sessionName.trim().length === 0
  ) {
    throw new ValidationError("sessionName is required")
  }

  return {
    sessionName: body.sessionName.trim(),
  }
}

/** Validate and normalize the create-trigger request body. */
export const parseCreateTriggerRequestDto = (
  body: unknown,
): CreateTriggerRequestDto => {
  if (typeof body !== "object" || body === null) {
    return {}
  }

  const { triggerType } = body as { triggerType?: unknown }

  return {
    triggerType: typeof triggerType === "string" ? triggerType : undefined,
  }
}

/** Validate and normalize list-session pagination query parameters. */
export const parseListUserSessionsQueryDto = (input: {
  limit: string | null
  cursor: string | null
}): ListUserSessionsQueryDto => {
  let limit: number | undefined

  if (input.limit !== null) {
    const parsedLimit = Number.parseInt(input.limit, 10)

    if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new ValidationError("limit must be an integer between 1 and 100")
    }

    limit = parsedLimit
  }

  return {
    limit,
    cursor: input.cursor ?? undefined,
  }
}

/** Map a session domain record into the HTTP detail response shape. */
export const toSessionDetailResponseDto = (
  session: SessionRecord,
  status = session.status,
): SessionDetailResponseDto => {
  return {
    sessionId: session.sessionId,
    sessionName: session.sessionName,
    status,
    model: session.model,
    thinkingLevel: session.thinkingLevel,
    createdAt: session.createdAt,
    lastActiveAt: session.updatedAt,
    entries: session.entries.map((entry) => ({
      id: entry.id,
      parentId: entry.parentId,
      createdAt: entry.createdAt,
      messageType: entry.messageType,
      content: entry.content,
    })),
  }
}

/** Map the recent-session projection into the list response shape. */
export const toUserSessionsResponseDto = (
  page: UserSessionsPageRecord,
): UserSessionsResponseDto => {
  return {
    items: page.items,
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  }
}

/** Build the cancel response DTO used by the HTTP route. */
export const toCancelSessionResponseDto = (
  sessionId: string,
  accepted: boolean,
): CancelSessionResponseDto => {
  return {
    sessionId,
    accepted,
  }
}

/** Build the trigger accepted response DTO used by the HTTP route. */
export const toTriggerAcceptedResponseDto = (result: {
  triggerId: string
  accepted: true
  triggerType: string
}): TriggerAcceptedResponseDto => {
  return result
}

/** Build a standard JSON error body. */
export const toErrorResponseDto = (
  code: string,
  message: string,
): ErrorResponseDto => {
  return {
    error: {
      code,
      message,
    },
  }
}

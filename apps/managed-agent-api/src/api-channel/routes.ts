import type { IncomingMessage, ServerResponse } from "node:http"

import {
  parseCreateMessageRequestDto,
  parseCreateSessionRequestDto,
  parseCreateTriggerRequestDto,
  parseListUserSessionsQueryDto,
  parseUpdateSessionRequestDto,
  toCancelSessionResponseDto,
  toErrorResponseDto,
  toSessionDetailResponseDto,
  toTriggerAcceptedResponseDto,
  toUserSessionsResponseDto,
} from "../dto/session-dto.js"
import { readJsonBody, sendJson, sendNotFound, sendPreflight } from "./sse.js"

/**
 * Route layer for the Managed Agent API service.
 *
 * Keep this file focused on transport concerns: path matching, request body
 * decoding, and mapping HTTP requests into control-plane calls.
 */
type ManagedSessionService = {
  createSession(input: {
    request: ReturnType<typeof parseCreateSessionRequestDto>
    userId: string
    includeProcess: boolean
    includeFinal: boolean
    response: ServerResponse<IncomingMessage>
  }): Promise<void>
  submitMessage(input: {
    sessionId: string
    request: ReturnType<typeof parseCreateMessageRequestDto>
    includeProcess: boolean
    includeFinal: boolean
    response: ServerResponse<IncomingMessage>
  }): Promise<void>
  getSession(
    sessionId: string,
  ): Promise<
    | import("../control-plane/repositories/session-repository.js").SessionRecord
    | null
  >
  getSessionStatus(
    sessionId: string,
  ): Promise<
    | import("../control-plane/repositories/session-repository.js").SessionStatus
    | null
  >
  listUserSessions(
    userId: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<
    import("../control-plane/repositories/session-repository.js").UserSessionsPageRecord
  >
  updateSessionName(
    sessionId: string,
    sessionName: string,
  ): Promise<
    import("../control-plane/repositories/session-repository.js").SessionRecord
  >
  archiveSession(sessionId: string): Promise<void>
  cancelSession(sessionId: string): Promise<boolean>
}

type TriggerService = {
  createTrigger(body: ReturnType<typeof parseCreateTriggerRequestDto>): {
    triggerId: string
    accepted: true
    triggerType: string
  }
}

const matchSessionPath = (pathname: string) => {
  const sessionPattern = /^\/sessions\/([^/]+)$/
  const match = pathname.match(sessionPattern)

  return match ? { sessionId: match[1] } : null
}

const matchCancelPath = (pathname: string) => {
  const cancelPattern = /^\/sessions\/([^/]+)\/cancel$/
  const match = pathname.match(cancelPattern)

  return match ? { sessionId: match[1] } : null
}

const matchMessagesPath = (pathname: string) => {
  const messagesPattern = /^\/sessions\/([^/]+)\/messages$/
  const match = pathname.match(messagesPattern)

  return match ? { sessionId: match[1] } : null
}

const matchUserSessionsPath = (pathname: string) => {
  const userSessionsPattern = /^\/users\/([^/]+)\/sessions$/
  const match = pathname.match(userSessionsPattern)

  return match ? { userId: match[1] } : null
}

/**
 * Build the HTTP router used by the local API server entrypoint.
 *
 * The router delegates all business behavior to the managed session and
 * trigger services so transport and control-plane concerns stay separated.
 */
export const createRouter = ({
  managedSessionService,
  triggerService,
}: {
  managedSessionService: ManagedSessionService
  triggerService: TriggerService
}) => {
  return async (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>,
  ) => {
    // Use a synthetic base URL so the same code works for plain Node HTTP
    // requests without depending on reverse-proxy headers.
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    const pathname = url.pathname

    if (request.method === "OPTIONS") {
      sendPreflight(response)
      return
    }

    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method === "POST" && pathname === "/sessions") {
      const body = parseCreateSessionRequestDto(await readJsonBody(request))
      await managedSessionService.createSession({
        request: body,
        userId: url.searchParams.get("userId") ?? "demo-user",
        includeProcess: url.searchParams.get("includeProcess") !== "false",
        includeFinal: url.searchParams.get("includeFinal") !== "false",
        response,
      })
      return
    }

    if (request.method === "PATCH") {
      const sessionMatch = matchSessionPath(pathname)

      if (sessionMatch) {
        const body = parseUpdateSessionRequestDto(await readJsonBody(request))
        sendJson(
          response,
          200,
          toSessionDetailResponseDto(
            await managedSessionService.updateSessionName(
              sessionMatch.sessionId,
              body.sessionName,
            ),
          ),
        )
        return
      }
    }

    if (request.method === "DELETE") {
      const sessionMatch = matchSessionPath(pathname)

      if (sessionMatch) {
        await managedSessionService.archiveSession(sessionMatch.sessionId)
        response.writeHead(204, {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
        })
        response.end()
        return
      }
    }

    if (request.method === "POST") {
      const messagesMatch = matchMessagesPath(pathname)

      if (messagesMatch) {
        const body = parseCreateMessageRequestDto(await readJsonBody(request))
        await managedSessionService.submitMessage({
          sessionId: messagesMatch.sessionId,
          request: body,
          includeProcess: url.searchParams.get("includeProcess") !== "false",
          includeFinal: url.searchParams.get("includeFinal") !== "false",
          response,
        })
        return
      }
    }

    if (request.method === "GET") {
      const sessionMatch = matchSessionPath(pathname)

      if (sessionMatch) {
        const session = await managedSessionService.getSession(
          sessionMatch.sessionId,
        )

        if (!session) {
          sendJson(
            response,
            404,
            toErrorResponseDto(
              "session_not_found",
              `session ${sessionMatch.sessionId} not found`,
            ),
          )
          return
        }

        sendJson(
          response,
          200,
          toSessionDetailResponseDto(
            session,
            (await managedSessionService.getSessionStatus(
              sessionMatch.sessionId,
            )) ?? session.status,
          ),
        )
        return
      }

      const userSessionsMatch = matchUserSessionsPath(pathname)

      if (userSessionsMatch) {
        const query = parseListUserSessionsQueryDto({
          limit: url.searchParams.get("limit"),
          cursor: url.searchParams.get("cursor"),
        })

        sendJson(
          response,
          200,
          toUserSessionsResponseDto(
            await managedSessionService.listUserSessions(
              userSessionsMatch.userId,
              query,
            ),
          ),
        )
        return
      }
    }

    if (request.method === "POST") {
      const cancelMatch = matchCancelPath(pathname)

      if (cancelMatch) {
        const session = await managedSessionService.getSession(
          cancelMatch.sessionId,
        )

        if (!session) {
          sendJson(
            response,
            404,
            toErrorResponseDto(
              "session_not_found",
              `session ${cancelMatch.sessionId} not found`,
            ),
          )
          return
        }

        sendJson(
          response,
          200,
          toCancelSessionResponseDto(
            cancelMatch.sessionId,
            await managedSessionService.cancelSession(cancelMatch.sessionId),
          ),
        )
        return
      }

      if (pathname === "/triggers") {
        const body = parseCreateTriggerRequestDto(await readJsonBody(request))
        sendJson(
          response,
          200,
          toTriggerAcceptedResponseDto(triggerService.createTrigger(body)),
        )
        return
      }
    }

    sendNotFound(response)
  }
}

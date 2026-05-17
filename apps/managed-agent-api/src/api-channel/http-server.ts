import type { IncomingMessage, ServerResponse } from "node:http"
import type {
  SessionRecord,
  SessionStatus,
} from "../control-plane/repositories/session-repository.js"
import type {
  CreateMessageRequestDto,
  CreateSessionRequestDto,
  CreateTriggerRequestDto,
  UpdateSessionRequestDto,
} from "../dto/session-dto.js"
import { ConflictError, NotFoundError, ValidationError } from "./http-errors.js"
import { createRouter } from "./routes.js"

type RouteDependencies = {
  managedSessionService: {
    createSession(input: {
      request: CreateSessionRequestDto
      userId: string
      includeProcess: boolean
      includeFinal: boolean
      response: ServerResponse<IncomingMessage>
    }): Promise<void>
    submitMessage(input: {
      sessionId: string
      request: CreateMessageRequestDto
      includeProcess: boolean
      includeFinal: boolean
      response: ServerResponse<IncomingMessage>
    }): Promise<void>
    getSession(sessionId: string): Promise<SessionRecord | null>
    getSessionStatus(sessionId: string): Promise<SessionStatus | null>
    listUserSessions(
      userId: string,
      options?: { limit?: number; cursor?: string },
    ): Promise<
      import("../control-plane/repositories/session-repository.js").UserSessionsPageRecord
    >
    updateSessionName(
      sessionId: string,
      sessionName: UpdateSessionRequestDto["sessionName"],
    ): Promise<SessionRecord>
    archiveSession(sessionId: string): Promise<void>
    cancelSession(sessionId: string): Promise<boolean>
  }
  triggerService: {
    createTrigger(body: CreateTriggerRequestDto): {
      triggerId: string
      accepted: true
      triggerType: string
    }
  }
}

export const createHttpHandler = ({
  managedSessionService,
  triggerService,
}: RouteDependencies) => {
  const router = createRouter({ managedSessionService, triggerService })

  return async (
    request: IncomingMessage,
    response: ServerResponse<IncomingMessage>,
  ) => {
    try {
      await router(request, response)
    } catch (error) {
      const message = error instanceof Error ? error.message : "internal error"

      if (!response.headersSent) {
        let statusCode = 500
        let code = "internal_error"

        if (error instanceof ValidationError) {
          statusCode = 400
          code = "bad_request"
        } else if (error instanceof NotFoundError) {
          statusCode = 404
          code = error.code
        } else if (error instanceof ConflictError) {
          statusCode = 409
          code = error.code
        }

        response.writeHead(statusCode, {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "content-type": "application/json; charset=utf-8",
        })

        response.end(
          JSON.stringify({
            error: {
              code,
              message,
            },
          }),
        )
        return
      }
      response.end()
    }
  }
}

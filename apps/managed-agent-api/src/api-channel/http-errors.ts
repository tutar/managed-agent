/**
 * Small HTTP-facing error types used to keep route and service boundaries
 * explicit without coupling domain orchestration to raw status codes.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ValidationError"
  }
}

export class NotFoundError extends Error {
  readonly code: string

  constructor(message: string, code = "session_not_found") {
    super(message)
    this.name = "NotFoundError"
    this.code = code
  }
}

export class ConflictError extends Error {
  readonly code: string

  constructor(message: string, code = "session_state_conflict") {
    super(message)
    this.name = "ConflictError"
    this.code = code
  }
}

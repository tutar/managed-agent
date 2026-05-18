import type { FastifyInstance } from "fastify";

import {
	ConflictError,
	NotFoundError,
	UnauthorizedError,
	ValidationError,
} from "../channel/web-api/errors/http-errors.js";

/**
 * Register the shared HTTP error mapping for the Fastify app.
 */
export const registerErrorHandler = (app: FastifyInstance) => {
	const hasValidationPayload = (error: unknown): error is { validation: unknown } => {
		return typeof error === "object" && error !== null && "validation" in error;
	};

	app.setErrorHandler((error, _request, reply) => {
		let statusCode = 500;
		let code = "internal_error";
		const message = error instanceof Error ? error.message : "internal error";

		if (error instanceof ValidationError || hasValidationPayload(error)) {
			statusCode = 400;
			code = "bad_request";
		} else if (error instanceof UnauthorizedError) {
			statusCode = 401;
			code = error.code;
		} else if (error instanceof NotFoundError) {
			statusCode = 404;
			code = error.code;
		} else if (error instanceof ConflictError) {
			statusCode = 409;
			code = error.code;
		}

		reply.status(statusCode).send({
			error: {
				code,
				message,
			},
		});
	});
};

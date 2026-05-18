import type { FastifyReply } from "fastify";

import type { CreateMessageRequestDto, CreateSessionRequestDto } from "../dto/session-dto.js";

/**
 * Bridge Fastify handlers to raw SSE control-plane streams.
 *
 * Fastify owns the HTTP container, but the managed session service still
 * writes SSE frames directly to the raw Node response for session execution.
 */
export const createStreamResponseProxy = ({
	managedSessionService,
}: {
	managedSessionService: {
		createSession(input: {
			request: CreateSessionRequestDto;
			userId: string;
			includeProcess: boolean;
			includeFinal: boolean;
			origin?: string;
			response: FastifyReply["raw"];
		}): Promise<void>;
		submitMessage(input: {
			sessionId: string;
			request: CreateMessageRequestDto;
			includeProcess: boolean;
			includeFinal: boolean;
			origin?: string;
			response: FastifyReply["raw"];
		}): Promise<void>;
	};
}) => {
	return {
		async forwardCreateSession({
			reply,
			request,
			userId,
			includeProcess,
			includeFinal,
			origin,
		}: {
			reply: FastifyReply;
			request: CreateSessionRequestDto;
			userId: string;
			includeProcess: boolean;
			includeFinal: boolean;
			origin?: string;
		}) {
			reply.hijack();
			await managedSessionService.createSession({
				request,
				userId,
				includeProcess,
				includeFinal,
				origin,
				response: reply.raw,
			});
			return reply;
		},
		async forwardSubmitMessage({
			reply,
			sessionId,
			request,
			includeProcess,
			includeFinal,
			origin,
		}: {
			reply: FastifyReply;
			sessionId: string;
			request: CreateMessageRequestDto;
			includeProcess: boolean;
			includeFinal: boolean;
			origin?: string;
		}) {
			reply.hijack();
			await managedSessionService.submitMessage({
				sessionId,
				request,
				includeProcess,
				includeFinal,
				origin,
				response: reply.raw,
			});
			return reply;
		},
	};
};

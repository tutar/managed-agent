import type { FastifyInstance } from "fastify";

import type { AuthorizationGuard } from "../../../identity/authorization-guard.js";
import { toCreateTriggerRequestDto, toTriggerAcceptedResponseDto } from "../dto/session-dto.js";
import { CreateTriggerRequestSchema, type CreateTriggerRequestSchemaDto } from "../schemas/session-schema.js";

/**
 * Register trigger creation routes.
 */
export const registerTriggerRoutes = (
	app: FastifyInstance,
	{
		triggerService,
		authorizationGuard,
	}: {
		triggerService: {
			createTrigger(input: { triggerType?: string }): {
				triggerId: string;
				accepted: true;
				triggerType: string;
			};
		};
		authorizationGuard: AuthorizationGuard;
	},
) => {
	app.post<{ Body: CreateTriggerRequestSchemaDto }>(
		"/triggers",
		{
			schema: {
				body: CreateTriggerRequestSchema,
			},
		},
		async (request) => {
			await authorizationGuard.requireCurrentUser(request);
			return toTriggerAcceptedResponseDto(triggerService.createTrigger(toCreateTriggerRequestDto(request.body)));
		},
	);
};

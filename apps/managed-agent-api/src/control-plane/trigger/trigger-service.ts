let nextTriggerId = 1;

type TriggerRequest = {
	triggerType?: string;
};

type TriggerAcceptedResult = {
	triggerId: string;
	accepted: true;
	triggerType: string;
};

export const createTriggerService = () => {
	return {
		createTrigger(body: unknown): TriggerAcceptedResult {
			const triggerBody = typeof body === "object" && body !== null ? (body as TriggerRequest) : {};

			return {
				triggerId: `trg_${nextTriggerId++}`,
				accepted: true,
				triggerType: triggerBody.triggerType ?? "scheduled_once",
			};
		},
	};
};

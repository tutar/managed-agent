import type { FastifyInstance } from "fastify";

/**
 * Register infrastructure health routes.
 */
export const registerHealthRoutes = (app: FastifyInstance) => {
	app.get("/health", async () => {
		return { ok: true };
	});
};

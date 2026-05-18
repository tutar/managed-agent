import fastifyCors from "@fastify/cors";
import type { FastifyInstance } from "fastify";

/**
 * Register the standalone web-ui CORS policy for the Fastify app.
 */
export const registerCorsPlugin = async (app: FastifyInstance) => {
	await app.register(fastifyCors, {
		origin: true,
		credentials: true,
		methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
		allowedHeaders: ["content-type"],
	});
};

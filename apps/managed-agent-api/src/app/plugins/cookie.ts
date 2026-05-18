import fastifyCookie from "@fastify/cookie";
import type { FastifyInstance } from "fastify";

/**
 * Register Fastify cookie parsing and serialization support.
 */
export const registerCookiePlugin = async (app: FastifyInstance) => {
	await app.register(fastifyCookie);
};

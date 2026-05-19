/**
 * Cookie helper tests for login session persistence.
 */
import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";
import cookie from "@fastify/cookie";

import { createSessionCookieManager } from "../../src/identity/session-cookie-manager.js";

test("session cookie manager writes, reads, and clears the managed login cookie", async () => {
	const app = Fastify();
	await app.register(cookie);

	const cookieManager = createSessionCookieManager();

	app.get("/set", async (_request, reply) => {
		cookieManager.setLoginSessionCookie(reply, "login_1");
		return { ok: true };
	});

	app.get("/read", async (request) => {
		return {
			loginSessionId: cookieManager.readCookieValue(request),
		};
	});

	app.get("/clear", async (_request, reply) => {
		cookieManager.clearLoginSessionCookie(reply);
		return { ok: true };
	});

	try {
		const setResult = await app.inject({
			method: "GET",
			url: "/set",
		});
		const cookieHeader = setResult.headers["set-cookie"];

		assert.equal(setResult.statusCode, 200);
		assert.ok(typeof cookieHeader === "string");
		assert.match(cookieHeader, /managed_agent_session=login_1/);

		const readResult = await app.inject({
			method: "GET",
			url: "/read",
			headers: {
				cookie: cookieHeader,
			},
		});

		assert.equal(readResult.json().loginSessionId, "login_1");

		const clearResult = await app.inject({
			method: "GET",
			url: "/clear",
		});
		const clearedCookieHeader = clearResult.headers["set-cookie"];

		assert.equal(clearResult.statusCode, 200);
		assert.ok(typeof clearedCookieHeader === "string");
		assert.match(clearedCookieHeader, /managed_agent_session=/);
		assert.match(clearedCookieHeader, /Max-Age=0/);
	} finally {
		await app.close();
	}
});

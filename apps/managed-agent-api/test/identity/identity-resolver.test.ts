/**
 * Tests for the request-independent current-user resolver.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createCurrentUserResolver } from "../../src/identity/identity-resolver.js";

const TEST_USER = {
	userId: "user_1",
	username: "agentos",
	status: "active" as const,
	createdAt: "2026-05-19T00:00:00.000Z",
	lastLoginAt: "2026-05-19T00:00:00.000Z",
};

test("identity resolver returns null for missing login sessions", async () => {
	const resolver = createCurrentUserResolver({
		authService: {
			async getCurrentUser() {
				return null;
			},
		},
	});

	assert.equal(await resolver.resolve(null), null);
	assert.equal(await resolver.resolve("login_missing"), null);
});

test("identity resolver requires a current user for protected paths", async () => {
	const resolver = createCurrentUserResolver({
		authService: {
			async getCurrentUser(loginSessionId) {
				return loginSessionId === "login_valid" ? TEST_USER : null;
			},
		},
	});

	const user = await resolver.requireUser("login_valid");
	assert.equal(user.username, "agentos");

	await assert.rejects(
		() => resolver.requireUser("login_missing"),
		(error: unknown) => {
			assert.ok(error instanceof Error);
			assert.match(error.message, /authentication required/);
			return true;
		},
	);
});

/**
 * Fastify transport tests for the public Managed Agent API surface.
 *
 * These tests exercise the real Fastify app so cookie auth, CORS, validation,
 * and SSE transport behavior all stay covered together.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { createTranscriptBackedExecutor, createTestControlPlane } from "./test-support/create-test-control-plane.js";

const TEST_ORIGIN = "http://127.0.0.1:3000";

const createAuthHeaders = (cookie?: string) => {
	return {
		origin: TEST_ORIGIN,
		...(cookie ? { cookie } : {}),
	};
};

const readSetCookieHeader = (response: LightMyRequestResponse) => {
	const cookieHeader = response.headers["set-cookie"];

	if (Array.isArray(cookieHeader)) {
		return cookieHeader[0];
	}

	return cookieHeader;
};

const loginAsDefaultUser = async (app: FastifyInstance) => {
	const loginResult = await app.inject({
		method: "POST",
		url: "/auth/login",
		headers: {
			...createAuthHeaders(),
			"content-type": "application/json",
		},
		payload: {
			username: "agentos",
			password: "agentos",
		},
	});

	assert.equal(loginResult.statusCode, 200);
	assert.equal(loginResult.headers["access-control-allow-origin"], TEST_ORIGIN);
	assert.equal(loginResult.headers["access-control-allow-credentials"], "true");

	const cookieValue = readSetCookieHeader(loginResult);
	assert.ok(cookieValue);
	return cookieValue;
};

test("http handler supports register, me, and logout for cookie-backed auth", async () => {
	const harness = await createTestControlPlane();
	const app = await harness.createApp();

	try {
		const registerResult = await app.inject({
			method: "POST",
			url: "/auth/register",
			headers: {
				...createAuthHeaders(),
				"content-type": "application/json",
			},
			payload: {
				username: "new-user",
				password: "new-user",
			},
		});

		const registeredUser = registerResult.json() as { username: string };
		const cookieValue = readSetCookieHeader(registerResult);

		assert.equal(registerResult.statusCode, 200);
		assert.equal(registeredUser.username, "new-user");
		assert.ok(cookieValue);

		const meResult = await app.inject({
			method: "GET",
			url: "/me",
			headers: createAuthHeaders(cookieValue),
		});

		assert.equal(meResult.statusCode, 200);
		assert.match(meResult.body, /"username":"new-user"/);

		const logoutResult = await app.inject({
			method: "POST",
			url: "/auth/logout",
			headers: createAuthHeaders(cookieValue),
		});

		assert.equal(logoutResult.statusCode, 200);

		const unauthorizedMeResult = await app.inject({
			method: "GET",
			url: "/me",
		});

		assert.equal(unauthorizedMeResult.statusCode, 401);
	} finally {
		await app.close();
		await harness.close();
	}
});

test("http handler keeps logout idempotent for stale cookies", async () => {
	const harness = await createTestControlPlane();
	const app = await harness.createApp();

	try {
		const cookie = await loginAsDefaultUser(app);
		const logoutResult = await app.inject({
			method: "POST",
			url: "/auth/logout",
			headers: createAuthHeaders(cookie),
		});

		assert.equal(logoutResult.statusCode, 200);
		assert.equal(logoutResult.json().loggedOut, true);

		const staleLogoutResult = await app.inject({
			method: "POST",
			url: "/auth/logout",
			headers: createAuthHeaders(cookie),
		});

		assert.equal(staleLogoutResult.statusCode, 200);
		assert.equal(staleLogoutResult.json().loggedOut, true);

		const clearedCookie = readSetCookieHeader(staleLogoutResult);
		assert.ok(clearedCookie);
		assert.match(clearedCookie, /managed_agent_session=/);
		assert.match(clearedCookie, /Max-Age=0/);
	} finally {
		await app.close();
		await harness.close();
	}
});

test("http handler supports creating a session and appending a message", async () => {
	const harness = await createTestControlPlane();
	const app = await harness.createApp();

	try {
		const cookie = await loginAsDefaultUser(app);
		const createResult = await app.inject({
			method: "POST",
			url: "/sessions",
			headers: {
				...createAuthHeaders(cookie),
				"content-type": "application/json",
			},
			payload: {
				model: "managed-agent-local",
				thinkingLevel: "medium",
				input: {
					content: [{ type: "text", text: "第一次输入" }],
				},
			},
		});

		const sessionIdMatch = createResult.body.match(/"sessionId":"([^"]+)"/);
		assert.equal(createResult.statusCode, 200);
		assert.equal(createResult.headers["content-type"], "text/event-stream; charset=utf-8");
		assert.ok(sessionIdMatch);

		const sessionId = sessionIdMatch[1];
		const messageResult = await app.inject({
			method: "POST",
			url: `/sessions/${sessionId}/messages`,
			headers: {
				...createAuthHeaders(cookie),
				"content-type": "application/json",
			},
			payload: {
				input: {
					content: [{ type: "text", text: "第二次输入" }],
				},
			},
		});

		const sessionResult = await app.inject({
			method: "GET",
			url: `/sessions/${sessionId}`,
			headers: createAuthHeaders(cookie),
		});

		const sessionBody = sessionResult.json() as {
			entries: Array<{ messageType: string }>;
		};

		assert.equal(messageResult.statusCode, 200);
		assert.match(messageResult.body, /event: message.accepted/);
		assert.equal(sessionResult.statusCode, 200);
		assert.deepEqual(
			sessionBody.entries.map((entry) => entry.messageType),
			["user", "process", "assistant", "user", "process", "assistant"],
		);
	} finally {
		await app.close();
		await harness.close();
	}
});

test("http handler answers CORS preflight requests for the standalone web-ui", async () => {
	const harness = await createTestControlPlane();
	const app = await harness.createApp();

	try {
		const preflightResult = await app.inject({
			method: "OPTIONS",
			url: "/sessions",
			headers: {
				origin: TEST_ORIGIN,
				"access-control-request-method": "POST",
			},
		});

		assert.equal(preflightResult.statusCode, 204);
		assert.equal(preflightResult.headers["access-control-allow-origin"], TEST_ORIGIN);
		assert.equal(preflightResult.headers["access-control-allow-credentials"], "true");
		assert.equal(preflightResult.headers["access-control-allow-methods"], "GET,POST,PATCH,DELETE,OPTIONS");
	} finally {
		await app.close();
		await harness.close();
	}
});

test("http handler returns SSE failure events when worker execution fails", async () => {
	const harness = await createTestControlPlane({
		executor: {
			async *run() {
				throw new Error("runtime exploded");
			},
		},
	});
	const app = await harness.createApp();

	try {
		const cookie = await loginAsDefaultUser(app);
		const createResult = await app.inject({
			method: "POST",
			url: "/sessions",
			headers: {
				...createAuthHeaders(cookie),
				"content-type": "application/json",
			},
			payload: {
				model: "managed-agent-local",
				thinkingLevel: "medium",
				input: {
					content: [{ type: "text", text: "触发失败" }],
				},
			},
		});

		assert.equal(createResult.statusCode, 200);
		assert.match(createResult.body, /event: run.failed/);
		assert.match(createResult.body, /执行失败：runtime exploded/);
	} finally {
		await app.close();
		await harness.close();
	}
});

test("http handler persists the full assistant transcript after chunked SSE output", async () => {
	const harness = await createTestControlPlane({
		executorFactory: ({ transcriptsRoot }) =>
			createTranscriptBackedExecutor({
				transcriptsRoot,
				processContent: [
					{ type: "text", text: "正在分析请求。" },
					{
						type: "tool_call",
						toolCallId: "tool_read_workspace",
						toolName: "read_workspace",
						status: "started",
						arguments: '{"path":"."}',
					},
					{
						type: "tool_call",
						toolCallId: "tool_read_workspace",
						toolName: "read_workspace",
						status: "completed",
						arguments: '{"path":"."}',
						result: '{"files":["README.md"]}',
					},
				],
				assistantText: "介绍下你自己。",
				streamedAssistantChunks: ["介绍", "下你自己。"],
				additionalEvents: [
					{ type: "process.delta", data: { text: "正在分析请求。" } },
					{
						type: "action.started",
						data: {
							toolCallId: "tool_read_workspace",
							name: "read_workspace",
							arguments: '{"path":"."}',
						},
					},
					{
						type: "action.completed",
						data: {
							toolCallId: "tool_read_workspace",
							name: "read_workspace",
							arguments: '{"path":"."}',
							result: '{"files":["README.md"]}',
						},
					},
				],
			}),
	});
	const app = await harness.createApp();

	try {
		const cookie = await loginAsDefaultUser(app);
		const createResult = await app.inject({
			method: "POST",
			url: "/sessions",
			headers: {
				...createAuthHeaders(cookie),
				"content-type": "application/json",
			},
			payload: {
				model: "managed-agent-local",
				thinkingLevel: "medium",
				input: {
					content: [{ type: "text", text: "介绍下你自己。" }],
				},
			},
		});

		const sessionIdMatch = createResult.body.match(/"sessionId":"([^"]+)"/);
		assert.ok(sessionIdMatch);

		const sessionResult = await app.inject({
			method: "GET",
			url: `/sessions/${sessionIdMatch[1]}`,
			headers: createAuthHeaders(cookie),
		});

		const sessionBody = sessionResult.json() as {
			status: string;
			createdAt: string;
			lastActiveAt: string;
			entries: Array<{
				createdAt: string;
				messageType: string;
				content: Array<{
					type: string;
					text?: string;
					toolCallId?: string;
					toolName?: string;
					status?: string;
					arguments?: string;
					result?: string;
				}>;
			}>;
		};

		assert.equal(sessionBody.status, "idle");
		assert.match(sessionBody.createdAt, /^\d{4}-\d{2}-\d{2}T/);
		assert.match(sessionBody.lastActiveAt, /^\d{4}-\d{2}-\d{2}T/);
		assert.match(sessionBody.entries[0]?.createdAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
		assert.equal(sessionBody.entries.at(-1)?.content[0]?.text, "介绍下你自己。");
		assert.deepEqual(sessionBody.entries[1]?.content, [
			{
				type: "text",
				text: "正在分析请求。",
			},
			{
				type: "tool_call",
				toolCallId: "tool_read_workspace",
				toolName: "read_workspace",
				status: "started",
				arguments: '{"path":"."}',
			},
			{
				type: "tool_call",
				toolCallId: "tool_read_workspace",
				toolName: "read_workspace",
				status: "completed",
				arguments: '{"path":"."}',
				result: '{"files":["README.md"]}',
			},
		]);
	} finally {
		await app.close();
		await harness.close();
	}
});

test("http handler returns 404 when cancelling a missing session", async () => {
	const harness = await createTestControlPlane();
	const app = await harness.createApp();

	try {
		const cookie = await loginAsDefaultUser(app);
		const cancelResult = await app.inject({
			method: "POST",
			url: "/sessions/sess_missing/cancel",
			headers: createAuthHeaders(cookie),
		});

		assert.equal(cancelResult.statusCode, 404);
		assert.match(cancelResult.body, /"code":"session_not_found"/);
		assert.match(cancelResult.body, /session sess_missing not found/);
	} finally {
		await app.close();
		await harness.close();
	}
});

test("http handler supports renaming a session", async () => {
	const harness = await createTestControlPlane();
	const app = await harness.createApp();

	try {
		const cookie = await loginAsDefaultUser(app);
		const createResult = await app.inject({
			method: "POST",
			url: "/sessions",
			headers: {
				...createAuthHeaders(cookie),
				"content-type": "application/json",
			},
			payload: {
				input: {
					content: [{ type: "text", text: "初始标题" }],
				},
			},
		});

		const sessionId = createResult.body.match(/"sessionId":"([^"]+)"/)?.[1];
		assert.ok(sessionId);

		const renameResult = await app.inject({
			method: "PATCH",
			url: `/sessions/${sessionId}`,
			headers: {
				...createAuthHeaders(cookie),
				"content-type": "application/json",
			},
			payload: {
				sessionName: "新的标题",
			},
		});

		const renamedSession = renameResult.json() as { sessionName: string };
		assert.equal(renameResult.statusCode, 200);
		assert.equal(renamedSession.sessionName, "新的标题");
	} finally {
		await app.close();
		await harness.close();
	}
});

test("http handler returns 400 when rename payload is invalid", async () => {
	const harness = await createTestControlPlane();
	const app = await harness.createApp();

	try {
		const cookie = await loginAsDefaultUser(app);
		const createResult = await app.inject({
			method: "POST",
			url: "/sessions",
			headers: {
				...createAuthHeaders(cookie),
				"content-type": "application/json",
			},
			payload: {
				input: {
					content: [{ type: "text", text: "待重命名会话" }],
				},
			},
		});

		const sessionId = createResult.body.match(/"sessionId":"([^"]+)"/)?.[1];
		assert.ok(sessionId);

		const renameResult = await app.inject({
			method: "PATCH",
			url: `/sessions/${sessionId}`,
			headers: {
				...createAuthHeaders(cookie),
				"content-type": "application/json",
			},
			payload: {
				sessionName: "   ",
			},
		});

		assert.equal(renameResult.statusCode, 400);
		assert.match(renameResult.body, /"code":"bad_request"/);
	} finally {
		await app.close();
		await harness.close();
	}
});

test("http handler soft-deletes archived sessions from detail and list views", async () => {
	const harness = await createTestControlPlane();
	const app = await harness.createApp();

	try {
		const cookie = await loginAsDefaultUser(app);
		const createResult = await app.inject({
			method: "POST",
			url: "/sessions",
			headers: {
				...createAuthHeaders(cookie),
				"content-type": "application/json",
			},
			payload: {
				input: {
					content: [{ type: "text", text: "待归档会话" }],
				},
			},
		});

		const sessionId = createResult.body.match(/"sessionId":"([^"]+)"/)?.[1];
		assert.ok(sessionId);

		const deleteResult = await app.inject({
			method: "DELETE",
			url: `/sessions/${sessionId}`,
			headers: createAuthHeaders(cookie),
		});

		assert.equal(deleteResult.statusCode, 204);

		const detailResult = await app.inject({
			method: "GET",
			url: `/sessions/${sessionId}`,
			headers: createAuthHeaders(cookie),
		});

		const listResult = await app.inject({
			method: "GET",
			url: "/me/sessions",
			headers: createAuthHeaders(cookie),
		});

		const listBody = listResult.json() as {
			items: Array<{ sessionId: string }>;
		};

		assert.equal(detailResult.statusCode, 404);
		assert.equal(listBody.items.length, 0);
	} finally {
		await app.close();
		await harness.close();
	}
});

test("http handler returns 409 when deleting a running session", async () => {
	const harness = await createTestControlPlane();
	const app = await harness.createApp();

	try {
		const cookie = await loginAsDefaultUser(app);
		const meResult = await app.inject({
			method: "GET",
			url: "/me",
			headers: createAuthHeaders(cookie),
		});
		const currentUser = meResult.json() as { userId: string };

		await harness.sessionRepository.createSession({
			sessionId: "sess_running",
			userId: currentUser.userId,
			sessionName: "长时间执行",
			status: "running",
			model: "managed-agent-local",
			thinkingLevel: "medium",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			entries: [],
		});

		const deleteResult = await app.inject({
			method: "DELETE",
			url: "/sessions/sess_running",
			headers: createAuthHeaders(cookie),
		});

		assert.equal(deleteResult.statusCode, 409);
		assert.match(deleteResult.body, /"code":"session_state_conflict"/);
	} finally {
		await app.close();
		await harness.close();
	}
});

test("http handler paginates recent sessions with nextCursor and hasMore", async () => {
	const harness = await createTestControlPlane();
	const app = await harness.createApp();

	try {
		const cookie = await loginAsDefaultUser(app);

		for (const title of ["会话一", "会话二", "会话三"]) {
			await app.inject({
				method: "POST",
				url: "/sessions",
				headers: {
					...createAuthHeaders(cookie),
					"content-type": "application/json",
				},
				payload: {
					input: {
						content: [{ type: "text", text: title }],
					},
				},
			});
		}

		const firstPageResult = await app.inject({
			method: "GET",
			url: "/me/sessions?limit=2",
			headers: createAuthHeaders(cookie),
		});

		const firstPage = firstPageResult.json() as {
			items: Array<{ sessionName: string }>;
			nextCursor: string | null;
			hasMore: boolean;
		};

		assert.equal(firstPage.items.length, 2);
		assert.equal(firstPage.hasMore, true);
		assert.ok(firstPage.nextCursor);

		const secondPageResult = await app.inject({
			method: "GET",
			url: `/me/sessions?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor ?? "")}`,
			headers: createAuthHeaders(cookie),
		});

		const secondPage = secondPageResult.json() as {
			items: Array<{ sessionName: string }>;
			nextCursor: string | null;
			hasMore: boolean;
		};

		assert.equal(secondPage.items.length, 1);
		assert.equal(secondPage.items[0]?.sessionName, "会话一");
		assert.equal(secondPage.nextCursor, null);
		assert.equal(secondPage.hasMore, false);
	} finally {
		await app.close();
		await harness.close();
	}
});

import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { createPiSessionExecutor } from "../src/harness-worker/pi-executor.js";

test("pi executor returns the persisted piSessionFile from the harness result", async () => {
	let seenSessionDir: string | undefined;
	const executor = createPiSessionExecutor({
		transcriptsRoot: "/mnt/transcripts",
		async *runHarnessImpl(input) {
			seenSessionDir = input.sessionDir;
			yield { type: "agent_start" };
			yield { type: "agent_end" };
			return { piSessionFile: join("/mnt/transcripts", "pi-sessions", "persisted.jsonl") };
		},
	});

	const iterator = executor.run({
		sessionId: "sess_pi",
		model: "deepseek/deepseek-v4-pro",
		thinkingLevel: "high",
		piSessionFile: undefined,
		input: {
			content: [{ type: "text", text: "继续执行" }],
		},
		userEntry: {
			id: "entry_user",
			parentId: null,
			createdAt: "2026-05-19T10:00:00.000Z",
			messageType: "user",
			content: [{ type: "text", text: "继续执行" }],
			input: {
				content: [{ type: "text", text: "继续执行" }],
			},
		},
		processEntryId: "entry_process",
		finalEntryId: "entry_final",
	});

	const first = await iterator.next();
	assert.equal(first.done, false);
	assert.equal(first.value.type, "final.output.completed");

	const second = await iterator.next();
	assert.equal(second.done, true);
	assert.deepEqual(second.value, {
		piSessionFile: "pi-sessions/persisted.jsonl",
	});
	assert.equal(seenSessionDir, "/mnt/transcripts/pi-sessions");
});

test("pi executor maps failed tool completions to action.failed events", async () => {
	const executor = createPiSessionExecutor({
		async *runHarnessImpl() {
			yield {
				type: "tool_end",
				toolCallId: "tool_1",
				name: "bash",
				result: '{"code":1}',
				isError: true,
			};
			return {};
		},
	});

	const first = await executor
		.run({
			sessionId: "sess_pi",
			model: "deepseek/deepseek-v4-pro",
			thinkingLevel: "high",
			piSessionFile: undefined,
			input: {
				content: [{ type: "text", text: "继续执行" }],
			},
			userEntry: {
				id: "entry_user",
				parentId: null,
				createdAt: "2026-05-19T10:00:00.000Z",
				messageType: "user",
				content: [{ type: "text", text: "继续执行" }],
				input: {
					content: [{ type: "text", text: "继续执行" }],
				},
			},
			processEntryId: "entry_process",
			finalEntryId: "entry_final",
		})
		.next();

	assert.equal(first.done, false);
	assert.equal(first.value.type, "action.failed");
	assert.deepEqual(first.value.data, {
		sessionId: "sess_pi",
		entryId: "entry_process",
		parentId: "entry_user",
		toolCallId: "tool_1",
		name: "bash",
		error: '{"code":1}',
	});
});

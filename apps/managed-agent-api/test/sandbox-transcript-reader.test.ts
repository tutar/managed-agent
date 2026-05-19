import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readSandboxTranscript } from "../src/control-plane/session/sandbox-transcript-reader.js";

test("sandbox transcript reader preserves turn order and merges streamed chunks", async () => {
	const mountRoot = mkdtempSync(join(tmpdir(), "managed-agent-sandbox-mount-"));
	const previousMountRoot = process.env.MANAGED_AGENT_MOUNT_ROOT;
	const transcriptPath = join(mountRoot, "transcripts", "pi-sessions", "sess_sandbox.jsonl");

	process.env.MANAGED_AGENT_MOUNT_ROOT = mountRoot;

	try {
		await mkdir(join(mountRoot, "transcripts", "pi-sessions"), { recursive: true });
		await writeFile(
			transcriptPath,
			[
				JSON.stringify({
					type: "user_entry",
					entryId: "entry_user_1",
					parentId: null,
					createdAt: "2026-05-19T10:00:00.000Z",
					text: "第一轮问题",
				}),
				JSON.stringify({
					type: "process.delta",
					data: {
						entryId: "entry_process_1",
						parentId: "entry_user_1",
						text: "分析中。",
					},
				}),
				JSON.stringify({
					type: "process.delta",
					data: {
						entryId: "entry_process_1",
						parentId: "entry_user_1",
						text: "继续分析。",
					},
				}),
				JSON.stringify({
					type: "action.started",
					data: {
						entryId: "entry_process_1",
						parentId: "entry_user_1",
						toolCallId: "tool_1",
						name: "read_workspace",
						arguments: '{"path":"."}',
					},
				}),
				JSON.stringify({
					type: "action.completed",
					data: {
						entryId: "entry_process_1",
						parentId: "entry_user_1",
						toolCallId: "tool_1",
						name: "read_workspace",
						result: '{"files":["README.md"]}',
					},
				}),
				JSON.stringify({
					type: "final.output.delta",
					data: {
						entryId: "entry_assistant_1",
						parentId: "entry_process_1",
						text: "第一轮",
					},
				}),
				JSON.stringify({
					type: "final.output.delta",
					data: {
						entryId: "entry_assistant_1",
						parentId: "entry_process_1",
						text: "回复",
					},
				}),
				JSON.stringify({
					type: "final.output.completed",
					data: {
						entryId: "entry_assistant_1",
					},
				}),
				JSON.stringify({
					type: "user_entry",
					entryId: "entry_user_2",
					parentId: "entry_assistant_1",
					createdAt: "2026-05-19T10:01:00.000Z",
					text: "第二轮问题",
				}),
				JSON.stringify({
					type: "process.delta",
					data: {
						entryId: "entry_process_2",
						parentId: "entry_user_2",
						text: "第二轮分析。",
					},
				}),
				JSON.stringify({
					type: "final.output.delta",
					data: {
						entryId: "entry_assistant_2",
						parentId: "entry_process_2",
						text: "第二轮回复",
					},
				}),
				JSON.stringify({
					type: "final.output.completed",
					data: {
						entryId: "entry_assistant_2",
					},
				}),
			].join("\n"),
			"utf8",
		);

		const entries = await readSandboxTranscript("sess_sandbox");

		assert.deepEqual(
			entries.map((entry) => entry.messageType),
			["user", "process", "assistant", "user", "process", "assistant"],
		);
		assert.equal(entries[0]?.id, "entry_user_1");
		assert.equal(entries[1]?.id, "entry_process_1");
		assert.equal(entries[2]?.id, "entry_assistant_1");
		assert.equal(entries[3]?.parentId, "entry_assistant_1");
		assert.equal(entries[2]?.content[0]?.type, "text");
		assert.equal(entries[2]?.content[0]?.type === "text" ? entries[2].content[0].text : "", "第一轮回复");
		assert.equal(entries[5]?.content[0]?.type === "text" ? entries[5].content[0].text : "", "第二轮回复");
		assert.deepEqual(entries[1]?.content, [
			{ type: "text", text: "分析中。" },
			{ type: "text", text: "继续分析。" },
			{
				type: "tool_call",
				toolCallId: "tool_1",
				toolName: "read_workspace",
				status: "started",
				arguments: '{"path":"."}',
			},
			{
				type: "tool_call",
				toolCallId: "tool_1",
				toolName: "read_workspace",
				status: "completed",
				result: '{"files":["README.md"]}',
			},
		]);
	} finally {
		if (previousMountRoot === undefined) {
			delete process.env.MANAGED_AGENT_MOUNT_ROOT;
		} else {
			process.env.MANAGED_AGENT_MOUNT_ROOT = previousMountRoot;
		}
	}
});

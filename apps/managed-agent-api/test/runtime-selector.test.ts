import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSessionExecutor } from "../src/harness-worker/runtime-selector.js";

test("runtime selector uses a transcript-backed mock executor by default", async () => {
	const previousRuntime = process.env.MANAGED_AGENT_RUNTIME;
	const previousMountRoot = process.env.MANAGED_AGENT_MOUNT_ROOT;
	const mountRoot = mkdtempSync(join(tmpdir(), "managed-agent-runtime-selector-"));

	delete process.env.MANAGED_AGENT_RUNTIME;
	process.env.MANAGED_AGENT_MOUNT_ROOT = mountRoot;

	try {
		const executor = createSessionExecutor();
		const iterator = executor.run({
			sessionId: "sess_default_mock",
			model: "managed-agent-local",
			thinkingLevel: "medium",
			input: {
				content: [{ type: "text", text: "hello mock" }],
			},
			userEntry: {
				id: "entry_user",
				parentId: null,
				createdAt: "2026-05-19T12:00:00.000Z",
				messageType: "user",
				content: [{ type: "text", text: "hello mock" }],
				input: {
					content: [{ type: "text", text: "hello mock" }],
				},
			},
			processEntryId: "entry_process",
			finalEntryId: "entry_final",
		});

		await iterator.next();
		await iterator.next();
		await iterator.next();
		const completion = await iterator.next();

		assert.equal(completion.done, true);
		assert.equal(completion.value.piSessionFile, "mock-sessions/sess_default_mock.jsonl");

		const transcriptPath = join(mountRoot, "transcripts", "mock-sessions", "sess_default_mock.jsonl");
		const transcript = readFileSync(transcriptPath, "utf8");

		assert.match(transcript, /"type":"managed_session"/);
		assert.match(transcript, /"type":"managed_entry"/);
	} finally {
		if (previousRuntime === undefined) {
			delete process.env.MANAGED_AGENT_RUNTIME;
		} else {
			process.env.MANAGED_AGENT_RUNTIME = previousRuntime;
		}

		if (previousMountRoot === undefined) {
			delete process.env.MANAGED_AGENT_MOUNT_ROOT;
		} else {
			process.env.MANAGED_AGENT_MOUNT_ROOT = previousMountRoot;
		}
	}
});

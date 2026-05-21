import assert from "node:assert/strict";
import test from "node:test";

import { createPiSessionExecutor } from "../../src/harness-worker/pi-executor.js";

test("pi executor creates an executor with the default adapter", () => {
	const executor = createPiSessionExecutor({
		transcriptsRoot: "/mnt/transcripts",
	});
	assert.ok(typeof executor.run === "function");
});

test("pi executor yields events and completion from a mock adapter run", async () => {
	// Force pi adapter (default) — the test just validates the mapping layer.
	process.env.MANAGED_AGENT_ADAPTER = "pi";

	const executor = createPiSessionExecutor({
		transcriptsRoot: "/tmp/test-transcripts",
	});
	const events: unknown[] = [];

	// A job with minimal content — the mock adapter returns empty.
	const job = {
		sessionId: "test",
		model: "test/model",
		thinkingLevel: "medium",
		input: { content: [{ type: "text" as const, text: "" }] },
		userEntry: {
			id: "u1",
			parentId: null,
			createdAt: "2026",
			messageType: "user" as const,
			content: [],
			input: { content: [] },
		},
		processEntryId: "p1",
		finalEntryId: "f1",
	};

	const it = executor.run(job);
	let next = await it.next();
	while (!next.done) {
		events.push(next.value);
		next = await it.next();
	}

	// Should have at least agent_start and agent_end mapped events.
	assert.ok(events.length >= 2, `expected >= 2 events, got ${events.length}`);
	assert.ok(next.done, "iterator should be done");
	assert.ok("piSessionFile" in (next.value ?? {}), "completion should have piSessionFile");

	delete process.env.MANAGED_AGENT_ADAPTER;
});

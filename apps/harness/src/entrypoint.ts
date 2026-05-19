/**
 * Container entrypoint for the harness sandbox image.
 *
 * Reads job input from /job/input.json, runs the pi harness, maps
 * HarnessEvent to platform JSON lines on stdout.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

import { type HarnessInput, runHarness } from "./executor.js";

const JOB_PATH = process.env.SANDBOX_JOB_PATH ?? "/job/input.json";
const TRANSCRIPTS_ROOT = process.env.SANDBOX_TRANSCRIPTS_ROOT ?? "/mnt/transcripts";

// ── read job ───────────────────────────────────────────────────────────────
let jobInput: Record<string, unknown>;
try {
	const raw = await readFile(JOB_PATH, "utf8");
	jobInput = JSON.parse(raw);
} catch {
	process.stderr.write("harness: failed to read job input\n");
	process.exit(1);
}

const sessionId = String(jobInput.sessionId ?? "unknown");
const model = String(jobInput.model ?? "deepseek/deepseek-v4-pro");
const thinkingLevel = String(jobInput.thinkingLevel ?? "high");
const processEntryId = String(jobInput.processEntryId ?? "");
const finalEntryId = String(jobInput.finalEntryId ?? "");
const userEntryId = String((jobInput.userEntry as Record<string, unknown> | undefined)?.id ?? "");
const piSessionFile = typeof jobInput.piSessionFile === "string" ? jobInput.piSessionFile : undefined;
const persistentSessionDir = join(TRANSCRIPTS_ROOT, "sandbox-runtime-sessions");
const userText =
	(
		(jobInput.userEntry as Record<string, unknown> | undefined)?.content as
			| Array<{ type: string; text: string }>
			| undefined
	)
		?.filter((c) => c.type === "text")
		.map((c) => c.text)
		.join("") ?? "";

const transcriptPath = join(TRANSCRIPTS_ROOT, `${sessionId}.jsonl`);
await mkdir(TRANSCRIPTS_ROOT, { recursive: true });

// ── helpers ────────────────────────────────────────────────────────────────
const emit = (type: string, data: Record<string, unknown>) => {
	process.stdout.write(`${JSON.stringify({ type, data })}\n`);
};

const appendTranscript = async (entry: Record<string, unknown>) => {
	await writeFile(transcriptPath, `${JSON.stringify(entry)}\n`, { flag: "a" });
};

// ── user entry for transcript ──────────────────────────────────────────────
await appendTranscript({
	type: "user_entry",
	sessionId,
	entryId: userEntryId,
	createdAt: new Date().toISOString(),
	text: userText,
});

// ── run harness ────────────────────────────────────────────────────────────
const input: HarnessInput = {
	model,
	thinkingLevel,
	prompt: userText,
	piSessionFile,
	sessionDir: persistentSessionDir,
	cwd: process.cwd(),
};

try {
	const iterator = runHarness(input);
	let next = await iterator.next();

	while (!next.done) {
		const event = next.value;
		switch (event.type) {
			case "agent_start":
				break;

			case "agent_end":
				emit("final.output.completed", { sessionId, entryId: finalEntryId });
				await appendTranscript({
					type: "final.output.completed",
					data: { sessionId, entryId: finalEntryId },
				});
				break;

			case "text_delta":
				emit("final.output.delta", {
					sessionId,
					entryId: finalEntryId,
					parentId: processEntryId,
					text: event.text,
				});
				await appendTranscript({
					type: "final.output.delta",
					data: { sessionId, entryId: finalEntryId, parentId: processEntryId, text: event.text },
				});
				break;

			case "tool_start":
				emit("action.started", {
					sessionId,
					entryId: processEntryId,
					parentId: userEntryId,
					toolCallId: event.toolCallId,
					name: event.name,
					arguments: event.arguments,
				});
				await appendTranscript({
					type: "action.started",
					data: {
						sessionId,
						entryId: processEntryId,
						parentId: userEntryId,
						toolCallId: event.toolCallId,
						name: event.name,
						arguments: event.arguments,
					},
				});
				break;

			case "tool_end":
				if (event.isError) {
					emit("action.failed", {
						sessionId,
						entryId: processEntryId,
						parentId: userEntryId,
						toolCallId: event.toolCallId,
						name: event.name,
						error: event.result ?? "tool execution failed",
					});
					await appendTranscript({
						type: "action.failed",
						data: {
							sessionId,
							entryId: processEntryId,
							parentId: userEntryId,
							toolCallId: event.toolCallId,
							name: event.name,
							error: event.result ?? "tool execution failed",
						},
					});
					break;
				}

				emit("action.completed", {
					sessionId,
					entryId: processEntryId,
					parentId: userEntryId,
					toolCallId: event.toolCallId,
					name: event.name,
					result: event.result,
				});
				await appendTranscript({
					type: "action.completed",
					data: {
						sessionId,
						entryId: processEntryId,
						parentId: userEntryId,
						toolCallId: event.toolCallId,
						name: event.name,
						result: event.result,
					},
				});
				break;
		}
		next = await iterator.next();
	}

	const relativePiSessionFile =
		typeof next.value.piSessionFile === "string" && next.value.piSessionFile.length > 0
			? isAbsolute(next.value.piSessionFile)
				? relative(TRANSCRIPTS_ROOT, next.value.piSessionFile)
				: next.value.piSessionFile
			: undefined;
	emit("sandbox.done", { sessionId, transcriptPath, piSessionFile: relativePiSessionFile });
} catch (err) {
	const message = err instanceof Error ? err.message : "unknown error";
	process.stderr.write(`harness error: ${message}\n`);
	emit("run.failed", {
		sessionId,
		entryId: finalEntryId,
		parentId: processEntryId,
		code: "execution_error",
		message,
	});
	await appendTranscript({
		type: "run.failed",
		data: {
			sessionId,
			entryId: finalEntryId,
			parentId: processEntryId,
			code: "execution_error",
			message,
		},
	});
	process.exitCode = 1;
} finally {
	process.exit(process.exitCode ?? 0);
}

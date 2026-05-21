import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { HarnessEvent, HarnessResult, HarnessInput } from "../executor.js";
import type { AgentAdapter } from "./types.js";

type ClaudeCodeEvent = {
	type: string;
	message?: { content?: Array<{ type: string; text?: string }> };
	tool_use?: { id: string; name: string; input?: unknown };
	tool_result?: { tool_use_id: string; content?: Array<{ type: string; text?: string }>; is_error?: boolean };
};

/**
 * Claude Code adapter – spawns the `claude` CLI inside the sandbox.
 *
 * State lives under ~/.claude/, which the scheduler mounts on a persistent
 * volume so sessions survive Pod restarts.
 */
export const createClaudeCodeAdapter = (opts: { binaryPath?: string } = {}): AgentAdapter => {
	const binary = opts.binaryPath ?? "claude";

	return {
		id: "claude-code",

		statePaths() {
			const home = process.env.HOME ?? "/home/agent";
			return [join(home, ".claude")];
		},

		async *run(input: HarnessInput) {
			const stateDir = join(process.env.HOME ?? "/home/agent", ".claude");
			await mkdir(stateDir, { recursive: true });

			const args = [
				"-p",
				input.prompt,
				"--output-format", "stream-json",
				"--verbose",
				"--include-partial-messages",
			];

			// If a previous session file exists, add --resume or --continue flag.
			// Claude Code v2+ uses --resume <session-id> to reconnect.

			const llmProvider = input.llmProvider;
			const apiKey = llmProvider?.apiKey ?? "";
			const resolvedEnv: Record<string, string> = {
				...(process.env as Record<string, string>),
				HOME: stateDir,
				ANTHROPIC_AUTH_TOKEN: apiKey,
			};

			if (llmProvider?.anthropicBaseUrl || llmProvider?.baseUrl) {
				resolvedEnv.ANTHROPIC_BASE_URL = llmProvider.anthropicBaseUrl ?? llmProvider.baseUrl ?? "";
			}

			const child = spawn(binary, args, {
				env: resolvedEnv,
				stdio: ["ignore", "pipe", "pipe"],
			});

			yield { type: "agent_start" };

			let hasOutput = false;
			const rl = createInterface({ input: child.stdout! });

			for await (const line of rl) {
				try {
					const event: ClaudeCodeEvent = JSON.parse(line);

					switch (event.type) {
						case "assistant":
						case "content_block_delta":
							if (event.message?.content) {
								for (const block of event.message.content) {
									if (block.type === "text" && block.text) {
										hasOutput = true;
										yield { type: "text_delta", text: block.text };
									}
								}
							}
							break;

						case "tool_use":
							if (event.tool_use) {
								yield {
									type: "tool_start",
									toolCallId: event.tool_use.id,
									name: event.tool_use.name,
									arguments: event.tool_use.input ? JSON.stringify(event.tool_use.input) : undefined,
								};
							}
							break;

						case "tool_result":
							if (event.tool_result) {
								yield {
									type: "tool_end",
									toolCallId: event.tool_result.tool_use_id,
									name: "",
									result: event.tool_result.content?.map((c) => c.text).join("\n"),
									isError: event.tool_result.is_error ?? false,
								};
							}
							break;

						default:
							// Ignore other event types (stream_event, ping, etc.)
							break;
					}
				} catch {
					// Non-JSON lines: forward as text.
					if (line.trim().length > 0) {
						hasOutput = true;
						yield { type: "text_delta", text: line };
					}
				}
			}

			await new Promise<void>((resolve, reject) => {
				child.on("close", (code) => {
					if (code !== 0 && !hasOutput) {
						reject(new Error(`claude exited with code ${code}`));
					} else {
						resolve();
					}
				});
				child.on("error", reject);
			});

			yield { type: "agent_end" };
			return {};
		},
	};
};

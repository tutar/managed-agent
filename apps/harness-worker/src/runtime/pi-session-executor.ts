import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
	type AgentSessionEvent,
	AuthStorage,
	createAgentSession,
	type ModelCycleResult,
	ModelRegistry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

import type { SessionExecutor, SessionRunCompletion, SessionRunEvent, SessionRunJob } from "../jobs/session-run-job.js";
import { resolveManagedAgentMountPaths } from "./mount-paths.js";

type SessionLike = {
	sessionFile?: string;
	state: {
		messages: unknown[];
	};
	subscribe(listener: (event: AgentSessionEvent) => void): () => void;
	prompt(input: string): Promise<void>;
	dispose(): void;
};

type PiSessionExecutorDependencies = {
	createAuthStorage(): ReturnType<typeof AuthStorage.create>;
	createModelRegistry(authStorage: ReturnType<typeof AuthStorage.create>): ReturnType<typeof ModelRegistry.create>;
	ensureSessionDir(sessionDir: string): Promise<unknown>;
	openSessionManager(piSessionFile: string, sessionDir: string, cwd: string): unknown;
	createSessionManager(cwd: string, sessionDir: string): unknown;
	createSession(input: {
		cwd: string;
		authStorage: ReturnType<typeof AuthStorage.create>;
		modelRegistry: ReturnType<typeof ModelRegistry.create>;
		model: ReturnType<ReturnType<typeof ModelRegistry.create>["find"]>;
		thinkingLevel: ModelCycleResult["thinkingLevel"];
		sessionManager: unknown;
	}): Promise<{ session: SessionLike }>;
	getCwd(): string;
};

/**
 * pi-backed worker executor.
 *
 * This path is responsible for reopening durable pi sessions when the control
 * plane already has a persisted `piSessionFile`. It keeps the recovery seam
 * explicit so the API and worker integration can be validated before moving to
 * a separate worker transport or database-backed scheduler.
 */
const parseRequestedModel = (value: string): { provider: string; modelId: string } | null => {
	const [provider, ...rest] = value.split("/");

	if (!provider || rest.length === 0) {
		return null;
	}

	return {
		provider,
		modelId: rest.join("/"),
	};
};

const readToolCallId = (event: AgentSessionEvent, fallback: string) => {
	if ("toolCallId" in event && typeof event.toolCallId === "string" && event.toolCallId.length > 0) {
		return event.toolCallId;
	}

	return fallback;
};

const toStructuredText = (value: unknown) => {
	if (typeof value === "string") {
		return value;
	}

	return JSON.stringify(value);
};

const createDefaultDependencies = (): PiSessionExecutorDependencies => {
	return {
		createAuthStorage() {
			return AuthStorage.create();
		},
		createModelRegistry(authStorage) {
			return ModelRegistry.create(authStorage);
		},
		ensureSessionDir(sessionDir) {
			return mkdir(sessionDir, { recursive: true });
		},
		openSessionManager(piSessionFile, sessionDir, cwd) {
			return SessionManager.open(piSessionFile, sessionDir, cwd);
		},
		createSessionManager(cwd, sessionDir) {
			return SessionManager.create(cwd, sessionDir);
		},
		createSession(input) {
			return createAgentSession({
				cwd: input.cwd,
				authStorage: input.authStorage,
				modelRegistry: input.modelRegistry,
				model: input.model,
				thinkingLevel: input.thinkingLevel,
				sessionManager: input.sessionManager as SessionManager,
			});
		},
		getCwd() {
			return resolveManagedAgentMountPaths().workspaceRoot;
		},
	};
};

/**
 * Create the smallest real pi runtime adapter we can use during scaffold stage.
 *
 * If the requested model cannot be resolved from the local pi registry, the
 * session falls back to pi defaults. Consumers should treat this as a runtime
 * recovery slice, not as the final production worker contract.
 */
export const createPiSessionExecutor = (
	dependencies: PiSessionExecutorDependencies = createDefaultDependencies(),
): SessionExecutor => {
	return {
		async *run(job: SessionRunJob): AsyncGenerator<SessionRunEvent, SessionRunCompletion> {
			const cwd = dependencies.getCwd();
			const authStorage = dependencies.createAuthStorage();
			const modelRegistry = dependencies.createModelRegistry(authStorage);
			const parsedModel = parseRequestedModel(job.model);
			const selectedModel = parsedModel ? modelRegistry.find(parsedModel.provider, parsedModel.modelId) : undefined;
			const sessionDir = join(resolveManagedAgentMountPaths().transcriptsRoot, "pi-sessions");
			await dependencies.ensureSessionDir(cwd);
			await dependencies.ensureSessionDir(sessionDir);
			const sessionManager = job.piSessionFile
				? dependencies.openSessionManager(job.piSessionFile, sessionDir, cwd)
				: dependencies.createSessionManager(cwd, sessionDir);

			const { session } = await dependencies.createSession({
				cwd,
				authStorage,
				modelRegistry,
				model: selectedModel,
				thinkingLevel: job.thinkingLevel as ModelCycleResult["thinkingLevel"],
				sessionManager,
			});

			const bufferedEvents: SessionRunEvent[] = [];
			let nextToolCallIndex = 1;
			const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
				if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
					const delta = event.assistantMessageEvent.delta;

					if (!delta || delta.length === 0) {
						return;
					}

					bufferedEvents.push({
						type: "final.output.delta",
						data: {
							sessionId: job.sessionId,
							entryId: job.finalEntryId,
							parentId: job.processEntryId,
							text: delta,
						},
					});
				}

				if (event.type === "tool_execution_start") {
					const toolCallId = readToolCallId(event, `tool_call_${nextToolCallIndex++}`);
					bufferedEvents.push({
						type: "action.started",
						data: {
							sessionId: job.sessionId,
							entryId: job.processEntryId,
							parentId: job.userEntry.id,
							toolCallId,
							name: event.toolName,
							arguments: "params" in event ? toStructuredText(event.params) : undefined,
						},
					});
				}

				if (event.type === "tool_execution_end") {
					const toolCallId = readToolCallId(event, `tool_call_${nextToolCallIndex++}`);
					bufferedEvents.push({
						type: "action.completed",
						data: {
							sessionId: job.sessionId,
							entryId: job.processEntryId,
							parentId: job.userEntry.id,
							toolCallId,
							name: event.toolName,
							arguments: "params" in event ? toStructuredText(event.params) : undefined,
							result: "result" in event ? toStructuredText(event.result) : undefined,
						},
					});
				}
			});

			try {
				const promptText = job.input.content.find((item) => item.type === "text")?.text ?? "Describe the input.";

				yield {
					type: "process.delta",
					data: {
						sessionId: job.sessionId,
						entryId: job.processEntryId,
						parentId: job.userEntry.id,
						text: "pi runtime 已接管当前请求。",
					},
				};

				await session.prompt(promptText);

				for (const event of bufferedEvents) {
					yield event;
				}

				yield {
					type: "final.output.completed",
					data: {
						sessionId: job.sessionId,
						entryId: job.finalEntryId,
					},
				};

				return {
					piSessionFile: session.sessionFile,
				};
			} finally {
				unsubscribe();
				session.dispose();
			}
		},
	};
};

import type { IncomingMessage, ServerResponse } from "node:http";

import type { SessionRunCompletion, SessionRunEvent, SessionRunJob } from "@managed-agent/contracts";
import type { CreateMessageRequestDto, CreateSessionRequestDto } from "../../channel/web-api/dto/session-dto.js";
import { ConflictError, NotFoundError } from "../../channel/web-api/errors/http-errors.js";
import type { LlmProviderConfigRecord } from "../llm-provider/repositories/llm-provider-repository.js";
import {
	createAssistantEntry,
	createProcessEntry,
	createSessionId,
	createUserEntry,
	type DemoContentItem,
} from "./entry-factory.js";
import { HarnessWorkerExecutionError, type HarnessWorkerGateway } from "./harness-worker-client.js";
import type { ListUserSessionsOptions, SessionRecord, SessionRepository } from "./repositories/session-repository.js";

type CreateSessionOptions = {
	request: CreateSessionRequestDto;
	userId: string;
	includeProcess: boolean;
	includeFinal: boolean;
	origin?: string;
	response: ServerResponse<IncomingMessage>;
};

type SubmitMessageOptions = {
	sessionId: string;
	request: CreateMessageRequestDto;
	includeProcess: boolean;
	includeFinal: boolean;
	origin?: string;
	response: ServerResponse<IncomingMessage>;
};

type ActiveSessionRegistry = {
	markActive(sessionId: string, options?: { cancel?: () => void }): void;
	markIdle(sessionId: string): void;
	isActive(sessionId: string): boolean;
	cancel(sessionId: string): boolean;
};

type AuditService = {
	record(record: { action: string; sessionId: string; userId: string }): Promise<void>;
};

type EventPublisher = {
	open(response: ServerResponse<IncomingMessage>, origin?: string): void;
	publish(response: ServerResponse<IncomingMessage>, event: SessionRunEvent | { type: string; data: unknown }): void;
	close(response: ServerResponse<IncomingMessage>): void;
};

type RunCancellationState = {
	waitForCancellation(): Promise<{ done: false; cancelled: true }>;
	requestCancel(): void;
};

/**
 * Core session orchestration for the managed-agent control plane.
 *
 * This service owns session creation, transcript shaping, SSE publication,
 * and recent-session projection updates. It deliberately avoids transport
 * concerns and does not know about HTTP routing details.
 */
const getFirstUserText = (input: CreateSessionRequestDto["input"]) => {
	const firstText = input.content.find((item) => item.type === "text");
	return firstText?.text ?? "New Session";
};

const getLastEntryId = (entries: SessionRecord["entries"]) => {
	return entries.at(-1)?.id ?? null;
};

const toFailureText = (error: unknown) => {
	if (error instanceof HarnessWorkerExecutionError) {
		return `执行失败：${error.message}`;
	}

	if (error instanceof Error) {
		return `执行失败：${error.message}`;
	}

	return "执行失败：worker execution failed";
};

const createRunCancellationState = (): RunCancellationState => {
	let resolver: (() => void) | null = null;
	let cancelled = false;

	return {
		waitForCancellation() {
			if (cancelled) {
				return Promise.resolve({ done: false, cancelled: true } as const);
			}

			return new Promise<{ done: false; cancelled: true }>((resolve) => {
				resolver = () => resolve({ done: false, cancelled: true });
			});
		},
		requestCancel() {
			cancelled = true;
			resolver?.();
			resolver = null;
		},
	};
};

/**
 * Drain a worker execution stream and capture completion metadata.
 *
 * The worker owns execution details such as the persisted pi session file.
 * The control plane owns event filtering and transcript projection updates.
 */
const consumeRun = async ({
	workerGateway,
	eventPublisher,
	response,
	job,
	includeProcess,
	includeFinal,
	cancellationState,
}: {
	workerGateway: HarnessWorkerGateway;
	eventPublisher: EventPublisher;
	response: ServerResponse<IncomingMessage>;
	job: SessionRunJob;
	includeProcess: boolean;
	includeFinal: boolean;
	cancellationState: RunCancellationState;
}): Promise<{
	completion: SessionRunCompletion;
	finalOutputText: string;
	processContent: DemoContentItem[];
	cancelled: boolean;
}> => {
	process.stderr.write(`[consumeRun] executing job sessionId=${job.sessionId}\n`);
	process.stderr.write(`[consumeRun] sessionId=${job.sessionId} piSessionFile=${job.piSessionFile}\n`);
	const iterator = workerGateway.execute(job);
	process.stderr.write(`[consumeRun] worker gateway called, entering event loop...\n`);
	let finalOutputText = "";
	const processContent: DemoContentItem[] = [];

	while (true) {
		process.stderr.write(`[consumeRun] waiting for next event (race)...\n`);
		process.stderr.write(`[consumeRun] entering loop...\n`);
		const next = await Promise.race([iterator.next(), cancellationState.waitForCancellation()]);
		process.stderr.write(`[consumeRun] got result: done=${JSON.stringify(next)}\n`);

		if ("cancelled" in next && next.cancelled) {
			return {
				completion: {},
				finalOutputText,
				processContent,
				cancelled: true,
			};
		}

		const iteratorResult = next as IteratorResult<SessionRunEvent, SessionRunCompletion>;

		if (iteratorResult.done) {
			return {
				completion: iteratorResult.value,
				finalOutputText,
				processContent,
				cancelled: false,
			};
		}

		const event = iteratorResult.value;
		if (event.type === "run.failed") {
			throw new HarnessWorkerExecutionError(event.data.message, {
				code: event.data.code,
			});
		}

		const isProcessEvent = event.type.startsWith("process.") || event.type.startsWith("action.");
		const isFinalEvent = event.type.startsWith("final.");

		if ((isProcessEvent && includeProcess) || (isFinalEvent && includeFinal)) {
			eventPublisher.publish(response, event);
		}

		if (event.type === "final.output.delta") {
			finalOutputText += event.data.text;
		}

		if (event.type === "process.delta") {
			processContent.push({
				type: "text",
				text: event.data.text,
			});
		}

		if (event.type === "action.started" || event.type === "action.completed" || event.type === "action.failed") {
			const toolCallStatus =
				event.type === "action.started" ? "started" : event.type === "action.completed" ? "completed" : "error";
			processContent.push({
				type: "tool_call",
				toolCallId: event.data.toolCallId,
				toolName: event.data.name,
				status: toolCallStatus,
				...(event.data.arguments ? { arguments: event.data.arguments } : {}),
				...(toolCallStatus === "completed" && event.data.result ? { result: event.data.result } : {}),
				...(toolCallStatus === "error" && event.data.error ? { error: event.data.error } : {}),
			});
		}
	}
};

export const createManagedSessionService = ({
	sessionRepository,
	activeSessionRegistry,
	auditService,
	eventPublisher,
	workerGateway,
	llmProviderService,
}: {
	sessionRepository: SessionRepository;
	activeSessionRegistry: ActiveSessionRegistry;
	auditService: AuditService;
	eventPublisher: EventPublisher;
	workerGateway: HarnessWorkerGateway;
	llmProviderService: {
		resolveProviderSelectionForSession(input: {
			userId: string;
			providerConfigId: string;
			modelId?: string;
			capabilityTier?: "fast" | "balanced" | "strong";
		}): Promise<{
			record: LlmProviderConfigRecord;
			runtimeConfig: SessionRunJob["llmProvider"];
			resolvedModelSelection: {
				modelId: string;
				capabilityTier?: "fast" | "balanced" | "strong";
			};
		}>;
	};
}) => {
	return {
		/**
		 * Create a new session and immediately execute the first prompt.
		 *
		 * The API contract returns the first SSE stream directly from
		 * `POST /sessions`, so creation and first execution are orchestrated here.
		 */
		async createSession({ request, userId, includeProcess, includeFinal, origin, response }: CreateSessionOptions) {
			const sessionId = createSessionId();
			const now = new Date().toISOString();
			const sessionName = getFirstUserText(request.input);
			const userEntry = createUserEntry(request.input, null, now);
			const processEntry = createProcessEntry(userEntry.id, [], now);
			const assistantEntryId = createAssistantEntry(processEntry.id, "pending", undefined, now).id;
			const providerSelection = await llmProviderService.resolveProviderSelectionForSession({
				userId,
				providerConfigId: request.providerConfigId,
				modelId: request.modelId,
				capabilityTier: request.capabilityTier,
			});

			const session: SessionRecord = {
				sessionId,
				userId,
				sessionName,
				status: "running",
				model: `${providerSelection.runtimeConfig?.runtimeProviderId}/${providerSelection.resolvedModelSelection.modelId}`,
				thinkingLevel: request.thinkingLevel ?? providerSelection.record.defaultThinkingLevel,
				providerConfigId: providerSelection.record.providerConfigId,
				providerType: providerSelection.record.providerType,
				capabilityTier: providerSelection.resolvedModelSelection.capabilityTier,
				createdAt: now,
				updatedAt: now,
				entries: [userEntry],
			};

			await auditService.record({
				action: "session.created",
				sessionId,
				userId,
			});
			await sessionRepository.createSession(session);
			eventPublisher.open(response, origin);
			const cancellationState = createRunCancellationState();
			activeSessionRegistry.markActive(sessionId, {
				cancel: () => {
					eventPublisher.publish(response, {
						type: "run.cancelled",
						data: {
							sessionId,
							entryId: assistantEntryId,
							parentId: processEntry.id,
							message: "run cancelled by user",
						},
					});
					cancellationState.requestCancel();
				},
			});

			eventPublisher.publish(response, {
				type: "session.created",
				data: {
					sessionId,
					sessionName,
				},
			});
			eventPublisher.publish(response, {
				type: "message.accepted",
				data: {
					sessionId,
					entry: {
						id: userEntry.id,
						parentId: userEntry.parentId,
						createdAt: userEntry.createdAt,
						messageType: userEntry.messageType,
						content: userEntry.content,
					},
				},
			});

			try {
				const runResult = await consumeRun({
					workerGateway,
					eventPublisher,
					response,
					job: {
						sessionId,
						model: session.model,
						thinkingLevel: session.thinkingLevel,
						providerConfigId: session.providerConfigId,
						providerType: session.providerType,
						capabilityTier: session.capabilityTier,
						input: request.input,
						llmProvider: providerSelection.runtimeConfig,
						userEntry,
						processEntryId: processEntry.id,
						finalEntryId: assistantEntryId,
					},
					includeProcess,
					includeFinal,
					cancellationState,
				});

				const completedAssistantEntry = createAssistantEntry(
					processEntry.id,
					runResult.finalOutputText,
					assistantEntryId,
					new Date().toISOString(),
				);

				if (runResult.cancelled) {
					await auditService.record({
						action: "session.run_cancelled",
						sessionId,
						userId,
					});
					await sessionRepository.updateSession({
						...session,
						status: "idle",
						updatedAt: new Date().toISOString(),
						entries: [
							userEntry,
							{
								...processEntry,
								content: runResult.processContent,
							},
						],
					});
					return;
				}

				await sessionRepository.updateSession({
					...session,
					status: "idle",
					piSessionFile: runResult.completion.piSessionFile,
					updatedAt: new Date().toISOString(),
					entries: [
						userEntry,
						{
							...processEntry,
							content: runResult.processContent,
						},
						completedAssistantEntry,
					],
				});
			} catch (error) {
				const failureText = toFailureText(error);
				const failureEntry = createAssistantEntry(
					processEntry.id,
					failureText,
					assistantEntryId,
					new Date().toISOString(),
				);

				await auditService.record({
					action: "session.run_failed",
					sessionId,
					userId,
				});
				await sessionRepository.updateSession({
					...session,
					status: "error",
					updatedAt: new Date().toISOString(),
					entries: [userEntry, processEntry, failureEntry],
				});
				eventPublisher.publish(response, {
					type: "run.failed",
					data: {
						sessionId,
						entryId: assistantEntryId,
						parentId: processEntry.id,
						code: error instanceof HarnessWorkerExecutionError ? error.code : "worker_execution_failed",
						message: failureText,
					},
				});
			} finally {
				activeSessionRegistry.markIdle(sessionId);
				eventPublisher.close(response);
			}
		},
		/**
		 * Append a new user message to an existing session and continue execution.
		 */
		async submitMessage({
			sessionId,
			request,
			includeProcess,
			includeFinal,
			origin,
			response,
		}: SubmitMessageOptions) {
			const session = await sessionRepository.getSession(sessionId);

			if (!session) {
				throw new NotFoundError(`session ${sessionId} not found`);
			}

			const userEntry = createUserEntry(request.input, getLastEntryId(session.entries), new Date().toISOString());
			const processEntry = createProcessEntry(userEntry.id);
			const assistantEntryId = createAssistantEntry(processEntry.id, "pending").id;
			const providerSelection = session.providerConfigId
				? await llmProviderService.resolveProviderSelectionForSession({
						userId: session.userId,
						providerConfigId: session.providerConfigId,
						modelId: session.model.includes("/") ? session.model.split("/").slice(1).join("/") : session.model,
						capabilityTier: session.capabilityTier,
					})
				: null;

			const pendingSession: SessionRecord = {
				...session,
				status: "running",
				updatedAt: new Date().toISOString(),
				entries: [...session.entries, userEntry],
			};

			await auditService.record({
				action: "session.message_submitted",
				sessionId,
				userId: session.userId,
			});
			await sessionRepository.updateSession(pendingSession);
			eventPublisher.open(response, origin);
			const cancellationState = createRunCancellationState();
			activeSessionRegistry.markActive(sessionId, {
				cancel: () => {
					eventPublisher.publish(response, {
						type: "run.cancelled",
						data: {
							sessionId,
							entryId: assistantEntryId,
							parentId: processEntry.id,
							message: "run cancelled by user",
						},
					});
					cancellationState.requestCancel();
				},
			});

			eventPublisher.publish(response, {
				type: "message.accepted",
				data: {
					sessionId,
					entry: {
						id: userEntry.id,
						parentId: userEntry.parentId,
						createdAt: userEntry.createdAt,
						messageType: userEntry.messageType,
						content: userEntry.content,
					},
				},
			});

			try {
				const runResult = await consumeRun({
					workerGateway,
					eventPublisher,
					response,
					job: {
						sessionId,
						model: session.model,
						thinkingLevel: session.thinkingLevel,
						providerConfigId: session.providerConfigId,
						providerType: session.providerType,
						capabilityTier: session.capabilityTier,
						piSessionFile: session.piSessionFile,
						input: request.input,
						llmProvider: providerSelection?.runtimeConfig,
						userEntry,
						processEntryId: processEntry.id,
						finalEntryId: assistantEntryId,
					},
					includeProcess,
					includeFinal,
					cancellationState,
				});

				const completedAssistantEntry = createAssistantEntry(
					processEntry.id,
					runResult.finalOutputText,
					assistantEntryId,
					new Date().toISOString(),
				);

				if (runResult.cancelled) {
					await auditService.record({
						action: "session.run_cancelled",
						sessionId,
						userId: session.userId,
					});
					await sessionRepository.updateSession({
						...pendingSession,
						status: "idle",
						updatedAt: new Date().toISOString(),
						entries: [
							...pendingSession.entries,
							{
								...processEntry,
								content: runResult.processContent,
							},
						],
					});
					return;
				}

				await sessionRepository.updateSession({
					...pendingSession,
					status: "idle",
					piSessionFile: runResult.completion.piSessionFile ?? session.piSessionFile,
					updatedAt: new Date().toISOString(),
					entries: [
						...pendingSession.entries,
						{
							...processEntry,
							content: runResult.processContent,
						},
						completedAssistantEntry,
					],
				});
			} catch (error) {
				const failureText = toFailureText(error);
				const failureEntry = createAssistantEntry(
					processEntry.id,
					failureText,
					assistantEntryId,
					new Date().toISOString(),
				);

				await auditService.record({
					action: "session.run_failed",
					sessionId,
					userId: session.userId,
				});
				await sessionRepository.updateSession({
					...pendingSession,
					status: "error",
					updatedAt: new Date().toISOString(),
					entries: [...pendingSession.entries, processEntry, failureEntry],
				});
				eventPublisher.publish(response, {
					type: "run.failed",
					data: {
						sessionId,
						entryId: assistantEntryId,
						parentId: processEntry.id,
						code: error instanceof HarnessWorkerExecutionError ? error.code : "worker_execution_failed",
						message: failureText,
					},
				});
			} finally {
				activeSessionRegistry.markIdle(sessionId);
				eventPublisher.close(response);
			}
		},
		/** Return the current transcript projection for one session. */
		getSession(sessionId: string): Promise<SessionRecord | null> {
			return sessionRepository.getSession(sessionId);
		},
		async getSessionStatus(sessionId: string) {
			const session = await sessionRepository.getSession(sessionId);

			if (!session) {
				return null;
			}

			return activeSessionRegistry.isActive(sessionId) ? "running" : session.status;
		},
		/** Return the recent-session list projection for a user. */
		listUserSessions(userId: string, options?: ListUserSessionsOptions) {
			return sessionRepository.listUserSessions(userId, options);
		},
		/** Rename a session without changing the current execution state. */
		async updateSessionName(sessionId: string, sessionName: string) {
			const session = await sessionRepository.getSession(sessionId);

			if (!session) {
				throw new NotFoundError(`session ${sessionId} not found`);
			}

			await sessionRepository.updateSession({
				...session,
				sessionName,
				updatedAt: new Date().toISOString(),
			});

			const updatedSession = await sessionRepository.getSession(sessionId);

			if (!updatedSession) {
				throw new NotFoundError(`session ${sessionId} not found`);
			}

			return updatedSession;
		},
		/**
		 * Archive one session and hide it from subsequent detail/list lookups.
		 *
		 * Archival is intentionally irreversible in the current API contract.
		 */
		async archiveSession(sessionId: string) {
			const session = await sessionRepository.getSession(sessionId);

			if (!session) {
				throw new NotFoundError(`session ${sessionId} not found`);
			}

			if (activeSessionRegistry.isActive(sessionId) || session.status === "running") {
				throw new ConflictError(`session ${sessionId} is currently running`);
			}

			const now = new Date().toISOString();

			await sessionRepository.updateSession({
				...session,
				updatedAt: now,
				archivedAt: now,
			});
		},
		/** The current implementation reports whether a session is active locally. */
		async cancelSession(sessionId: string) {
			return activeSessionRegistry.cancel(sessionId);
		},
	};
};

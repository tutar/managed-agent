import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionExecutor, SessionRunCompletion, SessionRunEvent, SessionRunJob } from "@managed-agent/contracts";
import { resolveManagedAgentMountPaths } from "../infrastructure/storage/mount-paths.js";
import { Scheduler } from "./scheduler.js";

/*
 * Sandbox executor: runs each session in an isolated K8s Pod via Scheduler.
 * Mirrors events to host transcript as a local-validation bridge.
 */
export const createSandboxSessionExecutor = (): SessionExecutor => {
	const scheduler = new Scheduler();
	const hostTranscriptsRoot = join(resolveManagedAgentMountPaths().transcriptsRoot, "pi-sessions");

	return {
		async *run(job: SessionRunJob): AsyncGenerator<SessionRunEvent, SessionRunCompletion> {
			const hostTranscriptPath = join(hostTranscriptsRoot, `${job.sessionId}.jsonl`);
			await mkdir(hostTranscriptsRoot, { recursive: true });

			// Write user entry to host transcript for API read path.
			const userText = job.userEntry.content?.map((c) => (c.type === "text" ? c.text : "")).join("") ?? "";
			await writeFile(
				hostTranscriptPath,
				`${JSON.stringify({
					type: "user_entry",
					sessionId: job.sessionId,
					entryId: job.userEntry.id,
					parentId: job.userEntry.parentId,
					createdAt: job.userEntry.createdAt,
					text: userText,
				})}\n`,
				{ flag: "a" },
			);

			const iterator = scheduler.run(job);
			let next = await iterator.next();

			while (!next.done) {
				const event = next.value;
				yield event;
				await writeFile(hostTranscriptPath, `${JSON.stringify(event)}\n`, { flag: "a" });
				next = await iterator.next();
			}

			return {
				piSessionFile: next.value.piSessionFile,
			};
		},
	};
};

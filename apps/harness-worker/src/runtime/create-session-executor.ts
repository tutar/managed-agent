import type { SessionExecutor } from "../jobs/session-run-job.js";
import { createMockSessionExecutor } from "./mock-session-executor.js";
import { createPiSessionExecutor } from "./pi-session-executor.js";

/**
 * Select the worker runtime implementation for the current process.
 *
 * `pi` mode is opt-in so the scaffold remains runnable without local auth or a
 * configured model registry. This keeps the development loop fast while still
 * letting us wire the real SDK path end to end.
 */
export const createSessionExecutor = (): SessionExecutor => {
	if (process.env.MANAGED_AGENT_RUNTIME === "pi") {
		return createPiSessionExecutor();
	}

	return createMockSessionExecutor();
};

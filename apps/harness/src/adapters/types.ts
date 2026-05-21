import type { HarnessEvent, HarnessInput, HarnessResult } from "../executor.js";

/**
 * An agent adapter wraps a specific agent backend.
 */
export interface AgentAdapter {
	readonly id: string;

	run(input: HarnessInput): AsyncGenerator<HarnessEvent, HarnessResult>;

	/**
	 * Filesystem paths that must persist across Pod restarts.
	 */
	statePaths(): string[];
}

import type { SessionExecutor } from "@managed-agent/contracts";
import { resolveManagedAgentMountPaths } from "../infrastructure/storage/mount-paths.js";
import { createMockSessionExecutor } from "./mock-executor.js";
import { createPiSessionExecutor } from "./pi-executor.js";
import { createSandboxSessionExecutor } from "./sandbox-executor.js";

/**
 * Select the worker runtime implementation based on MANAGED_AGENT_RUNTIME.
 *
 * - `sandbox`: Runs each session in an isolated K8s Pod.
 * - `pi`: Runs the pi harness in-process.
 * - otherwise: Mock executor for fast iteration.
 */
export const createSessionExecutor = (): SessionExecutor => {
	if (process.env.MANAGED_AGENT_RUNTIME === "sandbox") {
		return createSandboxSessionExecutor();
	}
	if (process.env.MANAGED_AGENT_RUNTIME === "pi") {
		return createPiSessionExecutor();
	}
	return createMockSessionExecutor({
		transcriptsRoot: resolveManagedAgentMountPaths().transcriptsRoot,
	});
};

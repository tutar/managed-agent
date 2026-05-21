import type { AgentAdapter } from "./adapters/types.js";

/**
 * Resolve an adapter by identifier.
 *
 * `MANAGED_AGENT_ADAPTER` controls which backend the harness uses:
 *   - unset / "pi"         → built-in pi SDK adapter
 *   - "claude-code"        → spawns `claude` CLI
 *   - "claude-code:path"   → spawns specific binary path
 */
export const resolveAdapter = async (): Promise<AgentAdapter> => {
	const raw = process.env.MANAGED_AGENT_ADAPTER ?? "pi";
	const [adapterId, ...rest] = raw.split(":");
	const binaryPath = rest.join(":") || undefined;

	if (adapterId === "claude-code") {
		const { createClaudeCodeAdapter } = await import("./adapters/claude-code.js");
		return createClaudeCodeAdapter({ binaryPath });
	}

	// Default: pi SDK adapter.
	const { createPiAdapter } = await import("./adapters/pi.js");
	return createPiAdapter();
};

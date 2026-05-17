import { join } from "node:path";

/**
 * Central mount-path convention for worker-side durable storage access.
 *
 * Production deployments expose these paths under `/mnt/*`, while local
 * validation can point the same logical layout at a repo-local directory by
 * overriding `MANAGED_AGENT_MOUNT_ROOT`.
 */
export type ManagedAgentMountPaths = {
	mountRoot: string;
	transcriptsRoot: string;
	uploadsRoot: string;
	outputsRoot: string;
	toolResultsRoot: string;
	skillsRoot: string;
	extensionsRoot: string;
	workspaceRoot: string;
};

/**
 * Resolve the stable `/mnt/*` layout from one configurable mount root.
 *
 * The path suffixes are part of the durable storage contract and should stay
 * unchanged across local and production environments.
 */
export const resolveManagedAgentMountPaths = ({
	mountRoot = process.env.MANAGED_AGENT_MOUNT_ROOT ?? "/mnt",
}: {
	mountRoot?: string;
} = {}): ManagedAgentMountPaths => {
	return {
		mountRoot,
		transcriptsRoot: join(mountRoot, "transcripts"),
		uploadsRoot: join(mountRoot, "user-data", "uploads"),
		outputsRoot: join(mountRoot, "user-data", "outputs"),
		toolResultsRoot: join(mountRoot, "user-data", "tool_results"),
		skillsRoot: join(mountRoot, "skills"),
		extensionsRoot: join(mountRoot, "extensions"),
		workspaceRoot: join(mountRoot, "workspace"),
	};
};

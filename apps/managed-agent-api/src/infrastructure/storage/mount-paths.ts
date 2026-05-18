import { join } from "node:path";

/**
 * Central mount-path convention for API-side durable storage access.
 *
 * The API reads shared transcript files through the same logical `/mnt/*`
 * layout that the worker uses for writes, but the real root stays configurable
 * so local validation does not need a literal `/mnt` mount.
 */
export type ManagedAgentMountPaths = {
	mountRoot: string;
	transcriptsRoot: string;
	uploadsRoot: string;
	outputsRoot: string;
	toolResultsRoot: string;
	skillsRoot: string;
	extensionsRoot: string;
};

/**
 * Resolve the stable `/mnt/*` directory contract from one root setting.
 *
 * The derived suffixes form part of the platform storage design and should not
 * drift between services.
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
	};
};

import assert from "node:assert/strict";
import test from "node:test";

import { createSandboxPodSpec } from "../src/harness-worker/scheduler.js";

test("sandbox pod spec mounts one persistent claim under the stable /mnt contract", () => {
	const podSpec = createSandboxPodSpec({
		podName: "agent-sess-123",
		configMapName: "job-agent-sess-123",
		namespace: "default",
		sandboxImage: "managed-agent-sandbox:latest",
		initImage: "alpine:3.21",
		persistentVolumeClaimName: "managed-agent-sandbox-storage",
	});

	const spec = podSpec.spec;
	assert.ok(spec);
	assert.equal(spec.initContainers?.[0]?.name, "prepare-mount-root");
	assert.deepEqual(spec.volumes?.[1], {
		name: "persistent-storage",
		persistentVolumeClaim: { claimName: "managed-agent-sandbox-storage" },
	});

	const volumeMounts = spec.containers?.[0]?.volumeMounts ?? [];
	assert.deepEqual(
		volumeMounts.map((mount) => ({
			name: mount.name,
			mountPath: mount.mountPath,
			subPath: "subPath" in mount ? mount.subPath : undefined,
		})),
		[
			{ name: "job-input", mountPath: "/job", subPath: undefined },
			{ name: "persistent-storage", mountPath: "/mnt/transcripts", subPath: "transcripts" },
			{ name: "persistent-storage", mountPath: "/mnt/user-data/uploads", subPath: "user-data/uploads" },
			{ name: "persistent-storage", mountPath: "/mnt/user-data/outputs", subPath: "user-data/outputs" },
			{
				name: "persistent-storage",
				mountPath: "/mnt/user-data/tool_results",
				subPath: "user-data/tool_results",
			},
		],
	);
});

import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { KubeConfig } from "@kubernetes/client-node";
import type { SessionRunEvent, SessionRunJob } from "@managed-agent/contracts";

type SchedulerCompletion = {
	piSessionFile?: string;
};

type SandboxPodSpecOptions = {
	podName: string;
	configMapName: string;
	namespace: string;
	sandboxImage: string;
	initImage: string;
	persistentVolumeClaimName: string;
};

/**
 * Build the sandbox pod spec for one agent run.
 *
 * The pod mounts one persistent claim under the stable `/mnt/*` contract.
 * An init container creates the directory structure required by the later
 * subPath mounts before the agent container starts.
 */
export const createSandboxPodSpec = ({
	podName,
	configMapName,
	namespace,
	sandboxImage,
	initImage,
	persistentVolumeClaimName,
}: SandboxPodSpecOptions) => {
	return {
		apiVersion: "v1",
		kind: "Pod",
		metadata: {
			name: podName,
			namespace,
			labels: {
				"app.kubernetes.io/name": "managed-agent-sandbox",
				"app.kubernetes.io/managed-by": "harness-worker",
			},
		},
		spec: {
			restartPolicy: "Never",
			initContainers: [
				{
					name: "prepare-mount-root",
					image: initImage,
					imagePullPolicy: "IfNotPresent",
					command: [
						"sh",
						"-c",
						[
							"mkdir -p /mnt-root/transcripts/pi-sessions",
							"mkdir -p /mnt-root/sandbox-runtime-sessions",
							"mkdir -p /mnt-root/user-data/uploads",
							"mkdir -p /mnt-root/user-data/outputs",
							"mkdir -p /mnt-root/user-data/tool_results",
						].join(" && "),
					],
					volumeMounts: [{ name: "persistent-storage", mountPath: "/mnt-root" }],
				},
			],
			containers: [
				{
					name: "agent",
					image: sandboxImage,
					imagePullPolicy: "IfNotPresent",
					command: ["node", "/agent/dist/entrypoint.js"],
					volumeMounts: [
						{ name: "job-input", mountPath: "/job", readOnly: true },
						{ name: "persistent-storage", mountPath: "/mnt/transcripts", subPath: "transcripts" },
						{ name: "persistent-storage", mountPath: "/mnt/user-data/uploads", subPath: "user-data/uploads" },
						{ name: "persistent-storage", mountPath: "/mnt/user-data/outputs", subPath: "user-data/outputs" },
						{
							name: "persistent-storage",
							mountPath: "/mnt/user-data/tool_results",
							subPath: "user-data/tool_results",
						},
					],
					resources: {
						requests: { cpu: "50m", memory: "64Mi" },
						limits: { cpu: "500m", memory: "256Mi" },
					},
				},
			],
			volumes: [
				{ name: "job-input", configMap: { name: configMapName } },
				{
					name: "persistent-storage",
					persistentVolumeClaim: { claimName: persistentVolumeClaimName },
				},
			],
		},
	};
};

/**
 * K8s Pod scheduler for agent sandbox execution.
 *
 * Creates a Pod per session run, polls stdout for events, and cleans up
 * the Pod and its ConfigMap when the run completes.
 */
export class Scheduler {
	#baseUrl: string;
	#kubeConfig: KubeConfig;
	#initImage: string;
	#namespace: string;
	#persistentVolumeClaimName: string;
	#sandboxImage: string;

	constructor(
		opts: {
			namespace?: string;
			sandboxImage?: string;
			initImage?: string;
			persistentVolumeClaimName?: string;
		} = {},
	) {
		const kubeConfig = new KubeConfig();
		kubeConfig.loadFromDefault();

		const cluster = kubeConfig.getCurrentCluster();
		if (!cluster) throw new Error("No current K8s cluster in kubeconfig");

		this.#kubeConfig = kubeConfig;
		this.#baseUrl = cluster.server;

		this.#namespace = opts.namespace ?? process.env.MANAGED_AGENT_SANDBOX_NAMESPACE ?? "default";
		this.#sandboxImage =
			opts.sandboxImage ?? process.env.MANAGED_AGENT_SANDBOX_IMAGE ?? "managed-agent-sandbox:latest";
		this.#initImage = opts.initImage ?? process.env.MANAGED_AGENT_SANDBOX_INIT_IMAGE ?? "alpine:3.21";
		this.#persistentVolumeClaimName =
			opts.persistentVolumeClaimName ??
			process.env.MANAGED_AGENT_SANDBOX_PVC_NAME ??
			"managed-agent-sandbox-storage";
	}

	async *run(job: SessionRunJob): AsyncGenerator<SessionRunEvent, SchedulerCompletion> {
		const safeId = job.sessionId.replaceAll("_", "-").slice(0, 20);
		const podName = `agent-${safeId}-${randomUUID().slice(0, 6)}`;
		const cmName = `job-${podName}`;

		// Create ConfigMap with job input
		await this.#api("/api/v1/namespaces/{ns}/configmaps", "POST", {
			apiVersion: "v1",
			kind: "ConfigMap",
			metadata: { name: cmName },
			data: { "input.json": JSON.stringify(job) },
		});

		const podSpec = createSandboxPodSpec({
			podName,
			configMapName: cmName,
			namespace: this.#namespace,
			sandboxImage: this.#sandboxImage,
			initImage: this.#initImage,
			persistentVolumeClaimName: this.#persistentVolumeClaimName,
		});
		let completion: SchedulerCompletion = {};

		try {
			await this.#api("/api/v1/namespaces/{ns}/pods", "POST", podSpec);
			await this.#waitForPhase(podName, ["Running", "Succeeded", "Failed"]);

			let isDone = false;
			let consumedCount = 0;
			while (!isDone) {
				const events = await this.#readLogs(podName);
				// Only yield new events since the last poll.
				for (let i = consumedCount; i < events.length; i++) {
					const nextEvent = events[i] as SessionRunEvent | { type: "sandbox.done"; data?: SchedulerCompletion };
					if (nextEvent.type === "sandbox.done") {
						completion = nextEvent.data ?? {};
						isDone = true;
						break;
					}
					yield nextEvent;
					consumedCount = i + 1;
				}
				if (isDone) break;

				const phase = await this.#podPhase(podName);
				if (phase === "Succeeded" || phase === "Failed") {
					const finalEvents = await this.#readLogs(podName);
					for (let i = consumedCount; i < finalEvents.length; i++) {
						const nextEvent = finalEvents[i] as
							| SessionRunEvent
							| { type: "sandbox.done"; data?: SchedulerCompletion };
						if (nextEvent.type === "sandbox.done") {
							completion = nextEvent.data ?? {};
							isDone = true;
							break;
						}
						yield nextEvent;
						consumedCount = i + 1;
					}
					if (!isDone) {
						throw new Error(`sandbox pod ${podName} terminated in phase ${phase} without sandbox.done`);
					}
				} else {
					await new Promise((r) => setTimeout(r, 300));
				}
			}
		} finally {
			await this.#deletePod(podName);
			await this.#deleteConfigMap(cmName);
		}

		return completion;
	}

	async #readLogs(podName: string): Promise<SessionRunEvent[]> {
		const path = this.#ns(`/api/v1/namespaces/{ns}/pods/${podName}/log?container=agent`);
		const text = await this.#fetchText(path);
		const events: SessionRunEvent[] = [];
		for (const line of text.split("\n")) {
			if (line.trim().length === 0) continue;
			try {
				const parsed = JSON.parse(line);
				if (parsed && typeof parsed.type === "string") events.push(parsed);
			} catch {
				events.push({
					type: "process.delta",
					data: { sessionId: "", entryId: "", parentId: "", text: line.trim() },
				});
			}
		}
		return events;
	}

	async #fetchText(path: string): Promise<string> {
		const { text } = await this.#fetch(path);
		return text();
	}

	async #api(path: string, method: string, body?: unknown): Promise<unknown> {
		const response = await this.#fetch(this.#ns(path), {
			method,
			body: body ? JSON.stringify(body) : undefined,
		});
		if (!response.ok) {
			const t = await response.text().catch(() => "");
			throw new Error(`K8s API error ${response.status}: ${method} ${path} — ${t.slice(0, 200)}`);
		}
		return response.json().catch(() => undefined);
	}

	async #fetch(
		path: string,
		opts: { method?: string; body?: string } = {},
	): Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown> }> {
		const url = new URL(`${this.#baseUrl}${path}`);
		return new Promise((resolve, reject) => {
			const requestOptions = {
				method: opts.method ?? "GET",
				headers: { "Content-Type": "application/json" },
			} as Parameters<typeof httpsRequest>[1];

			void this.#kubeConfig
				.applyToHTTPSOptions(requestOptions)
				.then(() => {
					const req = httpsRequest(url, requestOptions, (res: IncomingMessage) => {
						const chunks: Buffer[] = [];
						res.on("data", (c: Buffer) => chunks.push(c));
						res.on("end", () => {
							const body = Buffer.concat(chunks).toString("utf8");
							resolve({
								ok: (res.statusCode ?? 500) < 400,
								status: res.statusCode ?? 500,
								text: async () => body,
								json: async () => JSON.parse(body),
							});
						});
						res.on("error", reject);
					});
					req.on("error", reject);
					req.setTimeout(30_000, () => req.destroy(new Error("timeout")));
					if (opts.body) req.write(opts.body);
					req.end();
				})
				.catch(reject);
		});
	}

	#ns(path: string) {
		return path.replace("{ns}", this.#namespace);
	}

	async #waitForPhase(podName: string, phases: string[], timeoutMs = 120_000): Promise<void> {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			const phase = await this.#podPhase(podName);
			if (phases.includes(phase)) return;
			await new Promise((r) => setTimeout(r, 500));
		}
		throw new Error(`Pod ${podName} did not reach phase ${phases.join(" or ")}`);
	}

	async #podPhase(podName: string): Promise<string> {
		try {
			const pod = (await this.#api(this.#ns(`/api/v1/namespaces/{ns}/pods/${podName}`), "GET")) as
				| { status?: { phase?: string } }
				| undefined;
			return pod?.status?.phase ?? "";
		} catch {
			return "";
		}
	}

	async #deletePod(podName: string): Promise<void> {
		try {
			await this.#api(this.#ns(`/api/v1/namespaces/{ns}/pods/${podName}`), "DELETE");
		} catch {
			/* ok */
		}
	}

	async #deleteConfigMap(cmName: string): Promise<void> {
		try {
			await this.#api(this.#ns(`/api/v1/namespaces/{ns}/configmaps/${cmName}`), "DELETE");
		} catch {
			/* ok */
		}
	}
}

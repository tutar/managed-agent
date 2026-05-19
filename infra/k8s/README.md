# k8s

当前本地 sandbox 验证环境固定为 `kind-managed-agent`。

## 本地 kind 存储基线

Sandbox continuation 依赖 `/mnt/transcripts` 跨 Pod 持久存在。本地验证先使用静态 `hostPath` PV/PVC，而不是生产 CSI：

- `PersistentVolume`: `managed-agent-sandbox-storage`
- `PersistentVolumeClaim`: `managed-agent-sandbox-storage`
- manifest: [kind-managed-agent-storage.yaml](./kind-managed-agent-storage.yaml)

应用方式：

```bash
kubectl --context kind-managed-agent apply -f infra/k8s/kind-managed-agent-storage.yaml
```

当前默认约定：

- namespace: `default`
- PVC 名称: `managed-agent-sandbox-storage`
- sandbox pod 通过同一 claim 挂载：
  - `/mnt/transcripts`
  - `/mnt/user-data/uploads`
  - `/mnt/user-data/outputs`
  - `/mnt/user-data/tool_results`

如需覆盖，可设置：

- `MANAGED_AGENT_SANDBOX_NAMESPACE`
- `MANAGED_AGENT_SANDBOX_PVC_NAME`
- `MANAGED_AGENT_SANDBOX_IMAGE`
- `MANAGED_AGENT_SANDBOX_INIT_IMAGE`

## 设计边界

- 当前只是 `kind-managed-agent` 本地验证方案
- 生产环境仍应切到 CSI / 真实 durable mount
- 当前 manifest 不覆盖 NetworkPolicy、Ingress、RuntimeClass、Kata/Firecracker

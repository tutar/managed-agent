# local

本地 durable store 联调用最小基础设施：

- `postgres`: session metadata / recent sessions / audit

默认连接：

- `postgres://postgres:postgres@127.0.0.1:5432/managed_agent`

本地 durable mount 建议：

- `MANAGED_AGENT_MOUNT_ROOT=/home/.../managed-agent/.managed-agent/mnt`

这样本地可以直接复用生产环境的 `/mnt/*` 路径语义，而不需要真的在宿主机创建 `/mnt` 挂载。

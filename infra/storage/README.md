# storage

预留给以下分层实现说明：

- transcript 主写层
- transcript 远端副本层
- `/mnt/*` durable 挂载层
- 高速本地热执行层

当前路径约定：

- 逻辑路径仍以 `/mnt/*` 为标准
- 实际运行路径由 `MANAGED_AGENT_MOUNT_ROOT` 决定

例如：

- transcript: `${MANAGED_AGENT_MOUNT_ROOT}/transcripts`
- uploads: `${MANAGED_AGENT_MOUNT_ROOT}/user-data/uploads`
- outputs: `${MANAGED_AGENT_MOUNT_ROOT}/user-data/outputs`
- tool results: `${MANAGED_AGENT_MOUNT_ROOT}/user-data/tool_results`
- skills: `${MANAGED_AGENT_MOUNT_ROOT}/skills`
- extensions: `${MANAGED_AGENT_MOUNT_ROOT}/extensions`

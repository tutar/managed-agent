# harness-worker

对应设计文档中的 `Harness Worker`。

后续负责：

- 基于 `sessionId` 重建 `AgentSessionRuntime`
- 组装 `AgentSession` 与 `Agent`
- 调用 Firecracker sandbox
- 接入 `mcp-client`、skills、extensions

当前仓库已经包含一条本地可运行执行链路。

当前可以作为独立服务启动，并对内暴露最小 HTTP worker 接口。

联调真实 `pi + DeepSeek` 时，至少需要：

- `DEEPSEEK_API_KEY`
- `MANAGED_AGENT_RUNTIME=pi`
- `MANAGED_AGENT_DEFAULT_MODEL=deepseek/deepseek-v4-pro`

当前默认使用一个最小 mock executor：

- 不接 `pi`
- 不接 Firecracker
- 不持久化状态
- 只生成符合 managed-agent 文档语义的本地事件流

用途是给 `apps/managed-agent-api` 提供独立的 worker 执行面。

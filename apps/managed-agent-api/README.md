# managed-agent-api

对应更新后的设计文档中的 `Managed Agent API`。

后续负责：

- `WebApiAdapter`
- `FeishuAdapter`
- `TelegramAdapter`
- `WhatsAppAdapter`
- `IdentityResolver`
- `AuthorizationGuard`
- `StreamResponseProxy`
- `POST /sessions`
- `POST /sessions/{sessionId}/messages`
- `POST /sessions/{sessionId}/cancel`
- `GET /sessions/{sessionId}`
- `GET /users/{userId}/sessions`
- `POST /triggers`
- `ManagedSessionService`
- `TriggerService`
- `ActiveSessionRegistry`
- `EventPublisher`
- `AuditService`

当前阶段已经落了一个可运行主框架：

- `POST /sessions`
- `POST /sessions/:sessionId/messages`
- `GET /sessions/:sessionId`
- `GET /users/:userId/sessions`
- `POST /sessions/:sessionId/cancel`

当前默认行为：

- session metadata / recent-session projection / audit 走 PostgreSQL durable store
- transcript 通过 `piSessionFile` 从 `${MANAGED_AGENT_MOUNT_ROOT}/transcripts` 读取
- worker 默认使用 mock runtime
- 设置 `MANAGED_AGENT_RUNTIME=pi` 时可切到最小 `pi` runtime
- 为独立 `web-ui` 暴露跨域可访问的 JSON/SSE 接口

测试当前使用 `PGlite` 驱动同一套 PostgreSQL repositories，不再保留单独的 file/in-memory 仓储实现。

这套实现已经覆盖主框架分层、SSE 事件流、会话续写、durable metadata store 和 transcript 文件读写主路径；距离生产形态还差调度、沙箱和多进程安全存储。

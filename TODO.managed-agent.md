# Managed Agent TODO

基于：

- `docs/01-managed-agent-feature-proposal.zh-CN.md`
- `docs/managed-agent-minimal-architecture.zh-CN.md`

## 当前状态

| 状态 | 任务 | 关联文档 | 备注 |
|---|---|---|---|
| `done` | 形成独立部署单元骨架：`managed-agent-api`、`harness-worker`、`web-ui`、`infra/ingress` | `managed-agent-minimal-architecture.zh-CN.md` | 仓库目录已对应最小架构拓扑 |
| `done` | 打通 `POST /sessions`、`POST /sessions/{id}/messages`、`GET /sessions/{id}`、`GET /users/{userId}/sessions`、`POST /sessions/{id}/cancel` | `01-managed-agent-feature-proposal.zh-CN.md`、`managed-agent-api-interface-draft.zh-CN.md` | 当前 API 可本地运行 |
| `done` | 建立最小 `ManagedSessionService` / `TriggerService` / `ActiveSessionRegistry` / `AuditService` 主框架 | `managed-agent-minimal-architecture.zh-CN.md` | 当前已具备 control-plane 主链路 |
| `done` | 建立 `HarnessWorkerGateway` 与可切换 `mock` / `pi` runtime | `managed-agent-minimal-architecture.zh-CN.md` | `MANAGED_AGENT_RUNTIME=pi` 可走最小真实 runtime |
| `done` | 落地本地 versioned metadata store 与 audit 持久化 | `managed-agent-minimal-architecture.zh-CN.md` | 当前为本地文件实现，不是生产级数据库 |
| `done` | 拆出独立 `web-ui`，不再把浏览器端塞进 API | `01-managed-agent-feature-proposal.zh-CN.md`、`managed-agent-minimal-architecture.zh-CN.md` | 当前 `web-ui` 作为单独 app |
| `done` | 建立会话创建 / 续写 / 失败的最小 UI 状态机 | `01-managed-agent-feature-proposal.zh-CN.md` | 当前页面支持正常用户视角聊天流程 |
| `done` | 完成 `web-ui -> managed-agent-api -> harness-worker -> pi runtime` 最小联调链路 | `01-managed-agent-feature-proposal.zh-CN.md` | 当前已可通过独立 `web-ui` 手动验证真实执行链路 |
| `done` | 将 `harness-worker` 迁移到独立进程 / 独立部署 transport | `managed-agent-minimal-architecture.zh-CN.md` | 当前第一版先走内部 HTTP，不上 Redis Streams |
| `done` | 建立 `DeepSeek via pi` 真实 LLM 联调基线 | `managed-agent-minimal-architecture.zh-CN.md` | 当前由 API 组装 job，worker 只负责执行 |
| `done` | 冻结 `managed-agent-api` 的 V1 接口契约并补齐实现 | `managed-agent-api-interface-draft.zh-CN.md`、`managed-agent-technical-design.zh-CN.md` | 当前已落地 rename、archive、分页和明确 SSE 生命周期 |
| `in_progress` | 接入生产级 durable metadata / transcript store | `managed-agent-minimal-architecture.zh-CN.md` | PostgreSQL metadata/audit 与 pi transcript 读路径已接入；API runtime 已移除 file-backed fallback，当前仍缺真实挂载层联调 |
| `todo` | 引入 Firecracker、`cwd` 生命周期和远端存储挂载 | `01-managed-agent-feature-proposal.zh-CN.md`、`managed-agent-minimal-architecture.zh-CN.md` | 尚未进入真实沙箱执行 |
| `todo` | 完成 trigger 调度、外部事件接入与多次恢复语义 | `01-managed-agent-feature-proposal.zh-CN.md` | 当前仅保留最小 trigger 接口占位 |
| `todo` | 落地多租户、配额、预算、审计落库与策略控制 | `managed-agent-minimal-architecture.zh-CN.md` | 仍停留在最小单租户骨架 |

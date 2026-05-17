# Managed Agent Implementation Status

- `Status`: active
- `Owner`: TBD
- `Related Proposals`:
  - [../proposals/01-feature-proposal.zh-CN.md](../proposals/01-feature-proposal.zh-CN.md)
  - [../proposals/03-auth-foundation-feature-proposal.zh-CN.md](../proposals/03-auth-foundation-feature-proposal.zh-CN.md)
  - [../proposals/04-multi-tenant-feature-proposal.zh-CN.md](../proposals/04-multi-tenant-feature-proposal.zh-CN.md)

这份文档只记录当前实现状态和下一阶段重点，不重复 proposal 结论，也不承担项目骨架说明。

## Runtime & Control Plane

| 状态 | 事项 | 关联文档 | 备注 |
|---|---|---|---|
| `done` | 形成独立部署单元骨架：`managed-agent-api`、`harness-worker`、`web-ui`、`infra/ingress` | `../design/minimal-architecture.zh-CN.md` | 仓库结构已对应最小拓扑 |
| `done` | 建立最小 `ManagedSessionService` / `TriggerService` / `ActiveSessionRegistry` / `AuditService` 主框架 | `../design/minimal-architecture.zh-CN.md` | control-plane 主链路已在运行 |
| `done` | 建立 `HarnessWorkerGateway` 与可切换 `mock` / `pi` runtime | `../design/minimal-architecture.zh-CN.md` | `MANAGED_AGENT_RUNTIME=pi` 可走真实最小 runtime |
| `done` | 将 `harness-worker` 迁移到独立进程 / 独立部署 transport | `../design/minimal-architecture.zh-CN.md` | 当前先走内部 HTTP，不上 Redis Streams |
| `todo` | 完成 trigger 调度、外部事件接入与更强恢复语义 | `../proposals/01-feature-proposal.zh-CN.md` | 当前仅保留最小 trigger 接口和主链路占位 |

## API & Web UI

| 状态 | 事项 | 关联文档 | 备注 |
|---|---|---|---|
| `done` | 打通 `POST /sessions`、`POST /sessions/{id}/messages`、`GET /sessions/{id}`、`GET /users/{userId}/sessions`、`POST /sessions/{id}/cancel` | `../proposals/01-feature-proposal.zh-CN.md`、`../interfaces/api-interface-draft.zh-CN.md` | 当前 API 可本地运行 |
| `done` | 拆出独立 `web-ui`，不再把浏览器端塞进 API | `../proposals/01-feature-proposal.zh-CN.md`、`../design/minimal-architecture.zh-CN.md` | 当前 `web-ui` 作为单独 app |
| `done` | 建立会话创建 / 续写 / 失败的最小 UI 状态机 | `../proposals/01-feature-proposal.zh-CN.md` | 当前页面支持正常用户视角聊天流程 |
| `done` | 冻结 `managed-agent-api` 的 V1 接口契约并补齐实现 | `../interfaces/api-interface-draft.zh-CN.md`、`../design/technical-design.zh-CN.md` | 已落地 rename、archive、分页和明确 SSE 生命周期 |

## Durable Storage

| 状态 | 事项 | 关联文档 | 备注 |
|---|---|---|---|
| `done` | 建立本地共享 mount root 约定与清理脚本 | `../interfaces/workspace-service-backend-project-storage-design.zh-CN.md` | 当前统一使用仓库根 `.managed-agent/mnt` |
| `in_progress` | 接入生产级 durable metadata / transcript store | `../design/minimal-architecture.zh-CN.md`、`../interfaces/workspace-service-backend-project-storage-design.zh-CN.md` | PostgreSQL metadata/audit 与 transcript 读路径已接入；仍缺真实挂载层联调 |
| `todo` | 接入远端对象存储同步器和自动化 durable 挂载 | `../interfaces/workspace-service-backend-project-storage-design.zh-CN.md` | 当前仍是本地目录验证，不是完整生产挂载 |

## Sandbox & Execution Plane

| 状态 | 事项 | 关联文档 | 备注 |
|---|---|---|---|
| `done` | 建立 `DeepSeek via pi` 真实 LLM 联调基线 | `../design/minimal-architecture.zh-CN.md` | 当前由 API 组装 job，worker 只负责执行 |
| `todo` | 引入 Firecracker、`cwd` 生命周期和远端存储挂载 | `../proposals/01-feature-proposal.zh-CN.md`、`../design/minimal-architecture.zh-CN.md` | 尚未进入真实沙箱执行 |
| `todo` | 收紧命令策略、预算和执行护栏 | `../design/technical-design.zh-CN.md` | 仍处于最小联调基线阶段 |

## Identity & Tenant Roadmap

| 状态 | 事项 | 关联文档 | 备注 |
|---|---|---|---|
| `todo` | 落地个人用户注册、登录、登出和 `GET /me` | `../proposals/03-auth-foundation-feature-proposal.zh-CN.md` | 当前仍使用开发态用户上下文 |
| `todo` | 落地多租户、配额、预算、审计落库与策略控制 | `../proposals/04-multi-tenant-feature-proposal.zh-CN.md`、`../design/minimal-architecture.zh-CN.md` | 当前仍停留在最小单租户骨架 |

## Next Focus

建议下一阶段优先级：

1. Firecracker 和真实 `cwd` 生命周期
2. trigger 调度和外部事件恢复语义
3. 注册登录前提能力
4. 多租户和策略层

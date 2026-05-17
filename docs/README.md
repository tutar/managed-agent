# Managed Agent 文档索引

当前 `docs/` 目录只保留中文主线文档，按“为什么做、做成什么、怎么落地、接口怎么暴露、存储怎么分层”的顺序组织。

## 文档关系

| 文档 | 作用 | 什么时候读 |
|---|---|---|
| [01-managed-agent-feature-proposal.zh-CN.md](./01-managed-agent-feature-proposal.zh-CN.md) | 定义为什么要做 managed agent，以及为什么采用 pi 的 SDK + extensions 路线 | 第一次了解方案时 |
| [02-managed-agent-session-observability-feature-proposal.zh-CN.md](./02-managed-agent-session-observability-feature-proposal.zh-CN.md) | 定义 session 追踪为什么要单独做，以及为什么不应塞进 session 本体 | 需要设计观测、统计、运营视图时 |
| [03-managed-agent-multi-tenant-feature-proposal.zh-CN.md](./03-managed-agent-multi-tenant-feature-proposal.zh-CN.md) | 定义下一阶段多租户支持为什么要单独做，以及哪些对象需要补租户边界 | 需要设计租户隔离与策略层时 |
| [managed-agent-minimal-architecture.zh-CN.md](./managed-agent-minimal-architecture.zh-CN.md) | 定义当前已确认的 MVP 架构边界与约束 | 需要看产品与架构总览时 |
| [managed-agent-technical-design.zh-CN.md](./managed-agent-technical-design.zh-CN.md) | 定义运行时对象、生命周期、worker/harness/sandbox 协作方式 | 需要进入实现细节时 |
| [managed-agent-api-interface-draft.zh-CN.md](./managed-agent-api-interface-draft.zh-CN.md) | 定义 MVP-only 的服务端接口、SSE 事件与最小数据形状 | 需要设计 API 或前后端协议时 |
| [workspace-service-backend-project-storage-design.zh-CN.md](./workspace-service-backend-project-storage-design.zh-CN.md) | 定义 workspace 文件访问、Firecracker、rclone 挂载和高速热盘分层 | 需要设计文件/存储/执行平面时 |

## 统一约束

所有文档均以以下前提为准：

- 运行时依赖 `pi` 发布包，而不是直接依赖本仓库 `packages/*` 源码路径
- 通过 `pi` 的 SDK 和 `extensions` 两种扩展方式实现 managed agent
- MVP 不做 `pi` 源码定制或状态模型修改
- 不单独提供恢复接口；用户继续提交 prompt 即可
- 执行沙箱固定为 Firecracker MicroVM
- 持久文件存储通过 rclone 挂载暴露到 `/mnt/*`
- 热 workspace 使用高速本地磁盘
- `mcp-client` 是外部能力接入方式

## 阅读建议

推荐顺序：

1. `01-managed-agent-feature-proposal.zh-CN.md`
2. `02-managed-agent-session-observability-feature-proposal.zh-CN.md`
3. `03-managed-agent-multi-tenant-feature-proposal.zh-CN.md`
4. `managed-agent-minimal-architecture.zh-CN.md`
5. `managed-agent-technical-design.zh-CN.md`
6. `managed-agent-api-interface-draft.zh-CN.md`
7. `workspace-service-backend-project-storage-design.zh-CN.md`

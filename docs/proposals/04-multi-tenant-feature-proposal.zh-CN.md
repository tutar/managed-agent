# Managed Agent 多租户支持功能提案

- `Status`: active
- `Owner`: TBD
- `Related Design`:
  - [../design/minimal-architecture.zh-CN.md](../design/minimal-architecture.zh-CN.md)
  - [../design/technical-design.zh-CN.md](../design/technical-design.zh-CN.md)

## 概述

本文定义在当前单用户前提之上，下一阶段如何为 managed agent 增加多租户支持。

这里的“多租户”重点不是把现有模型简单加一个 `tenantId` 字段，而是明确：

- 哪些资源需要按租户隔离
- 哪些配置需要按租户覆盖
- 哪些调用链和观测数据必须带租户上下文
- 当前基于 `pi` 的架构要在哪些边界上补齐租户语义

这份提案建立在“用户已具备真实注册/登录能力”的前提上，而不是继续沿用匿名用户或硬编码 `demo-user`。

## 提案结论

| 主题 | 结论 |
|---|---|
| 运行时内核 | 继续复用 `pi` 发布包 |
| 核心扩展方式 | 继续通过 `SDK` + `extensions` |
| `pi` 源码 | 多租户阶段仍不应优先修改 |
| 核心租户键 | `tenantId` |
| 用户归属 | `userId` 属于某个 `tenantId` |
| 会话真相 | 仍然是 `pi session` |
| 平台补充 | 在 `sessionId` 周边增加租户隔离、投影和策略层 |

## 为什么要单独立项

当前文档已经明确：

- 平台 agent session = `pi` session
- `user_sessions` 是轻量列表投影
- `trigger` 会创建新 session 并注入首次 prompt

这些前提在单用户下足够清晰，但一旦进入多租户，至少会新增 4 类问题：

1. 资源归属  
   同一个 `sessionId`、`triggerId`、`mcp-client` 配置、skills/extensions 安装记录，必须知道属于哪个租户。

2. 配置覆盖  
   不同租户可能有不同的模型默认值、命令 allowlist、网络策略、审计策略、存储配额。

3. 数据边界  
   transcript、审计、`user_sessions`、`scheduled_triggers`、`session_stats` 等都必须按租户隔离查询。

4. 运行时上下文  
   worker 在重建 `pi` runtime 时，除了 `sessionId`，还需要明确租户级资源和策略。

## 多租户不改变什么

这份提案不改变以下核心结论：

- 不把平台 session 和 `pi` session 分裂成两套模型
- 不把 `run` 恢复成平台一等对象
- 不把 `cwd` 重新抽象成独立 workspace 资源模型
- 不把多租户语义塞进 `pi` session 文件本体

## 核心设计

### 1. `tenantId` 是平台侧主键，不进入 `pi` session 核心语义

建议关系如下：

- `tenantId`
  - 平台租户身份
- `userId`
  - 租户内用户身份
- `sessionId`
  - `pi` session 身份

也就是：

```text
tenantId -> userId -> sessionId
```

`pi` session 仍然只做会话真相，不需要把多租户语义直接写成它的核心协议。

### 2. 租户隔离应优先落在平台投影和策略层

最先需要带 `tenantId` 的平台记录：

| 对象 | 是否建议加 `tenantId` |
|---|---|
| `user_sessions` | 是 |
| `scheduled_triggers` | 是 |
| `session_stats` / `session_runtime_projection` | 是 |
| `audit_logs` | 是 |
| `mcp_clients` | 是 |
| `skills` / `extensions` 安装记录 | 是 |

### 3. 多租户的最小隔离面

建议至少隔离这些维度：

| 维度 | 隔离要求 |
|---|---|
| API 查询 | 只能查本租户数据 |
| transcript / audit | 按租户隔离检索 |
| `mcp-client` 配置 | 按租户隔离注册和使用 |
| skills / extensions | 至少支持租户级安装范围 |
| 模型策略 | 支持租户级默认值和限制 |
| 命令 allowlist | 支持租户级覆盖 |
| 配额 | 至少支持租户级 token / 磁盘 / 调用配额 |

## 最小新增对象

多租户阶段建议新增这些平台对象：

| 对象 | 作用 |
|---|---|
| `tenants` | 租户基本信息 |
| `tenant_users` | 用户与租户关系 |
| `tenant_policies` | 模型、命令、网络、审计等租户策略 |
| `tenant_mcp_clients` | 租户级 `mcp-client` 配置 |
| `tenant_resource_bindings` | skills/extensions/配额等租户资源绑定 |

## 与现有架构的关系

职责建议：

| 能力 | 归属 |
|---|---|
| `tenantId` 鉴权与透传 | `API Gateway` / `API Server` |
| 租户策略装配 | `Managed Agent Control Plane` |
| worker 重建时带入租户上下文 | `Harness Worker` |
| 租户级 `mcp-client` / skills / extensions 可见性 | `Managed Agent Control Plane` + `ResourceLoader` / `McpClientManager` |

## 为什么应该排在 session 追踪之后

按文档顺序看，这一阶段的前置依赖已经变成：

- 先明确 session 观测边界
- 先补齐真实用户注册/登录能力
- 再决定哪些模型和查询需要补 `tenantId`

也就是说，多租户现在不再是“比身份更基础”的问题，而是建立在真实 `userId` 已经存在之后的下一层隔离能力。

## 后续文档关系

这份提案只定义：

- 为什么需要多租户
- 多租户不改变什么
- 哪些对象和策略需要补 `tenantId`

后续如果继续展开，建议新增：

- `multi-tenant-design.zh-CN.md`

相关文档：

- [01-feature-proposal.zh-CN.md](./01-feature-proposal.zh-CN.md)
- [03-auth-foundation-feature-proposal.zh-CN.md](./03-auth-foundation-feature-proposal.zh-CN.md)
- [../design/minimal-architecture.zh-CN.md](../design/minimal-architecture.zh-CN.md)
- [../design/technical-design.zh-CN.md](../design/technical-design.zh-CN.md)

# Managed Agent Session 追踪功能提案

- `Status`: active
- `Owner`: TBD
- `Related Design`:
  - [../design/minimal-architecture.zh-CN.md](../design/minimal-architecture.zh-CN.md)
  - [../design/technical-design.zh-CN.md](../design/technical-design.zh-CN.md)

## 概述

本文定义后续要补充的 `session` 追踪能力。

这里的“追踪”不等于分布式调用链 tracing，也不等于把更多运行时字段塞进 `session` 本体。更准确地说，这是一组围绕 `sessionId` 建立的观测与统计能力。

目标是回答这类问题：

- 一个 session 已运行多久
- 最近一次活跃是什么时候
- 总共执行了多少次
- 成功率、失败率、暂停次数如何
- 工具调用、bash 执行、`mcp-client` 调用大致分布如何

## 提案结论

| 主题 | 结论 |
|---|---|
| 核心键 | `sessionId` |
| 是否修改 `pi` session | 否 |
| 是否放入 session 本体 | 否，优先做 projection |
| 与调用链 tracing 的关系 | 分离 |
| 数据来源 | transcript、durable events、控制平面状态变更、工具执行记录 |
| 落地点 | `Managed Agent Control Plane` 为主 |

## 为什么要单独做

当前文档里的 `session` 主要承担：

- durable identity
- transcript 关联
- `cwd`
- model / thinking 配置

但对外产品后续还需要一层“可运营、可观测”的 session 视图，例如：

- 活跃 session 排行
- 平均运行时长
- 最近失败的 session
- 长时间卡住的 session
- 工具调用异常集中的 session

这些信息不应该直接污染 `session` 本体，更适合做成独立的观测投影。

## 不解决什么

这份提案不解决：

- 单次请求的 distributed tracing
- worker 到 worker 的完整 span tree
- OpenTelemetry 具体接入方案
- 调用链上的 `traceId` / `requestId` 设计

这些属于“调用链追踪”问题，不属于 session 追踪本身。

## 核心设计

### 1. session 是被观察对象

`session` 继续保持最小职责：

- `sessionId`
- transcript 关联
- `cwd`
- model / thinking
- durable 状态

不建议把下面这些直接塞进 `session` 主记录：

- 累计运行时长
- 平均执行耗时
- 累计 bash 调用次数
- 累计 `mcp-client` 调用次数
- 最近 N 次失败摘要

### 2. session 追踪做成 projection

建议新增一类独立对象，例如：

- `session_runtime_projection`
- 或 `session_stats`

它通过事件和状态变更增量维护，而不是直接成为 `pi` session 或平台 session 本体的一部分。

### 3. 数据来源

建议最小来源如下：

| 来源 | 用途 |
|---|---|
| `session` 状态变更 | 创建、暂停、恢复、完成、失败 |
| durable transcript | 消息数、输入输出规模 |
| `agent_events` | 执行次数、工具调用次数、阶段耗时 |
| bash / 工具审计 | bash 与文件操作统计 |
| `mcp-client` 审计 | 外部能力调用统计 |

## 最小追踪字段

建议第一版先只做聚合字段：

| 字段 | 含义 |
|---|---|
| `session_id` | 关联会话 |
| `created_at` | session 创建时间 |
| `last_active_at` | 最近活跃时间 |
| `last_status` | 最近状态 |
| `total_active_duration_ms` | 累计活跃运行时长 |
| `total_message_count` | 累计消息数 |
| `total_tool_call_count` | 累计工具调用数 |
| `total_bash_call_count` | 累计 bash 调用数 |
| `total_mcp_client_call_count` | 累计 `mcp-client` 调用数 |
| `cancel_count` | 累计取消当前 prompt 执行次数 |
| `failure_count` | 累计失败次数 |
| `last_error_code` | 最近失败码 |
| `last_error_at` | 最近失败时间 |

## 最小使用场景

这份 projection 至少要支持：

1. 为最近 session 列表提供 `last_active_at`
2. 运营查看长时间活跃或频繁失败的 session
3. 后续按 session 维度做预算、限流、告警
4. 作为计费或配额分析的输入之一

## 与现有架构的关系

建议职责归属：

| 能力 | 归属 |
|---|---|
| 原始会话状态 | `session` |
| 原始事件 | transcript / durable events / audit logs |
| session 追踪聚合 | `Managed Agent Control Plane` |
| 对外展示 | `API Server` |

也就是说：

- `pi` session 不需要改
- 平台 session 本体不需要膨胀
- 只需要在控制平面增加一层增量聚合

## 为什么现在就值得立项

虽然 MVP 当前还不一定立即实现完整观测面板，但这件事值得先单独立项，因为它会影响：

- 事件保留粒度
- 审计字段设计
- 最近 session 列表的数据模型
- 后续告警和统计能力

先把它明确成独立 feature，后续就不会误把 tracing、session 状态、运营统计混成一个对象。

## 后续文档关系

这份提案只定义：

- 为什么需要 session 追踪
- 它和 session 本体、调用链 tracing 的边界
- 最小追踪字段和落位

后续如果继续展开，建议新增：

- `session-observability-design.zh-CN.md`

相关文档：

- [01-feature-proposal.zh-CN.md](./01-feature-proposal.zh-CN.md)
- [../design/minimal-architecture.zh-CN.md](../design/minimal-architecture.zh-CN.md)
- [../design/technical-design.zh-CN.md](../design/technical-design.zh-CN.md)

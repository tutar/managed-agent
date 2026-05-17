# Managed Agent 功能提案

- `Status`: active
- `Owner`: TBD
- `Related Design`:
  - [../design/minimal-architecture.zh-CN.md](../design/minimal-architecture.zh-CN.md)
  - [../design/technical-design.zh-CN.md](../design/technical-design.zh-CN.md)
  - [../interfaces/api-interface-draft.zh-CN.md](../interfaces/api-interface-draft.zh-CN.md)

## 概述

本文定义为什么要在现有 `pi` 能力之上构建 managed agent，以及为什么当前路线应当是：

- 运行时复用 `pi` 发布包
- 通过 `SDK` 组装执行内核
- 通过 `extensions` 暴露平台能力
- 在 `pi` 外层增加 control plane、sandbox、storage、audit

这不是一份“重写 pi”提案，而是一份“基于 pi 构建云端 managed agent”的提案。

## 提案结论

当前确认的实现路线如下：

| 主题 | 结论 |
|---|---|
| 执行内核 | 复用 `pi` SDK |
| 扩展方式 | `SDK` + `extensions` |
| `pi` 源码 | MVP 不修改 |
| 会话真相 | durable `sessionId` 与平台持久化状态 |
| 执行沙箱 | Firecracker MicroVM |
| 持久存储 | rclone 挂载远程存储 |
| 热数据层 | 高速本地磁盘 |
| 外部能力接入 | `mcp-client` |

## 为什么不是直接使用本地模式

`pi` 当前非常适合本地场景：

- CLI
- TUI
- 短生命周期 SDK 集成

但云端 managed agent 还要求：

- session 脱离单进程长期存在
- worker 短生命周期
- 工具执行与主服务隔离
- 事件、transcript、审计可持久化
- 前端和 chat 渠道通过服务端接口消费 agent

因此问题不是 `pi` 不能运行，而是需要在它外面补齐托管能力。

## 为什么选 `SDK`

`SDK` 是主路径，因为它允许平台直接复用：

- `Agent`
- `AgentSession`
- `AgentSessionRuntime`
- `DefaultResourceLoader`
- 内建 tool system

并在外层加入：

- session/run 持久化
- harness/worker 调度
- Firecracker sandbox 管理
- `mcp-client` 注册与策略
- SSE 投递
- 审计与配额

这比基于 CLI 壳或 RPC 壳做平台主架构更直接。

## 为什么还需要 `extensions`

`extensions` 在 managed agent 中仍然重要，因为它负责把平台能力投影成 agent 可见能力。

适合通过 `extensions` 承载的能力：

- 平台批准的自定义工具
- `mcp-client` 工具投影
- prompt 注入
- 受控的资源发现
- 平台侧补充的 agent-facing 能力

因此这套方案不是“只用 SDK”，而是：

- `SDK` 负责组装运行时
- `extensions` 负责扩展 agent 能力面

## 为什么不修改 `pi`

MVP 当前不修改 `pi`，原因有三点：

1. 现阶段问题主要在平台层  
   例如 session durable state、sandbox 生命周期、存储分层、审计、SSE，这些都更适合放在 `pi` 外层。

2. 当前需求还在收敛  
   如果过早改 `pi`，很容易把平台特定语义写死到上游抽象里。

3. 先验证边界更稳妥  
   先证明 `pi` + `SDK` + `extensions` 是否足以支撑 MVP，再决定是否需要上游补抽象。

## Managed Agent 的最小能力集合

MVP 至少需要：

- durable `sessionId`
- session 状态持久化
- 取消当前 prompt 执行
- Firecracker 执行沙箱
- `bash` / 文件工具
- `mcp-client`
- skills
- 受控 extensions
- SSE 事件流
- transcript
- 审计

这些能力都可以在不修改 `pi` 的前提下，由平台层 + `SDK` + `extensions` 实现。

## 文档边界

这份文档只回答三件事：

- 为什么做 managed agent
- 为什么采用 `pi` 的 `SDK` + `extensions`
- 为什么 MVP 不改 `pi`

具体架构见：

- [../design/minimal-architecture.zh-CN.md](../design/minimal-architecture.zh-CN.md)
- [../design/technical-design.zh-CN.md](../design/technical-design.zh-CN.md)
- [../interfaces/api-interface-draft.zh-CN.md](../interfaces/api-interface-draft.zh-CN.md)

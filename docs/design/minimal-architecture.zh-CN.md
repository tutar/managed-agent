# Managed Agent 平台最小可用架构说明书（中文版）

- `Status`: active
- `Owner`: TBD
- `Related Proposals`:
  - [../proposals/01-feature-proposal.zh-CN.md](../proposals/01-feature-proposal.zh-CN.md)
  - [../proposals/02-session-observability-feature-proposal.zh-CN.md](../proposals/02-session-observability-feature-proposal.zh-CN.md)
  - [../proposals/03-auth-foundation-feature-proposal.zh-CN.md](../proposals/03-auth-foundation-feature-proposal.zh-CN.md)
  - [../proposals/04-multi-tenant-feature-proposal.zh-CN.md](../proposals/04-multi-tenant-feature-proposal.zh-CN.md)
- `Related Interfaces`:
  - [../interfaces/api-interface-draft.zh-CN.md](../interfaces/api-interface-draft.zh-CN.md)
  - [../interfaces/workspace-service-backend-project-storage-design.zh-CN.md](../interfaces/workspace-service-backend-project-storage-design.zh-CN.md)

## 1. 文档目标

本文定义一个基于 `coding-agent` SDK 的 Managed Agent 平台最小可用架构（MVP）。

设计目标是：

- 先做单租户、单区域、单控制平面版本
- 面向对外产品，而不是内部脚本
- 支持长期会话、流式输出、可恢复执行、审计记录
- 支持 project/cwd 场景下的 bash、文件操作、mcp-client、skills、extensions
- 运行在 Kubernetes 上
- 预留下一阶段扩展为多用户、多租户、多工作区、多执行平面的能力

本文不追求一次性覆盖所有复杂能力，优先保证“最小可用且架构方向正确”。

## 1.1 实现前提：运行时依赖 pi 包，本仓库源码仅作参考

本文描述的 Managed Agent 平台，不是从零开始重写一套 agent runtime。

更准确地说，平台运行时应通过 pi 相关依赖包构建，而不是直接耦合当前仓库 `packages/` 下的源码路径。

目标依赖来源应是：

- `https://github.com/earendil-works/pi`
- 以及对应发布的 package

当前仓库 `packages/` 下的源码主要用于：

- 阅读实现
- 理解抽象边界
- 在确有必要时定位上游修改点

pi 依赖包在概念上主要覆盖：

- `packages/ai`
- `packages/agent`
- `packages/coding-agent`
- `packages/web-ui`（如后续需要直接复用前端组件）

实现优先级必须明确：

1. 优先复用已发布的 pi 依赖包
2. 优先通过 SDK 装配能力
3. 优先通过 extension、skills 扩展能力
4. MVP 阶段不做 pi 源码定制或状态模型修改，平台能力优先在外层实现

因此本文里的“平台层”应理解为：

- 在 pi 提供的执行内核之上增加 durable orchestration、storage、audit、policy、sandbox 管理
- 而不是替换 `Agent` / `AgentSession` / `AgentSessionRuntime`

## 2. 当前已确认的约束与需求

| 主题 | 已确认结论 |
|---|---|
| 客户端 | Web、飞书、Telegram、WhatsApp 等 |
| 输出方式 | Agent 输出持续流式返回 |
| 实时传输 | 优先 `SSE` |
| 继续方式 | 在同一 `sessionId` 上继续提交 prompt |
| 触发方式 | 支持手动触发、单次延时触发、周期触发 |
| 工具范围 | 允许 `bash`、文件操作、mcp-client、skills、extensions |
| 网络 | 允许 `bash` / mcp-client 联网 |
| 隔离 | 使用 Firecracker MicroVM 作为沙箱，提供 `cwd` 级文件系统隔离 |
| `cwd` | 一个 session 固定绑定一个 Firecracker MicroVM 内的工作根目录 |
| 部署 | Kubernetes |
| 审计 | 必须记录审计 |
| 模型接入 | 基于 pi 的 AI/provider 包，不自建兼容模型层 |
| mcp-client | 允许用户配置并注册 |
| 外部事件 | 当前已知为 MCP `notification`；webhook 是否支持仍未定 |
| 高风险命令 | `docker`、`kubectl` 默认禁用，按页面 allowlist 放开 |
| 风险重点 | 恶意脚本执行、额度耗尽、磁盘占满 |
| 文件存储 | 通过 rclone 挂载远程存储到 `/mnt/*` 分层目录 |

补充说明：

- session 固定绑定 `cwd`，是因为长运行周期 agent 需要在该 Firecracker 工作根目录内产生中间文件、脚本、工具结果和临时状态，不能全部只依赖上下文承载。

## 3. 传输层结论

### 3.1 为什么 MVP 优先用 SSE

| 方向 | 选择 |
|---|---|
| 上行 | HTTP API |
| 下行 | SSE |

适用原因：

- 服务端持续输出事件流
- 浏览器与网关兼容性更好
- 比 WebSocket 更容易无状态扩展

MVP 不把 WebSocket 作为必选项。后续需要双向实时控制时再增加。

### 3.2 建议的最小接口形态

| 接口 | 用途 |
|---|---|
| `POST /sessions` | 创建会话；如带首次 prompt，则直接流式返回该次执行输出 |
| `PATCH /sessions/{id}` | 修改会话标题 |
| `DELETE /sessions/{id}` | 归档会话；`running` 时返回 `409` |
| `POST /sessions/{id}/messages` | 提交用户输入，并直接流式返回该次执行输出 |
| `POST /sessions/{id}/cancel` | 取消当前 prompt 执行 |
| `GET /sessions/{id}` | 查询会话与历史消息 |
| `GET /users/{userId}/sessions` | 按 `limit/cursor` 游标分页查询最近会话 |

## 4. MVP 控制动作

MVP 只保留一个控制动作：

| 动作 | 是否 MVP 必做 | 语义 |
|---|---|---|
| `cancel` | 是 | 停止当前正在执行的 prompt |
| `abort` | 否 | 后续版本按需补充 |
| `retry` | 否 | 后续版本按需补充 |

### 4.1 `cancel` 语义

- 停止当前模型流
- 尝试取消正在执行的工具
- 不把 session 持久化成新的固定状态
- 后续若用户继续提交 prompt，则仍在同一个 session 内继续追加新的 entries

## 5. 为什么采用 SDK 模式

本平台应以 `coding-agent` SDK 为核心，而不是 `runPrintMode` 或 `runRpcMode`。

建议使用：

- `createAgentSessionRuntime()`
- `AgentSession`
- `Agent`

原因：

- `runPrintMode` 是一次性批处理壳，不适合长期托管会话
- `runRpcMode` 更适合作为跨进程协议边界或兼容层，而不是主架构
- Managed Agent 需要 durable session、可恢复执行、工具隔离、审计、调度和状态管理，SDK 更适合做服务端主干

后续如果为了隔离或跨语言支持，需要把某些执行单元放到子进程或 sidecar，可在执行边界上再引入 RPC，但不是主抽象。

## 5.1 复用策略：SDK 和 Extension 是第一选择

Managed Agent MVP 的推荐实现策略是：

- 执行内核：直接复用 SDK
- 扩展能力：优先用 extension / skills
- 平台能力：在服务层新增，而不是塞进 agent loop

### 5.1.1 直接复用的底层对象

- pi 依赖包中的 agent core
  - `Agent`
  - `runAgentLoop()`
- pi 依赖包中的 coding-agent SDK
  - `AgentSession`
  - `AgentSessionRuntime`
  - `createAgentSession()`
  - `createAgentSessionRuntime()`
  - `DefaultResourceLoader`
  - `ExtensionRunner`
  - 内建 tool system
- pi 依赖包中的 AI/provider 层
  - provider 接入
  - model registry 支撑
  - thinking level / stream API

### 5.1.2 优先通过 extension 或 skills 实现的能力

- mcp-client 投影为 agent 可调用工具
- prompt/system prompt 注入
- 部分审计埋点
- 部分 session 生命周期拦截
- 平台批准的扩展能力集

### 5.1.3 优先由服务层承担的能力

- session durable state 与触发关系
- prompt queue
- `cwd` 分配与回收
- 命令 allowlist policy
- mcp-client 注册、版本化和 capability snapshot
- SSE 事件投递
- 审计、预算、限流、配额

## 5.2 当前 pi 包与本仓库源码在 Managed Agent 场景中的角色

当前 pi 依赖包适合承担：

- 单次 session 执行
- 会话级上下文管理
- extension/tool 执行框架
- 模型调用和 provider 适配

当前 pi 依赖包默认不直接承担：

- durable control plane
- 多次 session 执行调度
- durable queue
- 多实例恢复
- 对外产品级审计与预算治理

因此架构上应坚持：

- 不改 `Agent` 的核心 loop 语义
- 不改 `AgentSession` 的基本定位
- 先在外层补齐托管能力
- 若后续确有抽象缺口，再单独评估是否推动 pi 上游补充抽象，但不纳入 MVP

补充说明：

- 本仓库 `packages/` 下的源码，是当前 pi 实现的可读参考
- 如果平台落地时发现 SDK/extension 抽象不够，应优先把改动设计成“可上游化”的变更
- 本文提到“需要改源码”，默认指“需要修改 pi 上游实现”，而不是要求平台长期直接依赖本仓库源码路径

## 6. MVP 架构总览

建议架构如下：

```text
Client / Channel
  ├─ Web Client
  ├─ Feishu
  ├─ Telegram
  └─ WhatsApp
        ↓
Nginx / Ingress
        ↓
Managed Agent API
  ├─ Web API Adapter
  ├─ Feishu Adapter
  ├─ Telegram Adapter
  ├─ WhatsApp Adapter
  ├─ ManagedSessionService
  ├─ TriggerService
  ├─ ActiveSessionRegistry
  ├─ EventPublisher
  └─ AuditService
        ↓
Harness Worker
  ├─ AgentSessionRuntime
  ├─ AgentSession
  ├─ Agent
  ├─ Extension Runner
  └─ Pi Tool Runtime
        ↓
Execution Plane
  ├─ Firecracker Sandbox Manager
  ├─ Bash/File Executor
  ├─ MCP Client Runtime
  └─ Skill / Extension Resource Loader
        ↓
Storage
  ├─ Metadata Store
  ├─ /mnt/transcripts
  ├─ /mnt/user-data/uploads
  ├─ /mnt/user-data/outputs
  └─ /mnt/user-data/tool_results
```

## 7. 最小核心组件说明

| 组件 | 主要职责 | MVP 备注 |
|---|---|---|
| Nginx / Ingress | 统一入口、TLS、限流、SSE 透传 | 由现成开源方案承载 |
| Managed Agent API | HTTP API、SSE、鉴权、限流、渠道适配、session/trigger/control | 渠道适配器可长驻；服务本地内存不持有真相 |
| Active Session Registry | 记录活跃 session 的轻量索引 | Control Plane 内部模块 |
| Harness Worker | 基于 durable state 构造 runtime 并执行 session | 独立部署服务 |
| Pi Tool Runtime | 运行 `pi` built-in tools、skills、extensions | Harness Worker 内部模块 |
| Firecracker Sandbox Manager | 按需拉起/销毁 Firecracker MicroVM，挂载 `cwd` 与分层存储 | Harness Worker 内部模块 |
| Metadata Store | durable session 关系、索引、状态、触发信息 | 建议使用数据库承载 |
| `/mnt/transcripts` | 会话 transcript 与事件流持久化目录 | 通过 rclone 挂载远程存储 |
| `/mnt/user-data/uploads` | 用户上传文件目录 | 通过 rclone 挂载远程存储 |
| `/mnt/user-data/outputs` | 用户可下载产物目录 | 通过 rclone 挂载远程存储 |
| `/mnt/user-data/tool_results` | 工具执行结果与大体积产物目录 | 通过 rclone 挂载远程存储 |

### 7.1 MVP 独立部署服务

MVP 固定按以下 3 个服务落地：

1. `Nginx / Ingress`
2. `Managed Agent API`
3. `Harness Worker`

### 7.2 服务与对象归属

| 服务 | 复用 `pi` 的对象 | 平台新增对象 |
|---|---|---|
| Nginx / Ingress | 无 | 无 |
| Managed Agent API | 无 | 渠道适配层、SSE endpoint、请求鉴权与协议映射、`ManagedSessionService`、`TriggerService`、`ActiveSessionRegistry`、`EventPublisher`、`AuditService` |
| Harness Worker | `Agent`、`AgentSession`、`AgentSessionRuntime`、`DefaultResourceLoader`、`ExtensionRunner` | `HarnessWorker`、`McpClientManager`、`AuditRecorder`、`FirecrackerSandboxManager`、`Pi Tool Runtime`、bash/file executor、`cwd` 挂载控制 |

### 7.3 Nginx / Ingress 与 Managed Agent API 边界

| 组件 | 定位 | 主要职责 |
|---|---|---|
| Nginx / Ingress | 薄入口层 | TLS、路由、基础鉴权接入、限流、CORS、WAF、SSE 透传、request id |
| Managed Agent API | managed-agent 应用接口层 | session API、消息提交、取消当前 prompt 执行、流式输出、渠道适配、业务身份解析、资源授权、session/trigger/control |

约束：

- 不把 session/`cwd` 语义放到 Nginx / Ingress
- 不把 Firecracker 生命周期、`mcp-client` 管理、审计落库放到 Nginx / Ingress
- Nginx / Ingress 只承载通用入口能力和基础鉴权拦截
- 业务身份解析与资源授权放在 Managed Agent API
- Managed Agent API 是外部协议与内部执行面的稳定边界

补充说明：

- 渠道适配器位于服务端侧，不在 client 侧
- 不预设所有 channel 使用同一种通信模式
- 不同 channel adapter 可分别采用：
  - 长连接
  - webhook / callback
  - 普通 HTTP
  - polling

### 7.4 横向扩展约束

为保证 3 个部署单元都能多副本部署，必须满足：

| 部署单元 | 横向扩展约束 |
|---|---|
| Nginx / Ingress | 不持有业务状态，只做入口层能力 |
| Managed Agent API | 不把 session 真相、活跃执行真相、去重真相放在本地内存 |
| Harness Worker | worker 无状态；同一 session 的并发执行由外部 lease/锁控制 |

关键要求：

- `pi` session、`user_sessions`、trigger、audit、metadata 必须外置持久化
- `ActiveSessionRegistry` 只能是缓存、投影视图或 lease 视图，不能是唯一真相
- channel adapter 若需要跨副本协调，必须外置或采用单消费者策略
- 任意一个 Managed Agent API 副本都应能处理创建 session、提交消息、取消当前 prompt 执行与查询
- 任意一个 Harness Worker 副本都应能根据共享 job 和 durable state 重建 runtime
- 对内统一投影为 session 创建、prompt 提交、取消当前 prompt 执行和流式输出消费

### 7.4 `cwd` 分配策略

| 策略 | 结论 |
|---|---|
| 创建 session 时立即创建 `cwd` | 否 |
| 首次需要 project/`cwd` 执行时懒分配 | 是 |
| `cwd` 与 session 绑定 | 是，表现为 session 绑定一个 Firecracker 内工作根目录 |
| session 长期空闲后可冻结/归档/回收 | 是 |

### 7.5 存储分层与挂载约定

| 挂载路径 | 用途 | 备注 |
|---|---|---|
| `/mnt/transcripts` | 会话记录、事件流、可恢复 transcript | 实际由 rclone 挂载到 `/tmp/rclone-mounts/*_mnt_transcripts` |
| `/mnt/user-data/uploads` | 用户上传文件 | 实际由 rclone 挂载到 `/tmp/rclone-mounts/*_mnt_user-data_uploads` |
| `/mnt/user-data/outputs` | 用户下载文件、导出文件 | 实际由 rclone 挂载到 `/tmp/rclone-mounts/*_mnt_user-data_outputs` |
| `/mnt/user-data/tool_results` | 工具执行结果、大体积工具产物 | 实际由 rclone 挂载到 `/tmp/rclone-mounts/*_mnt_user-data_tool_results` |

## 8. 关键运行语义设计

### 8.1 Session 与执行

当前 MVP 不把 `run` 作为平台一等对象。

约定：

- 普通对话场景下，同一 session 上的多次执行，本质上是 `pi` session 内的多次 prompt 历史
- 定时任务或外部事件场景下，trigger 会创建一个新的 session 并触发首次执行
- 平台主要管理 `sessionId` 与 trigger，而不是单独管理 `runId`

### 8.2 Session 后续继续执行

根据你目前的要求，同一 session 的后续执行方式是：

- 基于已有 `sessionId`
- 再次提交新的 prompt
- 由平台重新装配 runtime，在同一个 session 内继续对话

### 8.3 运行态来源

页面上的运行态不依赖 `session.status` 持久字段，而由事件流决定：

- 持续收到输出和工具事件时，前端视为运行中
- 最终输出结束、工具流程结束或流被关闭后，前端视为本次执行结束
- 失败信息通过错误输出或中断结果传达，不额外依赖独立的 session 失败事件

### 8.4 Trigger / Scheduled Session 模型

除用户直接提交消息外，MVP 还应支持任务触发型 session 执行。

| trigger_type | 说明 |
|---|---|
| `manual` | 用户主动提交消息 |
| `scheduled_once` | 到达指定时间点后执行一次 |
| `scheduled_cron` | 周期触发 |
| `external_event` | 外部事件触发 |

补充说明：

- 普通对话场景下，多次执行信息已经天然在 `pi` session 的 prompt 历史中
- 定时任务或外部事件的本质是：trigger 创建一个新的 session，并把预先准备好的 prompt 作为首次输入
- 若配置了 project / `cwd` / skills / `mcp-client` / instructions，则在该 session 创建后一起加载
- 当前已知外部事件来源是 MCP `notification`
- webhook 是否作为外部事件来源，当前仍未定

### 8.5 Session、Harness 与 Sandbox 的生命周期

| 对象 | 生命周期语义 |
|---|---|
| Session | durable 对象，持续存在 |
| Harness | 长生命周期对象，负责持有 session、queue、调度状态 |
| Firecracker Sandbox | 短生命周期对象，有消息时按需启动，空闲数秒后关闭或销毁 |

MVP 运行模型建议：

- 用户有新消息进入 session queue 时，再临时拉起 Firecracker sandbox
- sandbox 启动后加载当前 session 所需上下文并执行
- 若几秒内无新消息、无工具执行、无活跃模型流，则关闭或销毁 sandbox
- `harness` 和 `session` 不随 sandbox 销毁而消失，继续保留 durable 状态与排队消息

## 9. 推荐的代码与对象边界

## 9.1 内核继续复用的对象

- `Agent`
- `AgentSession`
- `AgentSessionRuntime`
- `ExtensionRunner`
- `DefaultResourceLoader` 或其派生实现
- `ModelRegistry`
- `SettingsManager`

这些对象继续作为执行内核，而不是被平台层重写。

### 9.2 需要平台层新增的对象

- `ManagedSessionService`
- `TriggerService`
- `ActiveSessionRegistry`
- `EventPublisher`
- `AuditRecorder`
- `WorkspaceSandboxManager`
- `McpClientManager`
- `SessionRepository`
- `EventRepository`

## 9.3 能力落位：SDK、Extension 与服务层的分工

| 能力 | 优先实现位置 |
|---|---|
| 单次 session 执行 | `Agent` / `AgentSession` |
| 会话运行时切换 | `AgentSessionRuntime` |
| 模型调用 | pi 依赖包中的 AI/provider 层 |
| 内建 read/bash/edit/write 等工具 | pi 依赖包中的 coding-agent tool system |
| `pi` built-in tools | 在 Firecracker 内的 `cwd` 上执行 |
| skills | 直接复用 skills loader 与规范 |
| mcp-client 对 agent 暴露 | `McpClientManager` + extension/skills |
| `cwd`/sandbox policy | 服务层 + Firecracker 执行层 |
| 审计 | 服务层为主，必要处增加 extension hook |
| 命令可用性控制 | 平台 policy + Firecracker 执行策略 |

## 9.4 MVP 关于 pi 的边界

MVP 默认不做以下事情：

- 不修改 pi 源码
- 不修改 pi 的 session/state model
- 不为 Managed Agent 单独定制一套 fork 版 runtime

MVP 默认通过以下方式落地平台能力：

| 能力 | 落地点 |
|---|---|
| durable session | `pi` session 持久化 |
| trigger / 关系投影 | 平台服务层 + metadata store |
| transcript / event 持久化 | `/mnt/transcripts` |
| `cwd` 隔离执行 | Firecracker sandbox |
| bash/file/mcp-client policy | Firecracker 执行层 + 平台策略 |
| mcp-client 注册与投影 | 平台层 + extension/skills |
| skills / extensions | 复用 pi 现有规范与加载机制 |

只有在外层实现无法满足核心产品需求时，才单独提出“需要推动 pi 上游补抽象”的议题；该议题不属于 MVP 范围。

## 10. 建议的数据模型

MVP 最少应有这些 durable 记录。

### 10.1 `pi` session

会话真相直接复用 `pi` session 持久化，不单独定义平台 `sessions` 主表。

`pi` session 至少已经承载：

- `session_id`
- `cwd`（Firecracker 内工作根目录）
- transcript / messages
- model / thinking 变更
- session name
- extension custom entries

### 10.2 user_sessions

作为轻量列表投影和用户归属关系表，建议至少保留：

- `user_id`
- `session_id`
- `session_name`
- `created_at`
- `last_active_at`
- `archived_at`

用途：

- 按 `userId` 查最近 session
- 按 `last_active_at desc, session_id desc` 稳定排序
- 列表页直接展示 `session_name`
- 已归档 session 不返回

### 10.3 scheduled_triggers

字段建议：

- `trigger_id`
- `trigger_type`
- `run_at`
- `model`
- `thinking_level`
- `prepared_input`
- `status`

### 10.4 session_entries

用于 durable transcript / branch / compaction 记录。

### 10.5 agent_events

用于保存流式事件：

- `agent_start`
- `message_update`
- `tool_execution_start`
- `tool_execution_end`
- `agent_end`

### 10.7 audit_logs

建议至少记录：

- 操作人/调用方
- sessionId
- 工具名
- mcp-client 名称
- bash 命令摘要
- 文件修改摘要
- 时间戳

## 11. 事件流设计

SSE 事件建议分两层：

### 11.1 面向客户端的 Live Event

用于 UI/chat 集成消费。

建议拆成“过程事件”和“最终输出事件”两组，并由请求参数控制是否返回。

建议参数：

- `includeProcess=true|false`
- `includeFinal=true|false`

建议事件类型：

- `process.delta`
- `action.started`
- `action.completed`
- `action.failed`
- `final.output.delta`
- `final.output.completed`
- `run.cancelled`
- `run.failed`

约束：

- 当前前端默认展示过程事件
- 若请求方只关心最终回复，可关闭过程事件
- 前端接口不直接暴露 assistant/tool 原始边界，服务端先组装成高层事件
- 页面“运行中”由事件流是否结束决定，不依赖持久化 `session.status`
- `run.cancelled` 与 `final.output.completed` 互斥

### 11.2 面向内部的 Durable Event

用于恢复、调试、审计。

建议保留更原始的 session/agent 事件。

说明：

- SSE 发的是 projection/live event
- store 里存的是更原始、可回放的 durable event

## 12. 工具执行与隔离设计

### 12.1 文件与 bash 工具

建议走 Firecracker MicroVM，不要直接在 API 进程执行，也不要把 session/harness 生命周期绑到沙箱上。

要求：

- 每个 `cwd` 指定一个 Firecracker 内工作根目录，并挂载到对应 sandbox
- 所有路径必须在 root 内
- shell 执行必须带超时
- 输出量受限
- 写操作可审计
- `cwd` 必须有容量限制
- 临时文件、缓存文件、产出文件需要分别统计和清理
- 单次 session 执行的文件写入量、文件数量、总输出量都要有限额
- 需要定期回收僵尸进程、孤儿脚本和失控子进程
- sandbox 空闲数秒后应自动关闭或销毁

MVP 建议至少实现以下资源护栏：

- 单 `cwd` 磁盘配额
- 单次 session 执行最大 stdout/stderr 大小
- 单命令最大执行时长
- 单 session 最大并发子进程数
- 单 session 最大累计工具调用数
- 单次 session 执行最大 bash 调用次数
- 单 mcp-client 调用超时与最大返回体积
- 单 sandbox 最大空闲存活时长

命令授权建议：

- 默认允许基础开发命令和平台批准命令
- 默认拒绝高风险基础设施命令，如 `docker`、`kubectl`
- 允许用户在页面上配置“本 agent 可用命令清单”
- 服务端按命令前缀进行 allowlist 校验

建议不要做纯 denylist，而是做：

- 平台级默认 allowlist
- 用户级增量 allowlist
- 平台保留强制 denylist

原因：

- 对外产品场景下，denylist 很难覆盖变体
- allowlist 更适合和额度、审计、`cwd` 配额一起治理

对于恶意或误用脚本，MVP 不做人工审批，但要有自动防护：

- 命令超时终止
- 输出截断
- 文件写入配额
- 递归创建文件数限制
- 进程树 kill
- 速率限制
- mcp-client 调用预算限制

### 12.2 MCP Client

不建议把它定义成独立的一级协议层。更合适的做法是：平台实现 MCP 规范里的 client 角色，由对应 extension 或 skill 在需要时调用 `McpClientManager`。

职责：

- 管理外部服务连接
- 统一权限控制
- 审计所有出站调用
- 统一 timeout / retry / circuit breaker

根据当前要求，mcp-client 允许由用户配置并注册，因此需要增加一层“受控注册”能力：

- 用户可以注册 mcp-client 配置
- 平台需要校验配置格式、目标地址、认证方式和可访问范围
- mcp-client 注册记录应 durable 化
- mcp-client 的启用、禁用、修改都要进审计

MVP 建议限制：

- 只允许平台支持的 mcp-client 类型
- 只允许声明式配置，不允许任意执行代码
- 限制可访问域名/IP 范围
- 对每类 mcp-client 配置默认调用速率、超时和返回大小上限

### 12.2.1 基于最新 MCP 规范的落地约束

mcp-client 设计建议参照 MCP 当前公开规范和草案能力，至少满足以下方向：

- 资源（resources）
  - server 通过 capability 声明 `resources`
  - 可选支持 `subscribe` 与 `listChanged`
- 提示模板（prompts）
  - server 通过 capability 声明 `prompts`
  - 支持 `prompts/list`
  - prompt 集可以随授权变化
- 工具（tools）
  - server 通过 capability 声明 `tools`
  - 支持 `tools/list`
  - 可选支持 `listChanged`
- roots
  - client 可以通过 `roots/list` 暴露可访问根目录
  - 这与 session 绑定的 Firecracker 工作根目录天然契合
- HTTP 授权
  - HTTP transport 下使用 OAuth 2.1 Bearer token
  - MCP server 作为 protected resource
  - client 按 request 携带 token，而不是按连接绑定

这意味着在平台设计上：

- mcp-client 配置不能只存“server URL”
- 还要存 capability、auth mode、scope、root 策略、网络策略、调用预算
- prompt/resource/tool 列表应作为可缓存但可刷新元数据
- mcp-client 元数据应支持 `listChanged` 类更新

推荐在平台中落 3 类对象：

- `McpClientDefinition`
  - 平台支持的 mcp-client 类型模板
- `McpClientRegistration`
  - 用户注册的一条 mcp-client 实例配置
- `McpClientCapabilitySnapshot`
  - 最近一次探测到的 MCP capability、tools/prompts/resources 元数据快照

### 12.2.2 MCP 版本策略

MVP 不建议尝试“兼容所有历史 MCP 版本”。

建议：

- 平台内部选定一个基线 MCP 协议版本
- 首选当前稳定版规范能力
- 对个别已进入草案但业务价值高的能力，采用 feature flag

当前参考点：

- 2025-11-25 的授权规范已明确 MCP server 作为 OAuth protected resource
- 2025-06-18 规范已覆盖 tools/resources/prompts/roots 等主干能力
- 2026 年草案与 SEP 中已经出现 stateless、sessionless、multi round-trip 等方向，但不建议 MVP 直接依赖

### 12.3 Skills

建议：

- 继续遵循现有 skills 规范
- 由 `ResourceLoader` 加载
- 允许 `cwd`-local skills
- 技能文件本身应可审计和版本化

### 12.4 Extensions

MVP 支持 extension，但要分级：

- Level 1：只允许受控 extension
- Level 2：用户自定义 extension

作为对外产品，MVP 建议先只支持平台批准的 extension 集合，不直接开放任意第三方代码注入。

说明：

- 用户可注册 mcp-client
- 不等于用户可上传任意 extension 代码

MVP 阶段建议：

- mcp-client 配置开放
- extension 代码注入关闭
- skills 按规范开放

## 13. Kubernetes 部署建议

MVP 建议最少拆成两个逻辑角色：

- `managed-agent-api`
- `managed-agent-worker`

初期如果为了简单，也可以先同一镜像、同一部署，靠模块分层区分职责。

推荐基础依赖：

- PostgreSQL
- rclone 挂载的远程存储
- Redis（可选，用于活跃 runtime 注册、SSE fanout、短期锁）

MVP 如果想压缩复杂度：

- PostgreSQL 必选
- rclone 挂载存储必选
- Redis 可以暂时不作为硬依赖

存储建议分层如下：

| 路径 | 用途 |
|---|---|
| `/mnt/transcripts` | transcript、事件流、恢复所需文本记录 |
| `/mnt/user-data/uploads` | 用户上传文件 |
| `/mnt/user-data/outputs` | 用户下载文件、导出文件 |
| `/mnt/user-data/tool_results` | 工具结果、大体积中间产物 |

## 14. MVP 边界建议

### 14.1 MVP 必做

| MVP 必做 | 说明 |
|---|---|
| `pi` session 作为会话真相 | 不再重复定义平台 session 主模型 |
| SSE 实时事件输出 | 面向 Web/chat 客户端 |
| durable transcript | 可恢复、可回放 |
| `cancel` | 停止当前正在执行的 prompt |
| Firecracker `cwd` 沙箱 | project/cwd 场景必须 |
| bash/file tools | MVP 核心执行能力 |
| mcp-client adapter | 外部服务接入 |
| skills | 复用现有规范 |
| extensions（受控范围） | 仅平台批准扩展 |
| 审计日志 | 对外产品必需 |

实现原则补充：

- 优先通过 SDK + extension 实现
- MVP 不做 pi 源码定制或状态模型修改
- 平台能力优先放在 control plane、sandbox、storage、tool router

### 14.2 MVP 暂不强做

- 多租户
- 用户自定义任意 extension 执行
- `abort` / `retry`
- WebSocket
- 多区域部署
- session 内真正多 writer 并发执行

## 15. 需要进一步确认的信息

以下信息仍然会直接影响接口和实现边界，建议尽快补齐。

### 15.1 用户与身份模型

虽然当前不做多租户，但仍需确认：

- session 是绑定用户、绑定 `cwd`，还是绑定 bot 会话？
- Web / 飞书 / Telegram / WhatsApp 是否共用同一 session id 空间？
- 不同渠道是否允许映射到同一个会话？

### 15.2 Workspace 与项目模型

当前已确认：

- 一个 session 固定绑定一个 `cwd`

仍需确认：

- 一个用户是否能在一次产品使用过程中切换到另一个 `cwd` 并创建新 session？
- `cwd` 是否是已有平台资源，还是由本平台创建和托管？

当前倾向建议：

- `cwd` 由平台按需分配
- 不是在 session 创建时强制预分配
- 由 agent 真正需要 project execution 时懒创建

### 15.3 MCP Client 的接入模式

当前已确认：

- mcp-client 允许用户配置并注册

仍需确认：

- mcp-client 调用是否需要细粒度授权？
- 是否有出站网络白名单要求？
- 用户注册 mcp-client 时，配置变更是否需要版本化？

建议默认答案：

- 需要细粒度授权
- 需要出站网络白名单
- mcp-client 配置需要版本化

### 15.4 审计保留策略

需要确认：

- 审计日志保留多久？
- bash 原始命令和输出是否全部保留？
- 文件 diff 是否全量保留？
- mcp-client 请求体/响应体是否允许落审计？

### 15.5 安全策略

需要确认：

- 是否需要 bash 命令 denylist / allowlist？
- 是否允许联网？
- 是否允许执行包管理器、git、docker、kubectl 等命令？

当前已确认：

- 不引入人工审批流
- 允许 bash 联网

当前建议：

- 高风险命令采用 allowlist 模型
- `docker`、`kubectl` 默认禁用
- 是否放开某类命令，通过页面配置并写入 agent policy
- `git`、包管理器是否默认开放，仍需单独确认

新增必须落实的自动防护项：

- session 级 token 预算
- `cwd` 磁盘配额
- 脚本执行超时
- 进程树回收
- 输出大小限制
- mcp-client 额度与速率限制

### 15.6 Session 执行调度模型

需要确认：

- 一个 session 同时最多允许多少待处理消息？
- 是否需要优先级队列？
- 是否要支持定时重试和延迟执行？

当前建议：

- MVP 至少支持 `scheduled_once`
- 如近期就有周期任务需求，则一并支持 `scheduled_cron`
- 外部事件触发当前先以 MCP `notification` 为已知输入
- webhook 触发是否需要支持，仍待确认

### 15.7 计费与配额

对外产品通常要尽早考虑：

- 是否按 token、按 session 执行、按工具调用、按 mcp-client 调用计费？
- 是否有限额与预算中断？

### 15.8 可观测性要求

需要确认：

- 是否需要 Prometheus 指标？
- 是否需要按 session 维度的 trace？
- 是否需要面向运营的会话回放视图？

## 16. 推荐的下一步产出

基于本文，下一步建议继续输出 4 份文档：

1. `Managed Agent API 接口草案（中文版）`
2. `Managed Agent Session 执行流设计（中文版）`
3. `Workspace Sandbox 设计（中文版）`
4. `MCP Client 与审计设计（中文版）`

如果只优先做一份，建议先做：

- `Session 执行流设计`

因为它会决定：

- cancel 当前 prompt 执行的真正语义
- SSE 事件模型
- worker 恢复方式

## 17. 建议的实现顺序

为了确保是“基于 pi 增量构建”，而不是重新发明一套系统，建议按下面顺序推进：

1. 用当前 `createAgentSessionRuntime()` 做出最小服务进程
2. 在服务层接 durable session 关系、trigger 与观测存储
3. 把 `AgentSession` 事件流投递到 SSE
4. 用 extension/skills 接入 mcp-client 与审计
5. 加入 Firecracker sandbox、rclone 挂载存储与命令 allowlist policy
6. 若出现阻塞，优先在平台层收敛需求或补服务层抽象，不把 pi 上游改造纳入 MVP

这样能尽早验证三件事：

- 当前 pi 依赖包是否足以支撑托管运行
- 哪些能力完全可以通过服务层、sandbox 和 extension 完成
- 当前的沙箱与存储分层是否足以支撑托管运行

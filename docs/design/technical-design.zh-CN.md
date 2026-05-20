# Managed Agent 技术设计

- `Status`: active
- `Owner`: TBD
- `Related Proposals`:
  - [../proposals/01-feature-proposal.zh-CN.md](../proposals/01-feature-proposal.zh-CN.md)
  - [../proposals/02-session-observability-feature-proposal.zh-CN.md](../proposals/02-session-observability-feature-proposal.zh-CN.md)
  - [../proposals/03-auth-foundation-feature-proposal.zh-CN.md](../proposals/03-auth-foundation-feature-proposal.zh-CN.md)
  - [../proposals/04-multi-tenant-feature-proposal.zh-CN.md](../proposals/04-multi-tenant-feature-proposal.zh-CN.md)
  - [../proposals/05-llm-provider-registry-feature-proposal.zh-CN.md](../proposals/05-llm-provider-registry-feature-proposal.zh-CN.md)
- `Related Interfaces`:
  - [../interfaces/api-interface-draft.zh-CN.md](../interfaces/api-interface-draft.zh-CN.md)
  - [../interfaces/workspace-service-backend-project-storage-design.zh-CN.md](../interfaces/workspace-service-backend-project-storage-design.zh-CN.md)

## 总览

本文描述当前 MVP 如何基于 `pi` 的 `SDK` 和 `extensions` 落地 managed agent。

本文不讨论“如何改造 `pi` 源码”，只讨论：

- 平台层如何装配 `pi`
- session / harness / sandbox 如何协作
- Firecracker、rclone、高速热盘如何接入
- `mcp-client`、skills、extensions 如何进入执行面

## 技术原则

| 主题 | 设计原则 |
|---|---|
| `pi` 集成 | 依赖 `pi` 发布包 |
| 扩展方式 | `SDK` + `extensions` |
| 上游修改 | MVP 不改 `pi` |
| durable truth | 平台持久化状态，而不是内存中的 `AgentSession` |
| 继续方式 | 在同一 `sessionId` 上继续提交 prompt |
| 沙箱 | Firecracker MicroVM |
| transcript 主写路径 | 高速本地磁盘上的 append-only JSONL |
| transcript 远端同步 | 异步同步到对象存储 |
| 远端挂载层 | rclone 挂载远程存储 |
| 热执行层 | 高速本地磁盘 |
| 外部事件 | 当前已知为 MCP `notification`；webhook 仍未定 |

## 服务与对象归属

MVP 固定按以下 3 个独立部署单元落地：

1. `Nginx / Ingress`
2. `Managed Agent API`
3. `Harness Worker`

| 对象 | 类型 | 所属服务 |
|---|---|---|
| `Agent` | 复用 `pi` | `Harness Worker` |
| `AgentSession` | 复用 `pi` | `Harness Worker` |
| `AgentSessionRuntime` | 复用 `pi` | `Harness Worker` |
| `DefaultResourceLoader` | 复用 `pi` | `Harness Worker` |
| `ExtensionRunner` | 复用 `pi` | `Harness Worker` |
| `WebApiAdapter` | 平台新增 | `Managed Agent API` |
| `FeishuAdapter` | 平台新增 | `Managed Agent API` |
| `TelegramAdapter` | 平台新增 | `Managed Agent API` |
| `WhatsAppAdapter` | 平台新增 | `Managed Agent API` |
| `IdentityResolver` | 平台新增 | `Managed Agent API` |
| `AuthorizationGuard` | 平台新增 | `Managed Agent API` |
| `StreamResponseProxy` | 平台新增 | `Managed Agent API` |
| `ManagedSessionService` | 平台新增 | `Managed Agent API` |
| `LlmProviderService` | 平台新增 | `Managed Agent API` |
| `LlmProviderCatalog` | 平台新增 | `Managed Agent API` |
| `LlmProviderOAuthService` | 平台新增 | `Managed Agent API` |
| `TriggerService` | 平台新增 | `Managed Agent API` |
| `ActiveSessionRegistry` | 平台新增 | `Managed Agent API` |
| `EventPublisher` | 平台新增 | `Managed Agent API` |
| `AuditService` | 平台新增 | `Managed Agent API` |
| `HarnessWorker` | 平台新增 | `Harness Worker` |
| `McpClientManager` | 平台新增 | `Harness Worker` |
| `AuditRecorder` | 平台新增 | `Harness Worker` |
| `FirecrackerSandboxManager` | 平台新增 | `Harness Worker` |

补充说明：

- `Managed Agent API` 同时承载协议/渠道层和控制平面层
- session durable state 仍归 `pi` session 与外部持久化对象承载，而不是该服务本地内存
- 用户级 LLM provider registry 也归 `Managed Agent API` 承担；worker/harness 只消费已经解析好的运行时 provider config
- OAuth 型 provider 的浏览器授权编排也归 `Managed Agent API` 承担；worker/harness 不负责第三方授权交互

## Nginx / Ingress 与 Managed Agent API

从可扩展性和可维护性出发，当前 MVP 采用：

- 薄 `Nginx / Ingress`
- 稳定 `Managed Agent API`

### Nginx / Ingress

只负责通用入口能力：

- TLS
- 路由
- 基础鉴权接入
- 限流
- CORS
- WAF
- SSE 透传
- request id 注入

### Managed Agent API

部署上，`Managed Agent API` 合并了原来的 `API Server` 与 `Managed Agent Control Plane`。

逻辑上仍分为两层：

- API/Channel Layer
- Control Plane Layer

其中 API/Channel Layer 负责：

- session API
- 用户消息提交
- 取消当前 prompt 执行
- SSE 事件接口
- transcript 查询
- 渠道适配
- 业务身份解析
- 资源授权

Control Plane Layer 负责：

- `ManagedSessionService`
- `LlmProviderService`
- `TriggerService`
- `ActiveSessionRegistry`
- `EventPublisher`
- `AuditService`

渠道适配补充说明：

- channel adapter 是服务端协议适配层，不在 client 侧
- 不要求所有 channel 都使用同一种传输方式
- 不同 adapter 可按 channel 特性分别实现为：
  - 长连接
  - webhook / callback
  - 普通 HTTP
  - polling
- 对内统一映射为 session API 与流式输出消费

### 边界约束

- Nginx / Ingress 不理解 session/`cwd` 状态
- Nginx / Ingress 不持有 Firecracker 或 `mcp-client` 语义
- Nginx / Ingress 只做基础鉴权拦截，不承担业务授权
- `Managed Agent API` 是外部协议与内部执行面的稳定边界

## 横向扩展约束

为保证每个部署单元都能多副本横向扩展，必须满足以下约束：

| 部署单元 | 横向扩展要求 |
|---|---|
| `Nginx / Ingress` | 不持有业务状态，只做入口层能力 |
| `Managed Agent API` | 不把 session 真相、活跃执行真相、去重真相放在本地内存 |
| `Harness Worker` | worker 无状态；执行 job 来自共享调度源；同一 session 的并发执行靠外部 lease/锁约束 |

具体要求：

- `pi` session、`user_sessions`、trigger、audit、metadata 必须外置持久化
- `ActiveSessionRegistry` 只能是缓存、投影视图或 lease 视图，不能是唯一真相
- channel adapter 的连接状态若需要跨副本协调，必须外置或明确单消费者策略
- `Managed Agent API` 任意副本都应能处理 session 创建、消息提交、取消当前 prompt 执行与查询
- `Harness Worker` 任意副本都应能根据共享 job 和 durable state 重建 runtime

## 服务间调用链

### 用户触发链路

| 调用方向 | 作用 |
|---|---|
| `Nginx / Ingress -> Managed Agent API` | 对外 HTTP/SSE 入口 |
| `Managed Agent API -> Harness Worker` | 创建 session、提交消息、取消当前 prompt 执行后，下发执行 job |
| `Harness Worker -> Metadata/Transcript Store` | 写回执行结果；第一版不主动读取 session metadata |
| `Harness Worker -> FirecrackerSandboxManager` | 拉起沙箱、挂载 `cwd`、执行工具 |

### 定时/事件触发链路

| 调用方向 | 作用 |
|---|---|
| `Scheduler/Event Source -> Managed Agent API` | 创建待执行 trigger |
| `Managed Agent API -> Harness Worker` | 为对应 `sessionId` 创建并下发执行 job |

补充说明：

- 当前已知外部事件源是 MCP `notification`
- webhook 是否进入这条链路，当前仍未定
- `Harness Worker` 不应通过 `Managed Agent API` 获取 session
- 当前第一版里，`Harness Worker` 不直接读取 session metadata store
- 当前第一版里，`Managed Agent API` 先读取 durable metadata，并把执行所需参数组装为完整 job payload
- worker 根据 job 中的 `model`、`thinkingLevel`、`input`、`piSessionFile` 等字段重建 runtime
- 这里的 runtime 重建，当前主要指在 worker 内基于 `piSessionFile` 重新构造 `AgentSessionRuntime` / `AgentSession` 执行上下文

## 运行时总图

```text
Client / Channel
        ↓
Managed Agent API
  ├─ Web API Adapter
  ├─ Feishu Adapter
  ├─ Telegram Adapter
  └─ WhatsApp Adapter
        ↓
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
  └─ Extension Runner
        ↓
Pi Tool Runtime
  ├─ Firecracker Sandbox Manager
  ├─ McpClientManager
  └─ Audit Recorder
```

## Worker 重建

`Harness Worker` 不等于 `pi` runtime，但其核心执行单元直接复用 `pi` runtime。

最小重建步骤：

1. worker 根据 `sessionId` 读取 session durable state
2. 读取 transcript、`cwd`、`model`、`thinkingLevel`
3. 读取 `/mnt/skills`、`/mnt/extensions` 的当前可见内容
4. 读取 `mcp-client` metadata
5. 在 worker 内重新构造 `AgentSessionRuntime` / `AgentSession`
6. 把本次输入注入该 runtime 并执行

## 生命周期设计

### Session

- durable 对象
- 由 `sessionId` 标识
- 不依赖某个具体进程存活

### Harness

- 长生命周期逻辑对象
- 持有 session 相关调度状态
- 不要求一直绑定某个沙箱

### Firecracker Sandbox

- 短生命周期执行对象
- 有消息时按需启动
- 空闲数秒后关闭或销毁

## Session、Harness、Sandbox 关系

| 对象 | 是否 durable | 是否长驻 | 说明 |
|---|---|---|---|
| Session | 是 | 是 | 会话身份与持久化状态 |
| Harness | 否，但其状态可持久化 | 逻辑上长驻 | 负责调度与运行控制 |
| Firecracker Sandbox | 否 | 否 | 只承载一次或一段执行 |

### 关键语义

- 用户有新消息时，平台根据 `sessionId` 找到对应 session
- harness 决定是否需要启动新的执行
- 需要执行时临时拉起 Firecracker sandbox
- sandbox 加载当前 session 对应的 `cwd` 与上下文
- 执行结束或空闲后销毁 sandbox
- session 与 harness 状态继续保留

## Session 后续继续执行

同一 session 的后续执行方式是：

- 根据 `sessionId` 找到已有 session
- 继续提交新的 prompt
- 重新建立当前可用的运行实例
- 不要求复用上一个沙箱或上一个进程对象

## Trigger / Scheduled Session Execution

MVP 的 session 执行不仅来自用户实时输入，还应来自任务调度。

| trigger_type | 含义 |
|---|---|
| `manual` | 用户直接提交消息 |
| `scheduled_once` | 单次延时任务 |
| `scheduled_cron` | 周期任务 |
| `external_event` | 外部事件触发 |

任务触发型 session 执行的最小语义：

- trigger 到期或外部事件到达时，先创建一个新的 session
- `preparedInput` 成为该 session 的首次 prompt
- 若配置了 project / `cwd` / skills / `mcp-client` / instructions，则在 session 创建后一起加载
- 再在 Firecracker 内执行 `pi` tools / skills / extensions

## Control Plane 对象收敛

当前 MVP 建议只保留这 4 个一等对象：

| 对象 | 职责 |
|---|---|
| `ManagedSessionService` | 创建 session、查询 session、重命名 / 归档 session、取消当前 prompt 执行、维护 `user_sessions` 投影 |
| `TriggerService` | 创建 `scheduled_trigger`、接收外部事件、到期时创建新 session 并注入首次 prompt |
| `EventPublisher` | 把内部原始事件组装成高层 UI 事件后投递给 SSE，并按请求参数裁剪过程事件/最终输出事件 |
| `AuditService` | 审计写入入口 |

补充说明：

- `ActiveSessionRegistry` 只作为 Control Plane 内部模块，记录当前活跃 session 的轻量索引
- 不把 runtime 本身当 durable state

### `ManagedSessionService` 最小职责边界

建议 `ManagedSessionService` 只保留以下 5 个职责：

1. 创建 session
2. 读取 session 基本信息
3. 更新 session 级轻量属性
4. 取消当前 prompt 执行
5. 维护 session 级轻量投影

具体说明：

| 职责 | 说明 |
|---|---|
| 创建 session | 创建新的 `pi` session，初始化最小 metadata，写入 `user_sessions` |
| 读取 session 基本信息 | 为 `GET /sessions/{sessionId}` 提供最小会话信息 |
| 更新 session 级轻量属性 | 支持 rename 与 archive 等轻量控制动作 |
| 取消当前 prompt 执行 | 协调停止当前正在执行的 prompt |
| 维护 session 级轻量投影 | 更新 `user_sessions`、`last_active_at`、`session_name` 等轻量字段 |

不应放入 `ManagedSessionService` 的职责：

- trigger 创建与调度
- SSE 推送
- 审计写入
- Firecracker 生命周期管理
- `mcp-client` 配置与调用
- 复杂观测聚合

一句话：

`ManagedSessionService` 是 session 的平台门面，不是新的 session runtime。

## Tool 执行设计

### 平台内置执行模型

| 能力 | 落点 |
|---|---|
| `read` / `write` / `edit` / `ls` / `find` / `grep` | Firecracker 内 `cwd` 上的 `pi` built-in tools |
| `bash` | Firecracker sandbox |
| `mcp-client` | `McpClientManager` |
| skills | `ResourceLoader` |
| 受控 extensions | `ExtensionRunner` |

### 执行原则

- agent 不直接感知底层资源位置
- `pi` built-in tools 在 Firecracker 内的 `cwd` 上直接执行
- 平台在 Firecracker 执行层补充策略、审计、超时、额度、输出控制

## `extensions` 的职责边界

`extensions` 在 MVP 中只负责 agent-facing 扩展，不承担 control plane 职责。

适合放在 `extensions` 中的内容：

- `mcp-client` 能力投影
- prompt 注入
- skills / resources 的补充发现

不适合放在 `extensions` 中的内容：

- session durable state
- Firecracker 生命周期管理
- rclone 挂载管理
- session 执行调度
- 审计落库

## Firecracker 设计

### 作用

- 承载 `bash` 和需要真实文件系统视图的执行
- 提供 `cwd` 根目录隔离
- 隔离网络、进程、磁盘使用

### 最小要求

- 每个 session 绑定一个 Firecracker 内 `cwd`
- sandbox 启动时挂载 `cwd` 所需数据
- sandbox 空闲数秒后自动关闭
- 需要有 stdout/stderr 限制、命令超时、磁盘配额、进程数限制

## 存储分层

### transcript 与文件层

| 层 | 载体 | 作用 |
|---|---|---|
| transcript 主写层 | 高速本地磁盘 | append-only JSONL，作为主写路径 |
| transcript 远端副本层 | 对象存储 | 异步同步、归档、跨节点恢复 |
| rclone 挂载层 | `/mnt/*` | uploads、outputs、tool_results，以及可选的共享资源目录 |
| 执行热层 | Firecracker 所在高速盘 | `cwd` 物化、临时脚本、临时缓存、活跃索引 |

约束：

- transcript 主写层不能是“容器重启即丢失”的临时盘
- Firecracker 内的热执行文件不是唯一真相
- 需要跨执行保留的内容，必须写回 transcript 主写层或 `/mnt/*` 持久层

### 共享目录

| 路径 | 用途 |
|---|---|
| `/mnt/transcripts` | transcript 的远端挂载或同步目标 |
| `/mnt/user-data/uploads` | 用户上传文件 |
| `/mnt/user-data/outputs` | 导出文件、下载文件 |
| `/mnt/user-data/tool_results` | 工具执行结果与大体积产物 |
| `/mnt/skills` | 已安装 skills |
| `/mnt/extensions` | 已安装 extensions |

### `mcp-client` 元数据

`mcp-client` 不通过目录发现，而是放在 metadata store 中。

最小 metadata 内容：

- `clientId`
- `serverUrl` 或连接描述
- 认证引用
- capability snapshot
- roots / 路径策略
- 超时、预算、启用状态

## 当前接口冻结补充

当前 `managed-agent-api` 已冻结的 V1 语义包括：

- `PATCH /sessions/{sessionId}` 仅允许修改 `sessionName`
- `DELETE /sessions/{sessionId}` 为不可恢复 soft-delete / archive
- `running` session 允许改名，但不允许删除
- `GET /users/{userId}/sessions` 使用 `limit + cursor`，响应返回 `items + nextCursor + hasMore`
- `POST /sessions/{sessionId}/messages` 在 `status=running` 时由前端阻止重复提交；后端暂不做硬性拒绝
- `tool_call` transcript 投影支持 `arguments`、`result`、`error`
- SSE 生命周期区分 `final.output.completed`、`run.cancelled`、`run.failed`

### 热执行层

高速本地磁盘用于：

- 活跃 `cwd` 物化
- overlay
- patch apply
- 临时执行文件

### 元数据层

数据库保存：

- session metadata
- 状态与索引
- 审计引用

## `mcp-client` 设计

`mcp-client` 是平台接入外部能力的统一方式。

这里不单独发明一个新的协议层。更准确地说，平台内部实现 MCP 规范里的 client 角色，由对应 extension 或 skill 在需要时调用 `McpClientManager`。

最小对象模型：

- `McpClientDefinition`
- `McpClientRegistration`
- `McpClientCapabilitySnapshot`

最小平台职责：

- 注册配置校验
- 认证与网络策略
- tools/resources/prompts capability 管理
- 对 agent 暴露为工具能力
- 审计调用

## 与主架构文档的关系

本文不重复定义：

- MVP 产品边界
- 需求确认表
- API 细节

这些内容分别见：

- [minimal-architecture.zh-CN.md](./minimal-architecture.zh-CN.md)
- [../interfaces/api-interface-draft.zh-CN.md](../interfaces/api-interface-draft.zh-CN.md)
- [../interfaces/workspace-service-backend-project-storage-design.zh-CN.md](../interfaces/workspace-service-backend-project-storage-design.zh-CN.md)

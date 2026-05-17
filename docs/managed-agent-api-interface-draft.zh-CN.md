# Managed Agent API 接口草案

## 概述

本文定义当前 MVP 的最小服务端接口集合。

范围只覆盖：

- session 创建与查询
- 用户消息提交
- 定时与事件触发型 session 执行
- 取消当前 prompt 执行
- 流式输出

本文不包含：

- `retry`
- `abort`
- `fork`
- 多租户接口

## 设计原则

| 主题 | 结论 |
|---|---|
| durable identity | `sessionId` |
| `cwd` | 由平台内部决定，不由外部调用方传入 |
| 继续方式 | 在同一 `sessionId` 上继续提交 prompt |
| 输出流 | 提交输入接口直接返回流式响应，事件编码兼容 SSE |
| runtime | 运行时可重建，不对外暴露 |
| 沙箱 | Firecracker，对外不直接暴露其生命周期 |
| 外部事件 | 当前已知为 MCP `notification`；属于内部触发链路，不作为对外 API 暴露；webhook 仍未定 |

## 核心对象

### Session

表示一条 managed agent 会话。

最小字段：

- `sessionId`
- `sessionName`
- `model`
- `thinkingLevel`
- `createdAt`
- `updatedAt`

### Trigger

表示 session 的触发来源。

最小类型：

- `manual`
- `scheduled_once`
- `scheduled_cron`
- `external_event`

### Input

表示一次用户输入或预置输入。

最小形态：

```json
{
  "content": [
    { "type": "text", "text": "分析当前项目结构" },
    { "type": "image", "url": "https://example.com/a.png" },
    { "type": "video", "url": "https://example.com/b.mp4" }
  ]
}
```

## HTTP API

### 0. 最近会话列表

`GET /users/{userId}/sessions`

用途：

- 只返回该用户最近活跃的 session
- 按 `lastActiveAt desc, sessionId desc` 稳定排序
- 列表页只展示 `sessionName`
- 支持基于 `limit` 和 `cursor` 的游标分页
- 已归档 session 不再返回

响应：

```json
{
  "nextCursor": "opaque-cursor",
  "hasMore": true,
  "items": [
    {
      "sessionId": "sess_123",
      "sessionName": "Refactor auth module",
      "lastActiveAt": "2026-05-15T10:00:00Z"
    }
  ]
}
```

说明：

- `cursor` 是不透明字符串，前端不需要理解其编码格式
- 当前响应固定返回 `items`、`nextCursor`、`hasMore`

### 1. 创建 session

`POST /sessions`

返回 `text/event-stream`

请求体：

```json
{
  "model": "anthropic/claude-opus-4.1",
  "thinkingLevel": "high",
  "input": {
    "content": [
      { "type": "text", "text": "分析当前项目结构" }
    ]
  }
}
```

响应：

```text
event: session.created
data: {"sessionId":"sess_123","sessionName":"分析当前项目结构"}

event: message.accepted
data: {"sessionId":"sess_123","entry":{"id":"a1b2c3d4","parentId":null,"messageType":"user","content":[{"type":"text","text":"分析当前项目结构"}]}}

event: process.delta
data: {"sessionId":"sess_123","entryId":"b2c3d4e5","parentId":"a1b2c3d4","text":"先检查项目结构"}

event: final.output.delta
data: {"sessionId":"sess_123","entryId":"c3d4e5f6","parentId":"b2c3d4e5","text":"项目主要包含 packages、docs 和 scripts。"}

event: final.output.completed
data: {"sessionId":"sess_123","entryId":"c3d4e5f6"}
```

说明：

- `cwd` 由平台内部决定并写入 session，但不作为前端关注字段返回
- `model` 和 `thinkingLevel` 允许用户选择；不传时使用平台默认值
- 创建 session 时必须传入首次 prompt
- 本接口直接返回该次执行的过程输出和最终回复

### 2. 查询 session

`GET /sessions/{sessionId}`

响应：

```json
{
  "sessionId": "sess_123",
  "sessionName": "分析当前项目结构",
  "status": "idle",
  "model": "anthropic/claude-opus-4.1",
  "thinkingLevel": "high",
  "createdAt": "2026-05-15T10:00:00Z",
  "lastActiveAt": "2026-05-15T10:05:00Z",
  "entries": [
    {
      "id": "a1b2c3d4",
      "parentId": null,
      "createdAt": "2026-05-15T10:00:00Z",
      "messageType": "user",
      "content": [
        { "type": "text", "text": "分析当前项目结构" }
      ]
    },
    {
      "id": "b2c3d4e5",
      "parentId": "a1b2c3d4",
      "createdAt": "2026-05-15T10:00:01Z",
      "messageType": "process",
      "content": [
        { "type": "text", "text": "先检查项目结构" },
        {
          "type": "tool_call",
          "toolCallId": "tool_001",
          "toolName": "read",
          "status": "completed",
          "arguments": "{\"path\":\".\"}",
          "result": "{\"files\":[\"README.md\"]}"
        }
      ]
    },
    {
      "id": "c3d4e5f6",
      "parentId": "b2c3d4e5",
      "createdAt": "2026-05-15T10:00:03Z",
      "messageType": "assistant",
      "content": [
        { "type": "text", "text": "项目主要包含 packages、docs 和 scripts。" }
      ]
    }
  ]
}
```

说明：

- 除 session 基本信息外，还返回该 session 当前 transcript 的 entries
- entry 使用 `id` / `parentId` 建模，和 `pi` session transcript 的树形结构保持一致
- 不额外发明单独的轮次 ID
- 前端如果需要“按轮展示”，应基于 entry 链路自行组装：
  - 用户输入 entry
  - 其后的过程消息 entry
  - 其后的最终回复 entry
- `messageType` 是对前端友好的投影字段，用于区分：
  - `user`
  - `process`
  - `assistant`
- session 级的 `parentSession` 只用于 session fork/clone 关系，不等于 transcript entry 的 `parentId`
- `status` 是当前 durable 会话状态投影，取值为 `idle | running | error`
- 已归档 session 查询返回 `404`

### 2.1 修改 session 标题

`PATCH /sessions/{sessionId}`

请求体：

```json
{
  "sessionName": "Refactor auth module"
}
```

说明：

- 当前只支持修改 `sessionName`
- `running` session 允许改名
- 空字符串应返回 `400`

### 2.2 归档 session

`DELETE /sessions/{sessionId}`

说明：

- 当前语义是不可恢复的 soft-delete / archive
- 删除后 recent sessions 与 transcript 都不再可见
- `running` session 不允许删除，应返回 `409 Conflict`

### 3. 提交用户消息

`POST /sessions/{sessionId}/messages`

返回 `text/event-stream`

请求体：

```json
{
  "input": {
    "content": [
      { "type": "text", "text": "继续分析 test 目录" }
    ]
  }
}
```

响应：

```text
event: message.accepted
data: {"sessionId":"sess_123","sessionName":"分析当前项目结构","entry":{"id":"d4e5f6g7","parentId":"c3d4e5f6","messageType":"user","content":[{"type":"text","text":"继续分析 test 目录"}]}}

event: process.delta
data: {"sessionId":"sess_123","entryId":"e5f6g7h8","parentId":"d4e5f6g7","text":"继续检查 test 目录"}

event: action.started
data: {"sessionId":"sess_123","entryId":"e5f6g7h8","parentId":"d4e5f6g7","name":"read"}

event: final.output.delta
data: {"sessionId":"sess_123","entryId":"f6g7h8i9","parentId":"e5f6g7h8","text":"test 目录下主要是回归测试和 harness。"}

event: final.output.completed
data: {"sessionId":"sess_123","entryId":"f6g7h8i9"}
```

说明：

- 服务端只保证消息被接收并关联到该 `sessionId`
- 这些输入会直接成为 `pi` session 内的后续 prompt 历史
- 本接口直接返回本次 prompt 的过程输出和最终回复，不再要求前端再发起第二个订阅请求
- 当前阶段当 session 为 `running` 时，由前端阻止重复提交；后端暂不硬性拒绝并发提交

### 4. 创建定时任务

`POST /triggers`

请求体：

```json
{
  "triggerType": "scheduled_once",
  "runAt": "2026-05-15T10:00:00Z",
  "model": "anthropic/claude-opus-4.1",
  "thinkingLevel": "high",
  "preparedInput": {
    "content": [
      { "type": "text", "text": "检查项目中的过期依赖并生成摘要" }
    ]
  }
}
```

响应：

```json
{ "triggerId": "trg_001", "accepted": true }
```

说明：

- trigger 到期时会创建一个新的 session
- `preparedInput` 会成为该 session 的首次 prompt
- 若配置了 project / `cwd` / skills / `mcp-client` / instructions，则在 session 创建后一起加载

### 5. 取消当前 prompt 执行

`POST /sessions/{sessionId}/cancel`

响应：

```json
{ "sessionId": "sess_123", "accepted": true }
```

说明：

- 服务端只取消当前正在执行的 prompt
- 尝试停止模型流和工具执行
- session 本身不进入新的持久状态
- 后续若用户继续提交 prompt，会在同一个 session 内继续追加新的 entries

## 流式输出协议

### 6. 提交输入后的流式响应

以下接口都直接返回 `text/event-stream`：

- `POST /sessions`
- `POST /sessions/{sessionId}/messages`

查询参数：

| 参数 | 说明 | 默认值 |
|---|---|---|
| `includeProcess` | 是否返回过程事件，包括推理、动作调用与过程性输出 | `true` |
| `includeFinal` | 是否返回最终输出事件，即 agent 的最终回复 | `true` |

事件分为两类：

| 类别 | 含义 |
|---|---|
| 过程事件 | 推理过程、动作调用、过程性文本输出 |
| 最终输出事件 | agent 的最终回复 |

建议事件类型：

| 事件 | 用途 |
|---|---|
| `process.delta` | 过程性文本增量，包括推理说明与中间输出 |
| `action.started` | 动作开始 |
| `action.completed` | 动作完成 |
| `action.failed` | 动作失败 |
| `final.output.delta` | 最终回复增量 |
| `final.output.completed` | 最终回复完成 |
| `run.cancelled` | 用户取消当前执行 |
| `run.failed` | worker 或 runtime 级失败 |

示例：

```text
event: process.delta
data: {"sessionId":"sess_123","entryId":"b2c3d4e5","parentId":"a1b2c3d4","text":"先检查项目结构"}

event: action.started
data: {"sessionId":"sess_123","entryId":"b2c3d4e5","parentId":"a1b2c3d4","toolCallId":"tool_001","name":"read","arguments":"{\"path\":\".\"}"}

event: final.output.delta
data: {"sessionId":"sess_123","entryId":"c3d4e5f6","parentId":"b2c3d4e5","text":"正在读取文件..."}
```

说明：

- 当前前端默认展示过程事件
- 如果请求方只关心最终回复，可传 `includeProcess=false&includeFinal=true`
- 如果请求方只关心过程观测，可传 `includeProcess=true&includeFinal=false`
- assistant / tool 的原始区分不直接暴露给前端接口，而是在服务端先组装成高层 UI 事件
- 页面是否处于“运行中”由事件流是否结束决定，而不是由 `session` 持久状态决定
- 前端不需要为同一次输入额外发起第二个事件订阅请求
- 除 `session.created` 外，和消息内容相关的事件都应携带 `entryId`；若已确定父节点，则同时携带 `parentId`
- `message.accepted` 直接返回已写入 transcript 的用户 entry，便于前端和查询接口返回的 `entries` 对齐
- `run.cancelled` 与 `final.output.completed` 互斥；取消后流关闭，不再发送最终完成事件
- `tool_call` 在详情接口中的最小富集字段为：`toolCallId`、`toolName`、`status`、`arguments?`、`result?`、`error?`

## 运行态语义

页面上的“运行中 / 已完成 / 失败 / 中断”等状态，不由 `session` 持久字段表达，而由当前事件流驱动：

- 持续收到过程事件或最终输出事件时，前端视为运行中
- 最终输出结束、工具流程结束或流被关闭后，前端视为本次执行结束
- 失败信息通过错误输出或中断结果传达，不额外依赖独立的 session 失败事件
- 取消信息通过 `run.cancelled` 事件显式传达
- `cancel` 只表示停止当前 prompt 执行，不要求把 session 持久化成固定状态

## 最小数据存储形状

### `pi` session

会话真相直接来自 `pi` session 持久化，不再单独设计平台 `sessions` 主表。

### user_sessions

- `user_id`
- `session_id`
- `session_name`
- `created_at`
- `last_active_at`
- `archived_at`

### session_executions

如后续需要补充执行级日志，可增加轻量执行记录，而不是一等 `run` 主表。

### session_entries

保存：

- transcript
- 工具结果摘要
- 关键状态切换记录

### agent_events

保存：

- SSE 投影前的原始事件
- 用于恢复、回放与审计引用

## 与其他文档的边界

本文只定义 MVP 的外部接口。

外部事件触发链路（当前已知为 MCP `notification`）由内部控制平面处理，不单独作为用户侧 HTTP API 暴露。

更高层约束见：

- [managed-agent-minimal-architecture.zh-CN.md](./managed-agent-minimal-architecture.zh-CN.md)

运行时实现见：

- [managed-agent-technical-design.zh-CN.md](./managed-agent-technical-design.zh-CN.md)

# Workspace Service Backend 存储设计

## 概述

本文只讨论 managed agent 的文件访问、存储分层和执行挂载设计。

这份文档不再把 `project` 作为当前 MVP 的一等业务对象，而是直接围绕：

- `cwd`
- `session`
- `run`

来定义文件与执行平面。

## 已确认的平台前提

| 主题 | 结论 |
|---|---|
| 执行沙箱 | Firecracker MicroVM |
| 持久文件层 | rclone 挂载远程存储 |
| 热工作层 | 高速本地磁盘 |
| 运行时 | 通过 `pi` SDK 装配 |
| 文件工具 | 直接使用 `pi` built-in tools，在 Firecracker 内的 `cwd` 上执行 |
| transcript 主写 | 高速本地磁盘上的 append-only JSONL |
| transcript 远端同步 | 异步同步对象存储 |

当前持久挂载路径：

- `/mnt/transcripts`
- `/mnt/user-data/uploads`
- `/mnt/user-data/outputs`
- `/mnt/user-data/tool_results`
- `/mnt/skills`
- `/mnt/extensions`

## 核心模型

| 对象 | 当前定位 | 主要内容 |
|---|---|---|
| `cwd` | 当前唯一工作目录概念 | session 绑定的工作目录、Firecracker 内的工作根目录、`pi` tools 的文件边界 |
| `session` | durable identity | transcript、`cwd`、当前状态 |
| `run` | 一次执行尝试 | run 状态、关联的 `sessionId`、执行期间的工具与事件记录 |

## 文件访问与命令执行分离

不要把文件访问与命令执行做成同一层。

推荐拆分：

| 层 | 职责 |
|---|---|
| `pi` built-in tools | `read`、`write`、`edit`、`find`、`grep`、`ls` |
| Firecracker 执行服务 | `bash`、测试、构建、脚本执行 |

这样可以保持：

- 文件访问可审计
- 命令执行可隔离
- 存储层与执行层独立演进

## 存储分层

| 层 | 载体 | 主要用途 |
|---|---|---|
| 第一层：transcript 主写层 | 高速本地磁盘 | append-only JSONL 主写路径 |
| 第二层：durable 挂载层 | rclone 挂载远程存储 | 用户上传文件、用户下载文件、tool result、skills、extensions、transcript 远端副本 |
| 第三层：元数据层 | 数据库 | session/run 引用、`cwd` 元数据、文件索引、版本信息、审计引用、`mcp-client` 配置 |
| 第四层：热执行层 | 高速本地磁盘 | `cwd` 物化、overlay、patch apply、活跃文件缓存、Firecracker 挂载准备 |

durable 挂载层的标准路径：

| 路径 | 用途 |
|---|---|
| `/mnt/transcripts` | transcript 远端副本或远端挂载目标 |
| `/mnt/user-data/uploads` | 用户上传文件 |
| `/mnt/user-data/outputs` | 导出文件、下载文件 |
| `/mnt/user-data/tool_results` | 工具结果与大体积产物 |
| `/mnt/skills` | 已安装 skills |
| `/mnt/extensions` | 已安装 extensions |

补充约束：

- transcript 主写层不能是“容器重启即丢失”的临时盘
- Firecracker 内热执行层不是唯一真相
- 需要跨执行保留的内容，必须写回 transcript 主写层或 durable 挂载层

## `cwd` 物化策略

| 步骤 | 策略 |
|---|---|
| 1 | transcript 先 append 到高速本地磁盘 |
| 2 | 需要执行时再把 `cwd` 物化到高速本地磁盘 |
| 3 | 在物化结果之上提供可写 overlay |
| 4 | 将 `cwd` 挂载到 Firecracker sandbox |
| 5 | transcript 异步同步到对象存储 |
| 6 | 需要持久保留的文件写回 `/mnt/*` 挂载层 |

## Firecracker 挂载语义

| 主题 | 说明 |
|---|---|
| 根目录 | 每个 session 绑定一个 Firecracker 内 `cwd` |
| agent 视角 | 该目录是 agent 可见的主要文件边界 |
| 工具共享 | `bash` 与文件工具共享该工作根 |
| 隔离要求 | 不应跨 session 共享可写视图 |
| 挂载来源 | Firecracker 启动时拿到物化后的 `cwd` |
| 持久路径 | 同时拿到 transcript / outputs / tool_results 对应的持久路径 |
| 挂载策略 | 需要支持必要的只读或只写挂载策略 |

## 一致性与版本控制

文件操作能力建议如下：

| 能力 | 作用 |
|---|---|
| 读时返回版本或 `etag` | 给后续写入提供一致性基线 |
| 写入时带 base version | 防止盲写覆盖 |
| 版本冲突时拒绝写入 | 显式暴露冲突而不是静默覆盖 |

这样可以降低：

- session 恢复后覆盖旧内容
- 多次执行间文件状态错乱
- patch 写回覆盖其他更新

## 搜索与索引

`find` / `grep` 不要求一开始就走复杂索引。

建议：

| 场景 | 做法 |
|---|---|
| 小 `cwd` | 先直接扫描 |
| 中等 `cwd` | 增加文本索引 |
| agent 侧接口 | 始终暴露稳定工具接口 |

## 最小数据模型

| 表/集合 | 最小字段 |
|---|---|
| `sessions` | `session_id`、`cwd`、`status`、`last_access_at` |
| `cwd_files` | `session_id`、`path`、`blob_id`、`etag`、`size` |
| `cwd_snapshots` | `snapshot_id`、`session_id`、`parent_snapshot_id`、`created_at` |
| `mcp_clients` | `client_id`、`session_id`、`config_ref`、`capability_snapshot` |

## 风险

- 把 transcript 主写层和易失临时盘混成一层，导致容器重启后丢上下文
- 把持久层和热层混成一层，导致成本高或性能差
- 把文件执行语义和沙箱生命周期耦合得过紧
- Firecracker 物化与回收不及时，造成热盘占满
- 缺少版本语义导致恢复后写冲突

## 与其他文档的关系

本文只回答：

- `cwd` 文件如何存
- `cwd` 如何物化
- Firecracker 如何挂载

整体架构见：

- [managed-agent-minimal-architecture.zh-CN.md](./managed-agent-minimal-architecture.zh-CN.md)

运行时协作见：

- [managed-agent-technical-design.zh-CN.md](./managed-agent-technical-design.zh-CN.md)

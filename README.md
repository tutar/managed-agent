# managed-agent

基于 `pi` SDK 和 `extensions` 的 managed agent 平台骨架。

当前仓库已经完成主框架和本地可运行入口。目录划分直接对应现有设计文档中的 3 个部署单元和基础设施分层。

## 目录

- `apps/managed-agent-api`: 合并后的 API/Channel Layer + Control Plane Layer
- `apps/harness-worker`: 运行 `pi` runtime、Firecracker、tools、skills、extensions 的执行单元
- `apps/web-ui`: 独立 Web 客户端，按真实用户视角消费当前 HTTP/SSE API
- `infra/`: Nginx/Ingress、Kubernetes、Firecracker、rclone、存储分层说明
- `docs/`: 产品提案、架构、接口和存储设计文档

## 设计映射

项目骨架和设计文档的映射见 [docs/project-scaffold.zh-CN.md](./docs/project-scaffold.zh-CN.md)。

## 本地运行

启动：

```bash
export DEEPSEEK_API_KEY=your-deepseek-api-key
export MANAGED_AGENT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/managed_agent
export MANAGED_AGENT_MOUNT_ROOT="$(pwd)/.managed-agent/mnt"
npm run dev:all:pi
```

固定本地端口约定：

- `managed-agent-api`: `4173`
- `harness-worker`: `4000`
- `web-ui`: `3000`

固定本地数据根约定：

- 统一使用仓库根 `.managed-agent/mnt`
- 不再使用 `apps/managed-agent-api/.managed-agent`
- 不再使用 `apps/harness-worker/.managed-agent`

分开启动也可以：

```bash
export MANAGED_AGENT_RUNTIME=pi
export MANAGED_AGENT_DEFAULT_MODEL=deepseek/deepseek-v4-pro
export MANAGED_AGENT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/managed_agent
export MANAGED_AGENT_MOUNT_ROOT="$(pwd)/.managed-agent/mnt"
npm run start --workspace @managed-agent/harness-worker
npm run start --workspace @managed-agent/managed-agent-api
npm run start:web-ui
```

本地 PostgreSQL 可直接起：

```bash
npm run db:up
```

如需清空 transcript、历史 session metadata 和本地 PostgreSQL 中的 session 数据：

```bash
npm run reset:local-state
```

当前默认本地数据库参数：

- host: `127.0.0.1`
- port: `5432`
- db: `managed_agent`
- user: `postgres`
- password: `postgres`

当前 mount root 约定：

- `MANAGED_AGENT_MOUNT_ROOT` 对应生产环境里的 `/mnt`
- transcript: `${MANAGED_AGENT_MOUNT_ROOT}/transcripts`
- uploads: `${MANAGED_AGENT_MOUNT_ROOT}/user-data/uploads`
- outputs: `${MANAGED_AGENT_MOUNT_ROOT}/user-data/outputs`
- tool results: `${MANAGED_AGENT_MOUNT_ROOT}/user-data/tool_results`
- skills: `${MANAGED_AGENT_MOUNT_ROOT}/skills`
- extensions: `${MANAGED_AGENT_MOUNT_ROOT}/extensions`

示例请求：

```bash
curl -N -X POST 'http://127.0.0.1:4173/sessions?userId=demo-user' \
  -H 'Content-Type: application/json' \
  --data '{"model":"deepseek/deepseek-v4-pro","thinkingLevel":"medium","input":{"content":[{"type":"text","text":"分析当前项目结构"}]}}'
```

当前框架当前覆盖：

- 跑通 `Managed Agent API -> Harness Worker` 的最小调用链
- 跑通 `Web UI -> Managed Agent API -> Harness Worker` 的最小浏览器链路
- 返回符合文档语义的 SSE 事件流
- 保留最小 session transcript，支持 recent sessions 分页、session detail、会话续写、改名和归档
- 支持把 session metadata / recent-session projection / audit 写入 PostgreSQL
- 支持通过 `piSessionFile` 直接读取 pi-managed transcript JSONL
- `managed-agent-api` 运行主路径只保留 PostgreSQL durable metadata store

当前还不包含：

- 完整 `pi` runtime 生命周期管理
- Firecracker
- 远端对象存储同步器和 `/mnt/*` durable 挂载自动化
- 多租户、触发调度、真实审计落库

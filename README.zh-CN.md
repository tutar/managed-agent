# managed-agent

基于 `pi` 构建的 managed agent 平台，重点不是本地单次执行，而是把会话、转录、控制平面、执行平面和持久化边界托管起来。

[English README](./README.md)

## 为什么亮点是 Managed

这个项目当前最重要的特征是 `managed`，而不是“又一个 agent demo”：

- durable session / transcript：会话 metadata、recent-session projection、audit 和 transcript 都有明确 durable truth
- separated control plane：`managed-agent-api` 与 `harness-worker` 分层，后续可以继续扩展为更强的调度和恢复模型
- shared mount contract：运行时统一围绕 `/mnt/*` 语义组织 transcript、uploads、outputs、tool results、skills、extensions
- hosted runtime direction：后续扩展方向是 sandbox、storage、audit、identity、multi-tenant，而不是把能力塞回本地 agent loop

## 架构概览

- `apps/web-ui`: 独立 Web 客户端，按真实用户视角消费 HTTP/SSE API
- `apps/managed-agent-api`: `Managed Agent API`，承载 API/channel layer 和 control-plane layer
- `apps/harness-worker`: `Harness Worker`，运行 `pi` runtime、tools、skills、extensions 和后续 sandbox 执行面
- `infra/`: ingress、Kubernetes、Firecracker、rclone、存储约定和本地开发基础设施
- `docs/`: proposal、架构、接口、存储设计和当前实现状态

仓库结构和贡献约定见 [CONTRIBUTING.md](./CONTRIBUTING.md)。完整文档导航见 [docs/README.md](./docs/README.md)。

## 快速开始

本地依赖：

- PostgreSQL: `docker compose` 本地启动
- mount root: 仓库根 `.managed-agent/mnt`
- 真实 LLM: 可选，当前默认联调基线是 `DeepSeek via pi`

启动本地 PostgreSQL：

```bash
npm run db:up
```

一键启动三进程：

```bash
export DEEPSEEK_API_KEY=your-deepseek-api-key
export MANAGED_AGENT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/managed_agent
export MANAGED_AGENT_MOUNT_ROOT="$(pwd)/.managed-agent/mnt"
npm run dev:all:pi
```

固定本地端口：

- `web-ui`: `3000`
- `harness-worker`: `4000`
- `managed-agent-api`: `4173`

固定本地数据根：

- 统一使用仓库根 `.managed-agent/mnt`
- 不再使用 `apps/managed-agent-api/.managed-agent`
- 不再使用 `apps/harness-worker/.managed-agent`

默认本地数据库参数：

- host: `127.0.0.1`
- port: `5432`
- db: `managed_agent`
- user: `postgres`
- password: `postgres`

如需清空 transcript、本地 metadata 和 PostgreSQL 中的 session 相关数据：

```bash
npm run reset:local-state
```

示例请求：

```bash
curl -N -X POST 'http://127.0.0.1:4173/sessions?userId=demo-user' \
  -H 'Content-Type: application/json' \
  --data '{"model":"deepseek/deepseek-v4-pro","thinkingLevel":"medium","input":{"content":[{"type":"text","text":"分析当前项目结构"}]}}'
```

## 当前范围

当前已经覆盖：

- `web-ui -> managed-agent-api -> harness-worker` 最小浏览器链路
- `managed-agent-api -> harness-worker` 独立服务调用链
- PostgreSQL durable metadata / projection / audit
- `piSessionFile` 和 managed transcript JSONL 读取链路
- rename、archive、分页和明确的 SSE 生命周期

当前还没覆盖：

- Firecracker 和真实 `cwd` 生命周期
- 远端对象存储同步器和 `/mnt/*` 挂载自动化
- 完整 trigger 调度和外部事件恢复
- 注册登录、多租户、预算与策略控制

## 继续阅读

- 文档总入口：[docs/README.md](./docs/README.md)
- 当前实现状态：[docs/status/implementation-status.md](./docs/status/implementation-status.md)
- 最小架构说明：[docs/design/minimal-architecture.zh-CN.md](./docs/design/minimal-architecture.zh-CN.md)
- 技术设计：[docs/design/technical-design.zh-CN.md](./docs/design/technical-design.zh-CN.md)
- API 草案：[docs/interfaces/api-interface-draft.zh-CN.md](./docs/interfaces/api-interface-draft.zh-CN.md)

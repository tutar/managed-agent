# managed-agent

基于 `pi` 构建的 managed agent 平台，重点不是本地单次执行，而是把会话、转录、控制平面、执行平面和持久化边界托管起来。

[English README](./README.md)

## 为什么亮点是 Managed

这个项目当前最重要的特征是 `managed`，而不是"又一个 agent demo"：

- durable session / transcript：会话 metadata、recent-session projection、audit 和 transcript 都有明确 durable truth
- separated control plane：`managed-agent-api` 负责调度，`apps/harness` 提供 agent 运行时
- shared mount contract：运行时统一围绕 `/mnt/*` 语义组织 transcript、uploads、outputs、tool results、skills、extensions
- hosted runtime direction：后续扩展方向是 sandbox、storage、audit、identity、multi-tenant

## 架构概览

- `apps/web-ui`: 独立 Web 客户端，按真实用户视角消费 HTTP/SSE API
- `apps/managed-agent-api`: `Managed Agent API`，承载 API/channel layer、control-plane layer 和 `harness-worker/` 调度模块
- `apps/harness`: 纯 agent 运行时包（pi executor、容器入口、CLI），可 in-process 调用、K8s Pod 内运行、或独立 CLI 部署
- `infra/`: ingress、Kubernetes、Firecracker、rclone、存储约定和本地开发基础设施
- `docs/`: proposal、架构、接口、存储设计和当前实现状态

仓库结构和贡献约定见 [CONTRIBUTING.md](./CONTRIBUTING.md)。完整文档导航见 [docs/README.md](./docs/README.md)。

## 快速开始

### 前置条件

- PostgreSQL: `docker compose` 本地启动
- mount root: 仓库根 `.managed-agent/mnt`
- Node.js >= 20.18

### pi 模式（进程内，无需 K8s）

```bash
npm run db:up
export DEEPSEEK_API_KEY=your-deepseek-api-key
export MANAGED_AGENT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/managed_agent
export MANAGED_AGENT_MOUNT_ROOT="$(pwd)/.managed-agent/mnt"
npm run dev:all:pi
```

### sandbox 模式（K8s Pod 隔离）

需要 Docker 和本地 K8s 集群。一次性环境准备：

```bash
# 构建 harness 镜像、创建 kind 集群、加载镜像
./scripts/sandbox-setup.sh
```

然后启动：

```bash
npm run db:up
export DEEPSEEK_API_KEY=your-deepseek-api-key
export MANAGED_AGENT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/managed_agent
export MANAGED_AGENT_MOUNT_ROOT="$(pwd)/.managed-agent/mnt"
npm run dev:all:sandbox
```

### mock 模式（无外部依赖）

```bash
npm run db:up
export MANAGED_AGENT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/managed_agent
export MANAGED_AGENT_MOUNT_ROOT="$(pwd)/.managed-agent/mnt"
npm run dev:all
```

## 端口

- `web-ui`: `3000`
- `managed-agent-api`: `4173`

## 默认本地数据库参数

- host: `127.0.0.1`
- port: `5432`
- db: `managed_agent`
- user: `postgres`
- password: `postgres`

如需清空 transcript、本地 metadata 和 PostgreSQL 中的 session 相关数据：

```bash
npm run reset:local-state
```

## 当前范围

当前已经覆盖：

- `web-ui -> managed-agent-api` 最小浏览器链路（不再需要独立 worker 服务）
- `mock / pi / sandbox` 三种 runtime，通过 `MANAGED_AGENT_RUNTIME` 切换
- `apps/harness` 独立 agent 运行时包
- Sandbox Pod 调度：K8s API Pod 生命周期、日志轮询、事件流回传
- Sandbox Pod 内 pi agent 运行，调真实 DeepSeek
- PostgreSQL durable metadata / projection / audit
- transcript 持久化：sandbox JSONL 磁盘缓存 + 刷新恢复
- rename、archive、分页和明确的 SSE 生命周期
- 用户注册、登录、登出、会话认证

当前还没覆盖：

- Kata / Firecracker 和真实 `cwd` 生命周期（本地 kind 验证用容器代替 VM）
- 远端对象存储同步器和 `/mnt/*` 挂载自动化
- 完整 trigger 调度和外部事件恢复
- 多租户、预算与策略控制
- NetworkPolicy + HTTP Proxy sandbox 安全策略

## 继续阅读

- 文档总入口：[docs/README.md](./docs/README.md)
- 当前实现状态：[docs/status/implementation-status.md](./docs/status/implementation-status.md)
- 最小架构说明：[docs/design/minimal-architecture.zh-CN.md](./docs/design/minimal-architecture.zh-CN.md)
- 技术设计：[docs/design/technical-design.zh-CN.md](./docs/design/technical-design.zh-CN.md)
- API 草案：[docs/interfaces/api-interface-draft.zh-CN.md](./docs/interfaces/api-interface-draft.zh-CN.md)

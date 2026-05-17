# Managed Agent 项目骨架说明

## 目的

本文说明当前仓库骨架如何映射到现有设计文档。当前阶段只搭部署单元和基础设施结构，不提前抽共享包。

## 部署单元映射

| 目录 | 对应设计对象 | 主要文档 |
|---|---|---|
| `apps/web-ui` | `Web Client` | `01-managed-agent-feature-proposal.zh-CN.md`、`managed-agent-minimal-architecture.zh-CN.md`、`managed-agent-api-interface-draft.zh-CN.md` |
| `apps/managed-agent-api` | `Managed Agent API` | `managed-agent-minimal-architecture.zh-CN.md`、`managed-agent-technical-design.zh-CN.md`、`managed-agent-api-interface-draft.zh-CN.md` |
| `apps/harness-worker` | `Harness Worker` | `managed-agent-technical-design.zh-CN.md`、`workspace-service-backend-project-storage-design.zh-CN.md` |

## `Managed Agent API` 内部分层

`Managed Agent API` 在部署上是一个服务，但逻辑上拆成两层：

- `src/api-channel`: Web API、channel adapter、identity、authorization、stream response proxy
- `src/control-plane`: `ManagedSessionService`、`TriggerService`、`ActiveSessionRegistry`、`EventPublisher`、`AuditService`

## 代码边界处理

当前不单独创建 `packages/`。

原因：

- 设计文档只明确了部署单元和逻辑对象边界，没有要求这些边界先拆成独立 npm package
- 现阶段还没有共享实现代码，提前抽包只会增加目录噪音
- 后续若 `Managed Agent API` 与 `Harness Worker` 之间出现稳定共享契约，再单独抽出共享包更合适

当前约定：

- Web 聊天客户端边界先放在 `apps/web-ui`
- API、channel、control plane 相关边界先放在 `apps/managed-agent-api/src`
- runtime、sandbox、`mcp-client`、tool 执行相关边界先放在 `apps/harness-worker/src`
- 基础设施与部署相关边界放在 `infra/`

## 基础设施目录

| 目录 | 作用 |
|---|---|
| `infra/ingress` | `Nginx / Ingress` 配置、模板和入口层说明 |
| `infra/k8s` | Kubernetes 部署清单占位 |
| `infra/firecracker` | Firecracker 运行面说明和占位 |
| `infra/storage` | transcript、本地热盘、远端持久层分层说明 |
| `infra/rclone` | rclone 挂载约定和占位 |

## 当前约束

- 根目录只定义 npm workspace，不引入实现依赖
- 每个应用只保留 `README.md`、`package.json`、`tsconfig.json`、`src/README.md` 与必要的占位子目录说明
- 基础设施目录不强行做成 npm package
- 后续实现应优先复用 `pi` 发布包，不直接耦合本仓库 `packages/*` 源码

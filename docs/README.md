# Managed Agent Docs

`docs/` 目录按“为什么做、怎么设计、接口怎么暴露、当前做到哪里”组织。这里是完整导航页，不再承担 README 或项目骨架说明的职责。

## Layout

```text
docs/
  proposals/
  design/
  interfaces/
  status/
  archive/
```

## Overview

| 文档 | 什么时候读 |
|---|---|
| [../README.md](../README.md) | 第一次打开仓库，想快速理解项目定位、本地启动方式和 `managed` 亮点时 |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | 需要理解仓库结构、服务边界、放代码/文档/测试的位置时 |

## Feature Proposals

| 文档 | 作用 | 什么时候读 |
|---|---|---|
| [proposals/01-feature-proposal.zh-CN.md](./proposals/01-feature-proposal.zh-CN.md) | 为什么要做 managed agent，以及为什么沿用 `pi` 的 SDK + extensions 路线 | 第一次了解产品和技术方向时 |
| [proposals/02-session-observability-feature-proposal.zh-CN.md](./proposals/02-session-observability-feature-proposal.zh-CN.md) | 为什么 session observability 要单独立项，且不应塞进 session 本体 | 设计观测、运营、统计视图时 |
| [proposals/03-auth-foundation-feature-proposal.zh-CN.md](./proposals/03-auth-foundation-feature-proposal.zh-CN.md) | 为什么注册/登录必须先于多租户，以及当前阶段最小身份能力边界 | 设计真实用户身份和登录态时 |
| [proposals/04-multi-tenant-feature-proposal.zh-CN.md](./proposals/04-multi-tenant-feature-proposal.zh-CN.md) | 多租户为什么单独立项，以及哪些对象和策略要补 `tenantId` | 设计租户隔离和企业级扩展时 |
| [proposals/05-llm-provider-registry-feature-proposal.zh-CN.md](./proposals/05-llm-provider-registry-feature-proposal.zh-CN.md) | 为什么 provider 配置必须从 env/localStorage 收敛到数据库与 Settings | 设计模型提供商管理、模型切换和未来 LLM 场景复用时 |

## Architecture & Technical Design

| 文档 | 作用 | 什么时候读 |
|---|---|---|
| [design/minimal-architecture.zh-CN.md](./design/minimal-architecture.zh-CN.md) | 当前 MVP 的服务分层、运行约束、存储边界和实现顺序 | 需要先看整体架构总览时 |
| [design/technical-design.zh-CN.md](./design/technical-design.zh-CN.md) | 运行时对象、生命周期、worker/harness/sandbox 协作方式 | 进入实现细节或需要收敛边界时 |
| [design/auth-design.zh-CN.md](./design/auth-design.zh-CN.md) | 注册/登录、`login session` 与 `agent session` 的技术边界和接入方式 | 开始设计 auth 落地方案时 |
| [design/llm-provider-registry-design.zh-CN.md](./design/llm-provider-registry-design.zh-CN.md) | 用户级 provider registry、secret 加密、能力档位和 `pi-ai` 运行时边界 | 开始落地 Settings 驱动的 provider 配置和模型选择时 |

## API & Storage

| 文档 | 作用 | 什么时候读 |
|---|---|---|
| [interfaces/api-interface-draft.zh-CN.md](./interfaces/api-interface-draft.zh-CN.md) | MVP 的外部 HTTP/SSE 契约、事件语义和最小数据模型 | 设计 API、前后端联调或回顾接口约束时 |
| [interfaces/workspace-service-backend-project-storage-design.zh-CN.md](./interfaces/workspace-service-backend-project-storage-design.zh-CN.md) | `/mnt/*` 语义、Firecracker 执行面、热盘和 durable storage 分层 | 设计文件、存储、执行平面时 |

## Delivery Status

| 文档 | 作用 | 什么时候读 |
|---|---|---|
| [status/implementation-status.md](./status/implementation-status.md) | 当前阶段完成状态、下一阶段重点和 proposal 对应关系 | 需要判断项目做到哪里、下一步做什么时 |

## Shared Constraints

所有文档均以这些前提为准：

- 运行时依赖 `pi` 发布包，而不是直接耦合本仓库上游源码路径
- 平台能力优先放在 control plane、storage、sandbox、audit 这些 managed 外层
- transcript durable truth 在 transcript 文件，metadata/projection/audit durable truth 在 PostgreSQL
- 执行沙箱目标固定为 Firecracker MicroVM
- 持久挂载语义固定为 `/mnt/*`，实际根路径由 `MANAGED_AGENT_MOUNT_ROOT` 决定

## Suggested Reading Order

1. `proposals/01-feature-proposal.zh-CN.md`
2. `proposals/02-session-observability-feature-proposal.zh-CN.md`
3. `proposals/03-auth-foundation-feature-proposal.zh-CN.md`
4. `proposals/04-multi-tenant-feature-proposal.zh-CN.md`
5. `proposals/05-llm-provider-registry-feature-proposal.zh-CN.md`
6. `design/minimal-architecture.zh-CN.md`
7. `design/technical-design.zh-CN.md`
8. `design/auth-design.zh-CN.md`
9. `design/llm-provider-registry-design.zh-CN.md`
10. `interfaces/api-interface-draft.zh-CN.md`
11. `interfaces/workspace-service-backend-project-storage-design.zh-CN.md`
12. `status/implementation-status.md`

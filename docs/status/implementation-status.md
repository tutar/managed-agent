# Managed Agent Implementation Status

- `Status`: active
- `Owner`: TBD
- `Related Proposals`:
  - [../proposals/01-feature-proposal.zh-CN.md](../proposals/01-feature-proposal.zh-CN.md)
  - [../proposals/03-auth-foundation-feature-proposal.zh-CN.md](../proposals/03-auth-foundation-feature-proposal.zh-CN.md)
  - [../proposals/04-multi-tenant-feature-proposal.zh-CN.md](../proposals/04-multi-tenant-feature-proposal.zh-CN.md)
  - [../proposals/05-llm-provider-registry-feature-proposal.zh-CN.md](../proposals/05-llm-provider-registry-feature-proposal.zh-CN.md)

这份文档只记录当前实现状态和下一阶段重点，不重复 proposal 结论，也不承担项目骨架说明。

## Runtime & Control Plane

| 状态 | 事项 | 关联文档 | 备注 |
|---|---|---|---|
| `done` | 形成独立部署单元骨架：`managed-agent-api`、`web-ui` | `../design/minimal-architecture.zh-CN.md` | harness-worker 已并入 API 的 `harness-worker/` 模块 |
| `done` | 建立最小 `ManagedSessionService` / `TriggerService` / `ActiveSessionRegistry` / `AuditService` 主框架 | `../design/minimal-architecture.zh-CN.md` | control-plane 主链路已在运行 |
| `done` | 支持 `mock` / `pi` / `sandbox` 三种 runtime，API 内本地调度，去掉 Worker HTTP 跳 | `../design/minimal-architecture.zh-CN.md`、`../design/harness-worker-refactor.zh-CN.md` | `MANAGED_AGENT_RUNTIME` 控制切换 |
| `done` | 拆分 `apps/harness` 独立包（pi agent 运行时），支持容器内运行、in-process 调用、CLI 入口 | `../design/harness-worker-refactor.zh-CN.md` | TypeScript 编译，Docker 多阶段构建 |
| `todo` | 完成 trigger 调度、外部事件接入与更强恢复语义 | `../proposals/01-feature-proposal.zh-CN.md` | 当前仅保留最小 trigger 接口和主链路占位 |

## API & Web UI

| 状态 | 事项 | 关联文档 | 备注 |
|---|---|---|---|
| `done` | 打通 `POST /sessions`、`POST /sessions/{id}/messages`、`GET /sessions/{id}`、`GET /users/{userId}/sessions`、`POST /sessions/{id}/cancel` | `../proposals/01-feature-proposal.zh-CN.md`、`../interfaces/api-interface-draft.zh-CN.md` | 当前 API 可本地运行 |
| `done` | 拆出独立 `web-ui`，不再把浏览器端塞进 API | `../proposals/01-feature-proposal.zh-CN.md`、`../design/minimal-architecture.zh-CN.md` | 当前 `web-ui` 作为单独 app |
| `done` | 建立会话创建 / 续写 / 失败的最小 UI 状态机 | `../proposals/01-feature-proposal.zh-CN.md` | 当前页面支持正常用户视角聊天流程 |
| `done` | 冻结 `managed-agent-api` 的 V1 接口契约并补齐实现 | `../interfaces/api-interface-draft.zh-CN.md`、`../design/technical-design.zh-CN.md` | 已落地 rename、archive、分页和明确 SSE 生命周期 |
| `done` | 消息刷新不丢：sandbox transcript JSONL 磁盘缓存 + 回读 | `../design/user-isolation-design.zh-CN.md` | 已按回合顺序回读，合并多段 `process.delta` / `final.output.delta`，避免刷新后出现 `user,user,assistant,assistant` 排序错乱 |
| `done` | 用户级 LLM provider registry：Settings CRUD、provider catalog、chat provider/capability 选择 | `../proposals/05-llm-provider-registry-feature-proposal.zh-CN.md`、`../design/llm-provider-registry-design.zh-CN.md` | provider 配置已落 PostgreSQL，`web-ui` Settings 不再写 localStorage，chat 新 session 通过 `providerConfigId + modelId/capabilityTier` 选择模型。OpenAI Codex 和 GitHub Copilot 现在都支持浏览器发起的 OAuth connect/disconnect 流程。 |

## Durable Storage

| 状态 | 事项 | 关联文档 | 备注 |
|---|---|---|---|
| `done` | 建立本地共享 mount root 约定与清理脚本 | `../interfaces/workspace-service-backend-project-storage-design.zh-CN.md` | 当前统一使用仓库根 `.managed-agent/mnt` |
| `in_progress` | 接入生产级 durable metadata / transcript store | `../design/minimal-architecture.zh-CN.md`、`../interfaces/workspace-service-backend-project-storage-design.zh-CN.md` | PostgreSQL metadata/audit 与 transcript 读路径已接入；`kind-managed-agent` 上的本地 PV/PVC create/continue/refresh 联调已通过，仍缺真实生产挂载层联调 |
| `todo` | 接入远端对象存储同步器和自动化 durable 挂载 | `../interfaces/workspace-service-backend-project-storage-design.zh-CN.md` | 当前仍是本地目录验证，不是完整生产挂载 |

## Sandbox & Execution Plane

| 状态 | 事项 | 关联文档 | 备注 |
|---|---|---|---|
| `done` | 建立 `DeepSeek via pi` 真实 LLM 联调基线 | `../design/minimal-architecture.zh-CN.md` | mock / pi in-process / sandbox Pod 三种模式均可运行 |
| `done` | Sandbox Pod 调度：K8s API 创建 Pod，stdout 日志轮询，事件流回传，Pod 完成即删 | `../design/user-isolation-design.zh-CN.md` | kind 集群本地验证通过 |
| `done` | Sandbox Pod 内 pi agent 运行，调 DeepSeek，事件流回传 | `../design/user-isolation-design.zh-CN.md` | TypeScript entrypoint + harness Docker 镜像 |
| `done` | 收口 sandbox transcript 重建、重复 delta、执行失败语义 | `../design/user-isolation-design.zh-CN.md` | 已修正刷新后 transcript 回放顺序、保留重复 delta、`run.failed` 进入失败路径，并在 `kind-managed-agent` 上完成 PVC 挂载与 sandbox continuation 联调 |
| `todo` | 引入 Firecracker、`cwd` 生命周期（当前 containerd runc） | `../proposals/01-feature-proposal.zh-CN.md`、`../design/minimal-architecture.zh-CN.md` | 本地 kind 验证用容器代替 VM |
| `todo` | 收紧命令策略、预算和执行护栏 | `../design/technical-design.zh-CN.md` | 仍处于最小联调基线阶段 |

## Identity & Tenant Roadmap

| 状态 | 事项 | 关联文档 | 备注 |
|---|---|---|---|
| `done` | 落地个人用户注册、登录、登出和 `GET /me` | `../proposals/03-auth-foundation-feature-proposal.zh-CN.md`、`../design/auth-design.zh-CN.md`、`../interfaces/api-interface-draft.zh-CN.md` | 当前主路径已切到真实登录态 |
| `done` | 用户级资源隔离设计文档 | `../design/user-isolation-design.zh-CN.md` | Kata + Firecracker + CoW + vCPU overcommit |
| `todo` | 落地多租户、配额、预算、审计落库与策略控制 | `../proposals/04-multi-tenant-feature-proposal.zh-CN.md`、`../design/minimal-architecture.zh-CN.md` | 当前仍停留在最小单租户骨架 |

## Next Focus

建议下一阶段优先级：

1. 网络策略（NetworkPolicy + HTTP Proxy）
2. Skills 用户级安装
3. Firecracker 和真实 `cwd` 生命周期
4. 多租户和策略层
5. 真实生产挂载层联调

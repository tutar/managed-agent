# Managed Agent 认证基础技术设计

- `Status`: active
- `Owner`: TBD
- `Related Proposals`:
  - [../proposals/03-auth-foundation-feature-proposal.zh-CN.md](../proposals/03-auth-foundation-feature-proposal.zh-CN.md)
  - [../proposals/01-feature-proposal.zh-CN.md](../proposals/01-feature-proposal.zh-CN.md)
  - [../proposals/04-multi-tenant-feature-proposal.zh-CN.md](../proposals/04-multi-tenant-feature-proposal.zh-CN.md)
- `Related Interfaces`:
  - [../interfaces/api-interface-draft.zh-CN.md](../interfaces/api-interface-draft.zh-CN.md)

## 概述

本文定义 `03-auth-foundation-feature-proposal.zh-CN.md` 的实现级设计，目标是在不改变现有 `agent session` 真相模型的前提下，为 managed agent 平台引入最小个人用户注册/登录能力。

这份设计只覆盖：

- 个人用户注册、登录、登出、获取当前用户
- `login session` 的服务端持久化
- 当前请求用户如何进入现有 `Managed Agent API`
- `web-ui` 如何从开发态 `demo-user` 迁移到真实登录态

这份设计不覆盖：

- 企业用户
- SSO / OAuth / SAML
- 多租户资源隔离
- RBAC
- 独立 auth service

## 核心边界

### `login session` 与 `agent session`

必须明确区分两类 session：

| 对象 | 作用 | durable truth | 所属层 |
|---|---|---|---|
| `login session` | 用户认证态 | PostgreSQL | `Managed Agent API` auth 子系统 |
| `agent session` | managed agent 会话、prompt 历史、transcript、续写上下文 | `pi` session + transcript 文件 + metadata/projection | 现有 control-plane / worker runtime |

关系固定为：

```text
user account
  -> login session
    -> authenticated request
      -> userId
        -> agent session
```

约束：

- `login session` 只回答“当前请求是谁”
- `agent session` 继续回答“当前会话是什么、如何继续执行”
- `harness-worker` 和 `pi` 不理解 cookie、不读取 `login session`
- `Managed Agent API` 负责把登录态解析成 `userId`，再接入已有 session/control-plane 逻辑

## 技术原则

| 主题 | 结论 |
|---|---|
| 认证形态 | 用户名密码 + 服务端 session |
| `login session` durable store | PostgreSQL |
| auth 服务拓扑 | 并入 `Managed Agent API` |
| `agent session` 真相 | 保持不变 |
| 当前用户来源 | 从认证态解析，不再依赖 `demo-user` |
| worker / pi 认知范围 | 只处理 `agent session` |

## 数据模型

### 用户模型

最小字段：

- `userId`
- `username`
- `passwordHash`
- `status`
- `createdAt`
- `lastLoginAt`

语义：

- `userId` 是平台个人用户主键
- `username` 是当前阶段唯一登录名
- `passwordHash` 只保存摘要，不保存明文密码
- `status` 预留账户禁用/冻结能力

### 登录会话模型

最小字段：

- `loginSessionId`
- `userId`
- `status`
- `createdAt`
- `expiresAt`
- `lastSeenAt`

语义：

- `loginSessionId` 是认证态主键，不等于 `sessionId`
- `userId` 指向用户账户
- `status` 表达登录态是否仍然有效
- `expiresAt` 负责过期边界
- `lastSeenAt` 负责最近活动时间

## 后端组件设计

### `Managed Agent API` 内新增 auth 子系统

auth 能力不拆独立服务，直接放在 `Managed Agent API` 内。

建议新增这些逻辑对象：

| 组件 | 作用 |
|---|---|
| `AuthService` | 注册、登录、登出、当前用户查询的业务入口 |
| `CurrentUserResolver` | 从 request 中解析当前用户 |
| `SessionCookieManager` | 负责 login session cookie 的创建、读取和清理 |
| `UserRepository` | 读写用户账户 |
| `LoginSessionRepository` | 读写 login session |

边界约束：

- `AuthService` 不操作 `agent session`
- `ManagedSessionService` 不理解密码或 cookie
- `CurrentUserResolver` 只产出当前 `userId`/current user context

## 请求鉴权与 `userId` 注入

### 请求处理链

建议请求链固定为：

1. 浏览器请求进入 `Managed Agent API`
2. `SessionCookieManager` 从 cookie 读取 `loginSessionId`
3. `CurrentUserResolver` 读取 `login session` 和用户信息
4. 解析出当前认证用户
5. 现有 session/control-plane 逻辑继续使用该 `userId`

结果：

- `POST /sessions`
- `POST /sessions/{id}/messages`
- `GET /sessions/{id}`
- `GET /users/{userId}/sessions`
- `POST /sessions/{id}/cancel`

这些接口后续都应建立在当前认证用户之上，而不是长期依赖前端显式传 `demo-user`。

### 迁移原则

当前实现中仍有开发态 `demo-user`。引入 auth 后，迁移原则应是：

- 开发态 `demo-user` 仅保留为过渡兼容或测试基线
- 新主路径由登录态提供 `userId`
- session/recent sessions/trigger/audit 的用户归属都从认证态进入

## 与现有 Agent Session 链路的关系

当前项目里已经存在的 session 链路不改变：

- `pi` session 仍然是会话真相
- transcript durable truth 仍然是 transcript 文件
- PostgreSQL 里的 metadata / projection / audit 仍围绕 `agent session` 工作
- worker 仍只根据 job 和 `piSessionFile` 重建 runtime

auth 接入只新增一层：

- `Managed Agent API` 在进入 control-plane 之前先解析当前用户

因此实现方向不是“把 auth 做进 worker”，而是“把 `userId` 稳定注入现有 API/control-plane 主链路”。

## Web UI 接入设计

### 最小页面能力

`web-ui` 需要新增最小身份流：

- 注册页
- 登录页
- 登出入口
- 当前用户信息获取

### 接入原则

- 登录成功后，浏览器持有服务端 session cookie
- 后续 API 请求带 cookie，而不是依赖本地硬编码 `demo-user`
- 页面初始化时先拉 `GET /me`
- 若当前未登录，则进入注册/登录流
- 若当前已登录，再加载 recent sessions 和当前会话

### 对现有聊天页的影响

当前 `web-ui` 中围绕 `demo-user` 的逻辑需要迁移为：

- current user from `GET /me`
- authenticated recent sessions
- authenticated session create/continue/cancel

也就是说，聊天页不再自己决定 `userId`，而是消费当前登录态解析出来的用户上下文。

## 最小接口面

这份设计冻结以下 auth 能力面：

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /me`

这份文档不展开完整 wire contract，但要求语义明确：

- register 创建新用户
- login 建立服务端 session
- logout 使当前 login session 失效
- `GET /me` 返回当前认证用户

## 本地开发约定

本地技术设计约定：

- 默认测试账号：`agentos`
- 默认测试密码：`agentos`

这组默认值只服务于开发与联调，不是生产产品流程的一部分。

## 失败模式与安全边界

当前阶段至少要明确处理这些失败场景：

- 用户名已存在
- 用户名/密码错误
- login session 缺失
- login session 已过期
- login session 指向的用户已禁用
- 未认证用户访问需要登录的 session API

安全边界：

- cookie/session store 只在 `Managed Agent API` 处理
- worker 不消费 auth state
- 不把密码、cookie 或认证细节写入 transcript
- 不让 `agent session` 承担登录态语义

## 与多租户的衔接

这份设计是 `04-multi-tenant-feature-proposal.zh-CN.md` 的前置层。

顺序固定为：

1. 先建立真实用户和 `login session`
2. 先把 `userId` 稳定注入当前 managed session 体系
3. 再在后续多租户设计中扩展：
   - `tenantId`
   - `tenant_users`
   - tenant policy
   - tenant-scoped resource visibility

当前阶段不在 auth 设计里引入 `tenantId`。

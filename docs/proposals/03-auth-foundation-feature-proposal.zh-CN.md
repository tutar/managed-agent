# Managed Agent 注册登录前提功能提案

- `Status`: active
- `Owner`: TBD
- `Related Design`:
  - [../design/minimal-architecture.zh-CN.md](../design/minimal-architecture.zh-CN.md)
  - [../design/technical-design.zh-CN.md](../design/technical-design.zh-CN.md)
  - [../design/auth-design.zh-CN.md](../design/auth-design.zh-CN.md)

## 概述

本文定义为什么在当前 managed agent 平台里，用户注册/登录能力需要先于多租户立项，并作为后续真实身份体系的前提能力单独明确下来。

这里的重点不是一次性设计完整 IAM、企业目录或组织协作体系，而是回答：

- 为什么当前不能继续依赖匿名用户或硬编码 `demo-user`
- 为什么多租户之前必须先有真实 `userId`
- 当前阶段最小应该补哪些身份能力
- 这一阶段明确不做什么

## 提案结论

| 主题 | 结论 |
|---|---|
| 当前用户形态 | 只支持个人用户 |
| 当前认证主路线 | 账号密码 + 服务端 session |
| 当前核心身份键 | `userId` |
| 登录态对象 | `login session` |
| 当前会话真相 | `agent session`（现有 `sessionId` / `pi` session） |
| 当前是否引入 `tenantId` | 否 |
| 当前是否支持企业用户 | 否 |
| 当前是否支持 SSO | 否 |
| 本地测试默认账户 | `agentos / agentos` |
| 与多租户关系 | 作为多租户前提能力 |

## 为什么要单独立项

当前系统虽然已经有：

- `sessionId`
- transcript
- recent sessions
- trigger
- PostgreSQL durable metadata

但这些能力仍然建立在“调用方身份暂时不真实”的前提上，例如：

- 前端默认使用固定 `demo-user`
- API 查询边界仍然依赖显式 `userId`
- session 归属还不是由真实登录态驱动

如果直接跳到多租户，会遇到一个更基础的问题：

1. 用户是谁还不真实  
   如果连真实 `userId` 都不存在，后续 `tenant_users`、成员关系、权限边界都没有稳定起点。

2. API 访问边界不稳  
   当前很多接口还是“传一个 `userId` 来查”，这不适合作为长期身份模型。

3. 资源归属没有真实主体  
   session、trigger、audit、recent sessions 这些对象都需要先知道属于哪个用户。

4. 多租户会把问题放大  
   在没有用户注册/登录的前提下引入 `tenantId`，只会把身份问题从单层放大成双层。

所以注册/登录不是一个“可选的外围能力”，而是多租户前必须先补齐的身份前提。

## 当前阶段不解决什么

这份提案明确不解决：

- 企业用户体系
- 企业 SSO / OAuth / SAML
- tenant bootstrap
- 邀请、成员加入、组织关系
- RBAC / 角色权限
- 多租户资源隔离
- 外部身份提供商接入

这份提案只处理“个人用户如何拥有真实登录态”。

## 核心设计

### 1. 当前阶段先建立真实 `userId`

这一阶段建议先把用户身份模型收敛为：

- `userId`
- `username`
- `passwordHash`
- `status`
- `createdAt`
- `lastLoginAt`

目标是让后续所有 session、trigger、audit、projection 都能先稳定归属到真实用户，而不是临时 query 参数。

### 2. 当前阶段不引入 `tenantId`

建议关系如下：

```text
userId -> sessionId
```

而不是现在就变成：

```text
tenantId -> userId -> sessionId
```

原因不是最终不做多租户，而是当前阶段先把“用户真实存在”这件事补齐，再进入租户维度会更稳。

### 3. 登录会话与 Agent 会话的边界

当前文档里的“session”必须明确分成两类，不能混用：

| 对象 | 作用 | 当前是否已存在 |
|---|---|---|
| `login session` | 表示用户认证态；用于登录、登出、过期、续期和 cookie/session store | 否 |
| `agent session` | 表示 managed agent 会话；对应当前 `sessionId`、`pi` session、transcript、续写 prompt | 是 |

关系建议明确为：

```text
user account
  -> login session
    -> authenticated request
      -> userId
        -> agent session
```

这意味着：

- `login session` 只负责回答“当前请求是谁”
- `agent session` 继续负责回答“当前会话是什么、历史消息是什么、如何继续执行”
- 登录能力引入后，不应复用、替换或污染当前 `agent session` 模型
- `harness-worker` 和 `pi` 不应感知 `login session`，它们继续只处理 `agent session`

在实现边界上，更准确的说法是：

- `Managed Agent API` 从登录态解析当前用户
- 再把 `userId` 传入已有 session/control-plane 逻辑
- 当前 `POST /sessions`、`GET /sessions/{id}`、`GET /users/{userId}/sessions` 等接口，只是把开发态 `demo-user` 来源替换成真实登录态来源

### 4. 当前阶段的最小能力集合

建议第一版只包含：

- 注册
- 登录
- 登出
- 获取当前用户
- 基于登录态访问已有 session API

也就是：

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /me`

这份提案只冻结能力面，不展开详细接口 contract、cookie 字段或密码算法实现细节。

### 5. 当前认证主路线先固定为账号密码 + session

当前阶段建议选择：

- 用户名/密码注册与登录
- 服务端 session 作为登录态

这样做的原因是：

- 前后端闭环最短
- 对当前独立 `web-ui` 最直接
- 比一开始就引入 JWT / refresh token 更少状态分叉
- 更适合作为后续多租户前的最小身份前提

## 最小使用场景

这份能力至少要支持：

1. 用户在 Web UI 中注册并登录
2. 登录后不再依赖硬编码 `demo-user`
3. 当前用户只能看到自己的 session / recent sessions / trigger
4. API 从登录态解析 `userId`，而不是长期依赖客户端显式传参

## 与现有架构的关系

建议职责如下：

| 能力 | 归属 |
|---|---|
| 注册/登录/登出 | `Managed Agent API` |
| 登录态保持 | 服务端 session |
| 当前用户解析 | `Managed Agent API` |
| `agent session` / trigger / audit 用户归属 | `Managed Agent API` 内的 control-plane 逻辑 |

这一步不改变：

- `pi` session 仍然是会话真相
- `agent session` 仍然是当前项目里已经存在的 durable conversation session
- worker 仍然不需要读取用户目录
- worker 和 `pi` 不需要理解登录 cookie 或 `login session`
- transcript durable truth 仍然是 transcript 文件

## 为什么排在多租户之前

按落地顺序看，注册/登录比多租户更早决定这些边界：

- API 身份从哪里来
- `userId` 如何稳定产生
- session 和 trigger 的归属如何落盘
- 前端如何从匿名/默认用户切到真实登录态

多租户应建立在这些边界已经稳定之后，而不是反过来让 `tenantId` 去替代身份体系。

## 后续文档关系

这份提案只定义：

- 为什么注册/登录要先做
- 当前阶段用户身份边界
- 当前阶段最小能力集合
- 它与多租户的前后关系

后续实现设计见：

- [../design/auth-design.zh-CN.md](../design/auth-design.zh-CN.md)

相关文档：

- [01-feature-proposal.zh-CN.md](./01-feature-proposal.zh-CN.md)
- [04-multi-tenant-feature-proposal.zh-CN.md](./04-multi-tenant-feature-proposal.zh-CN.md)
- [../design/minimal-architecture.zh-CN.md](../design/minimal-architecture.zh-CN.md)
- [../design/technical-design.zh-CN.md](../design/technical-design.zh-CN.md)

# LLM Provider Registry 技术设计

- `Status`: active
- `Owner`: TBD
- `Related Proposals`:
  - [../proposals/05-llm-provider-registry-feature-proposal.zh-CN.md](../proposals/05-llm-provider-registry-feature-proposal.zh-CN.md)
  - [../proposals/03-auth-foundation-feature-proposal.zh-CN.md](../proposals/03-auth-foundation-feature-proposal.zh-CN.md)
- `Related Interfaces`:
  - [../../apps/managed-agent-api/docs/openapi.yaml](../../apps/managed-agent-api/docs/openapi.yaml)

## 概述

本文定义用户级 LLM provider registry 的实现方式。目标是把当前：

- 后端环境变量 provider 配置
- `web-ui` 本地 models 配置

收敛成一条后端驱动、数据库持久化、运行时可解析的统一链路。

## 目标

- provider 配置按用户维度持久化
- Settings 页真实驱动后端执行
- chat 和未来其他 LLM 场景共用一套 provider registry
- `apps/harness` 运行时不再依赖 provider 级环境变量
- `pi-ai` 继续作为运行时 provider adapter

## 非目标

- 不做企业级共享 provider 池
- 不做租户级 provider policy
- 不做预算、配额、成本统计
- 不做企业级 SSO/OIDC 统一身份编排

## 核心边界

### 配置真相

provider 配置的 durable truth 固定为 PostgreSQL。

`web-ui`、`Managed Agent API`、`apps/harness` 的边界如下：

| 组件 | 责任 |
|---|---|
| `web-ui` | 管理 provider 配置、读取 provider catalog、提交 session 时选择 provider/model/thinkingLevel |
| `Managed Agent API` | 读写 provider 配置、加密 secret、验证 provider、把配置解析成运行时 provider config |
| `apps/harness` | 消费已解析的 provider runtime config，并通过 `pi-ai` 运行 |
| `pi-ai` | 真正对接各 provider 的执行 adapter |

### 用户身份与 provider 凭据

provider config 属于用户，而不是登录会话。

关系固定为：

```text
user account
  -> login session
    -> authenticated request
      -> user-owned provider configs
        -> session model selection
          -> runtime provider config
```

`login session` 只负责回答“当前请求是谁”。provider credential 属于用户持久化配置，不属于 `login session` 本身。

## 数据模型

### `managed_agent_llm_provider_configs`

用于保存用户级 provider 实例。

最小字段：

- `providerConfigId`
- `userId`
- `providerType`
- `displayName`
- `authMode`
- `encryptedSecret`
- `baseUrl`
- `apiType`
- `headersJson`
- `providerOptionsJson`
- `availableModelsJson`
- `defaultModelId`
- `defaultThinkingLevel`
- `enabled`
- `createdAt`
- `updatedAt`

设计说明：

- `providerType` 是 catalog 类型，例如 `deepseek`、`openai-compatible`
- `encryptedSecret` 存加密后的 API key 或 OAuth credential material
- `availableModelsJson` 存该用户实例下可见模型列表和模型元数据
- 模型元数据可选包含 `supportedThinkingLevels`

### `managed_agent_sessions` 扩展字段

session metadata 中新增：

- `providerConfigId`
- `providerType`

设计说明：

- session 一旦创建，后续续写默认沿用同一 provider config
- `model` 字段仍保留，但它保存的是已经解析后的运行时模型标识
- `thinkingLevel` 保存创建该 session 时实际使用的推理强度

## Secret 存储策略

provider secret 不以明文落库。

策略固定为：

- 使用一把应用级 master key：`MANAGED_AGENT_SECRETS_KEY`
- `Managed Agent API` 在写库前做应用层加密
- 读取时在 API 层解密
- `apps/harness` 不直接访问数据库 secret

### 支持的 secret 形态

#### API key 型

- `apiKey`

#### OAuth 型

- `access`
- `refresh`
- `expires`
- `accountId`（如 OpenAI Codex）
- `enterpriseUrl`（如 GitHub Copilot Enterprise）

当前 v1 不再要求用户手填 OAuth credential JSON。

对于 OAuth 型 provider：

- `web-ui` Settings 通过后端发起授权
- `Managed Agent API` 在 Node 侧完成 provider-specific OAuth 流程
- 最终把 materialized credential 加密后写回 provider config

这轮仅覆盖：

- OpenAI Codex
- GitHub Copilot

## Provider Type Catalog

后端维护一份静态 catalog，定义每个 provider 类型的：

- `providerType`
- `displayName`
- `authMode`
- `runtimeProviderId`
- `usesBuiltInProvider`
- `apiType`
- `supportsCustomBaseUrl`
- `supportsCustomHeaders`
- `baseUrlRequired`
- `defaultModels`
- `defaultThinkingLevel`

catalog 既服务 API，也服务 Settings UI。

## 模型选择模型

### 两层选择

session 创建时统一采用两层选择：

1. `providerConfigId`
2. `modelId`

### 推理强度

`thinkingLevel` 是可选的第二维度，但它不再等价于固定三档。

一个 provider/model 可能：

- 不支持显式推理强度
- 支持 `low / medium / high`
- 支持 `low / medium / high / xhigh`
- 支持 `low / medium / high / xhigh / max`

因此它必须作为模型元数据表达，而不是平台硬编码枚举。

解析规则：

- 如果请求显式传 `modelId`，直接使用该模型
- 如果请求显式传 `thinkingLevel`，只有在所选模型支持该 level 时才允许通过
- 如果未传 `modelId`，则使用 provider config 的 `defaultModelId`
- 如果未传 `thinkingLevel`，则使用 provider config 的 `defaultThinkingLevel`

## 运行时解析

`Managed Agent API` 负责在 session create/continue 前把 provider config 解析成 `ResolvedLlmRuntimeConfig`。

该对象至少包含：

- `providerConfigId`
- `providerType`
- `runtimeProviderId`
- `displayName`
- `modelId`
- `thinkingLevel`
- `authMode`
- `apiType`
- `baseUrl`
- `apiKey`
- `headers`
- `oauthCredential`
- `usesBuiltInProvider`
- `supportsReasoning`
- `availableModels`

## 与 `pi-ai` 的边界

### Built-in provider

对于 `pi-ai` 已内建的 provider：

- 通过 `AuthStorage.inMemory()` 写入 credential
- 通过 `ModelRegistry.inMemory()` 查找模型

### Custom compatible provider

对于 OpenAI-compatible / 其他兼容 API：

- 由 `Managed Agent API` 解析出 `baseUrl`、`headers`、`apiType`
- `apps/harness` 通过 `ModelRegistry.registerProvider()` 动态注册

### OAuth provider

对于 OAuth 型 provider：

- API 负责两件事：
  - 浏览器授权流编排
  - 把已保存的 OAuth credential material 下发给 harness
- harness 只消费 materialized credential，不负责浏览器交互授权

## OAuth 浏览器授权流

### OpenAI Codex

OpenAI Codex 使用标准授权码 + PKCE。

实现边界固定为：

- `Managed Agent API` 生成 PKCE verifier/state
- API 返回授权 URL 给 `web-ui`
- `web-ui` 用弹窗或新窗口打开授权页面
- OpenAI 回调到 API 的 callback endpoint
- API 交换 token、提取 `accountId`、加密持久化 credential
- `web-ui` 通过轮询 flow status 获知成功/失败

这里不复用 `pi-ai` 内置的本地 callback server，因为那套回调地址固定在本机 CLI 场景，不适用于浏览器访问 API 服务的 Web UI。

### GitHub Copilot

GitHub Copilot 使用 device code flow。

实现边界固定为：

- `Managed Agent API` 在 Node 侧调用 `pi-ai/oauth` 的 programmatic login
- `web-ui` 获取 verification URL 和 user code
- 用户在浏览器完成授权
- API 后台轮询 device flow 直到拿到 credential
- `web-ui` 轮询 flow status 并刷新 provider config 列表

如果用户需要 GitHub Enterprise，Settings 在发起连接时允许提交可选的 enterprise URL/domain。

## API 设计

当前 v1 增加以下接口：

- `GET /llm-provider-types`
- `GET /me/llm-providers`
- `POST /me/llm-providers`
- `PATCH /me/llm-providers/{providerConfigId}`
- `DELETE /me/llm-providers/{providerConfigId}`
- `POST /me/llm-providers/{providerConfigId}/validate`
- `POST /me/llm-providers/{providerConfigId}/oauth/start`
- `GET /me/llm-providers/{providerConfigId}/oauth/flows/{flowId}`
- `DELETE /me/llm-providers/{providerConfigId}/oauth-account`
- `GET /oauth/llm-provider-flows/openai-codex/callback`

session 创建接口新增输入：

- `providerConfigId`
- `modelId`
- `thinkingLevel`

## Web UI 设计

### Settings

Settings 页不再写 localStorage。

它需要：

- 拉取 provider catalog
- 拉取用户 provider configs
- 创建、编辑、删除 provider config
- 展示 credential 是否已存储
- 对 OAuth provider 发起 connect / disconnect
- 编辑 default model 和 default thinking level

### OAuth 交互

对于 OAuth 型 provider：

- 不再显示 credential JSON 文本框
- 显示 `Connect` / `Disconnect`
- `Connect` 后：
  - OpenAI Codex：打开授权页并轮询 callback flow 状态
  - GitHub Copilot：打开 device verification 页、展示 user code，并轮询 flow 状态

### Chat

chat 新建 session 时：

- 必须先选择一个可用 `providerConfigId`
- 选择一个具体 `modelId`
- 在模型支持时可选 `thinkingLevel`
- 没有任何可用 provider 时禁止发送

## 迁移策略

这轮不保留长期双路径兼容。

固定迁移方向：

- 废弃 `DEEPSEEK_API_KEY`
- 废弃 `MANAGED_AGENT_DEFAULT_MODEL`
- 废弃前端本地 `useModelConfigs` localStorage 配置

本地开发改为：

- 使用 `MANAGED_AGENT_SECRETS_KEY` 作为平台 master key
- 启动后通过 Settings 配置 provider

## 测试策略

### 后端

- provider repository CRUD
- secret 加密/解密 round-trip
- provider validation
- thinkingLevel 校验
- session create 使用 providerConfigId + modelId/thinkingLevel

### 前端

- Settings CRUD
- chat provider/model/thinkingLevel 选择
- 无 provider 时的禁用与引导

### 运行时

- `apps/harness` 只通过 job 中的 provider runtime config 运行
- 不再依赖 provider 级环境变量

## 关于 UI 预设

`fast / balanced / strong` 如果未来继续存在，只能作为 UI 层的可选便捷预设。

它们不再进入：

- durable schema
- 核心服务对象
- 公开 session API 请求字段

也就是说，底层真实能力模型固定为：

- `modelId`
- `thinkingLevel`

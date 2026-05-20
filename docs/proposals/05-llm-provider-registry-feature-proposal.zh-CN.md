# LLM Provider Registry 功能提案

- `Status`: active
- `Owner`: TBD
- `Related Design`:
  - [../design/llm-provider-registry-design.zh-CN.md](../design/llm-provider-registry-design.zh-CN.md)
  - [../design/technical-design.zh-CN.md](../design/technical-design.zh-CN.md)

## 概述

当前仓库里，LLM provider 配置同时存在于两处：

- 后端环境变量
- `web-ui` Settings 的本地配置

这导致两个问题：

1. 配置源重复，页面配置并不驱动真实运行时
2. 配置能力过弱，无法按用户维度维护多个 provider、多个模型和真实的推理强度选择

本提案的目标是把 provider 配置统一成一条主路径：

- provider 配置按用户维度存 PostgreSQL
- `web-ui` Settings 成为唯一管理入口
- `Managed Agent API` 成为唯一 provider 解析与模型选择入口
- `apps/harness` / `pi-ai` 只消费 API 下发的运行时 provider 配置

## 要解决的问题

### 1. 环境变量路径不可持续

`DEEPSEEK_API_KEY`、`MANAGED_AGENT_DEFAULT_MODEL` 这种模式只适合单 provider、单模型、单环境联调。

它无法回答这些平台级问题：

- 一个用户是否可以维护多个 provider
- chat 页面之外的其他 LLM 调用点如何复用同一组 provider 配置
- OAuth 型 provider 如何和当前用户身份绑定
- 不同 provider/model 支持的推理强度如何表达

### 2. 页面配置没有真正接入运行时

`web-ui` Settings 里现有的 models 配置只存在于浏览器本地，不是执行真相。

结果是：

- 用户在页面里改了配置，后端执行不会跟着变
- 前后端对“当前模型配置”没有统一定义

## 结论

### 1. provider 配置真相统一存数据库

- 唯一 durable truth：PostgreSQL
- 唯一用户入口：`web-ui` Settings
- 唯一运行时解析入口：`Managed Agent API`

### 2. 废弃 provider 级环境变量主路径

以下配置不再作为 provider 真相源：

- `DEEPSEEK_API_KEY`
- `MANAGED_AGENT_DEFAULT_MODEL`

环境变量仍可保留平台级配置，例如：

- 数据库连接
- 挂载根路径
- secret encryption master key

但不再直接承载某个 provider 的 API key 或默认模型选择。

### 3. provider registry 是平台共享能力

这套 provider registry 不只服务 chat 页面，还要服务后续所有需要 LLM 的地方。

因此它必须具备：

- 用户级 provider CRUD
- provider 下的模型管理
- 模型选择与推理强度选择
- OAuth / API key 等不同认证模式

### 4. provider 运行时继续通过 `pi-ai` 落地

本提案不替换 `pi-ai`。

边界固定为：

- `Managed Agent API` 管配置、鉴权材料、模型选择
- `apps/harness` 把 API 下发的运行时配置喂给 `pi-ai`
- `pi-ai` 继续作为 provider runtime adapter

## 范围

### 本提案覆盖

- 用户级 provider registry
- Settings 页真实 CRUD
- 多 provider / 多模型 / 推理强度选择
- API key 型和 OAuth 型 provider 的统一数据模型
- chat 创建新 session 时选择 provider + model/thinkingLevel

### 本提案不覆盖

- 企业级共享 provider 池
- 多租户级 provider policy
- 第三方 OAuth 浏览器交互细节的完整产品设计
- provider 使用统计、预算和配额

## Provider 类型范围

当前 v1 需要支持以下 provider 类型 catalog：

- OpenAI
- Azure OpenAI (Responses)
- OpenAI Codex
- DeepSeek
- Anthropic
- Google
- Vertex AI (Gemini via Vertex AI)
- Mistral
- Groq
- Cerebras
- Cloudflare AI Gateway
- Cloudflare Workers AI
- xAI
- OpenRouter
- Vercel AI Gateway
- MiniMax
- Together AI
- GitHub Copilot
- Amazon Bedrock
- OpenCode Zen
- OpenCode Go
- Fireworks
- Kimi For Coding
- Xiaomi MiMo
- Any OpenAI-compatible API

## 用户体验结论

### Settings

Settings 下的 models/provider 配置必须变成真实后端数据，而不是浏览器本地状态。

用户可以：

- 新增 provider
- 修改 provider
- 删除 provider
- 配置默认模型和默认推理强度
- 存储 API key 或 OAuth credential material

### Chat

chat 页面创建新 session 时，至少要支持：

- 选择 provider config
- 显式选择具体模型
- 在模型支持时选择推理强度

### 无 provider 配置时

如果当前用户没有任何可用 provider config：

- chat 页面禁止发送
- 页面应引导用户先去 Settings 配置 provider

## 成功标准

- 页面 Settings 配置会真实影响后端运行
- provider 切换、模型切换、推理强度选择在 chat 中可用
- 后端不再依赖 provider 级环境变量
- `apps/harness` 可以只依赖 job 中的 provider runtime config 运行
- 后续其他 LLM 能力点可以直接复用同一 provider registry

## 模型与推理强度的边界

本提案明确不再把 `fast / balanced / strong` 当成底层能力模型。

原因：

- 有些 provider/model 当前没有公开的推理强度档位
- 有些 provider/model 的推理强度多于 3 档，例如 `low / medium / high / xhigh / max`
- `fast / balanced / strong` 最多只能作为未来 UI 层的便捷预设，不能作为 durable schema 和公开 API 的核心字段

因此，底层模型统一为：

- `modelId`
- `thinkingLevel`（可选）

其中：

- `thinkingLevel` 只在所选模型支持推理强度控制时才出现
- 模型是否支持、支持哪些 level，由 provider registry 中的模型元数据表达

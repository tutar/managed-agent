# managed-agent-api

`managed-agent-api` 是这个仓库里的 control-plane HTTP 入口。它对应
[`technical-design.zh-CN.md`](../../docs/design/technical-design.zh-CN.md)
里 `Managed Agent API` 的对象归属，而不是一个把所有 API 代码平铺在一起的服务目录。

当前主职责：

- 暴露 `web-ui` 使用的 JSON/SSE API
- 维护 login session 与当前认证用户上下文
- 编排 agent session 的创建、续写、取消、归档
- 读写 durable metadata / projection / audit
- 读取 durable transcript 文件并组装 `/sessions/{id}` 响应

## Source Layout

`src/` 目录按“对象归属”而不是“技术细节”组织：

```text
src/
  server.ts
  app/
    create-app.ts
    error-handler.ts
    plugins/
      cookie.ts
      cors.ts
  channel/
    web-api-adapter.ts
    web-api/
      dto/
        auth-dto.ts
        session-dto.ts
      errors/
        http-errors.ts
      routes/
        auth-routes.ts
        health-routes.ts
        session-routes.ts
        trigger-routes.ts
      schemas/
        auth-schema.ts
        session-schema.ts
      sse/
        stream-response-proxy.ts
        sse-writer.ts
  identity/
    auth-service.ts
    authorization-guard.ts
    identity-resolver.ts
    password-hasher.ts
    session-cookie-manager.ts
    repositories/
      auth-repository.ts
      postgres-auth-repository.ts
  control-plane/
    audit/
      audit-repository.ts
      audit-service.ts
      repositories/
        audit-repository.ts
        postgres-audit-repository.ts
    session/
      active-session-registry.ts
      entry-factory.ts
      event-publisher.ts
      managed-session-service.ts
      pi-file-transcript-reader.ts
      session-repository.ts
      transcript-reader.ts
      repositories/
        postgres-session-repository.ts
        session-metadata-repository.ts
        session-repository.ts
        transcript-repository.ts
        user-session-projection-repository.ts
    trigger/
      trigger-service.ts
  infrastructure/
    persistence/
      postgres/
        database.ts
        schema.ts
    storage/
      mount-paths.ts
```

## Placement Rules

- `app/`
  - 只放 Fastify 容器装配。
  - 不放业务决策，不直接碰 PostgreSQL 查询。
- `channel/`
  - 只放协议适配层。
  - `web-api/` 下负责 route、schema、DTO、SSE 写出。
  - 新增 HTTP transport 逻辑优先放这里，而不是塞进 `server.ts`。
- `identity/`
  - 只处理 `login session`、cookie、当前用户解析与授权边界。
  - 不能承载 `agent session` transcript 或 worker 运行时语义。
- `control-plane/`
  - 只放 agent session orchestration。
  - `session/` 负责会话编排与 transcript read model。
  - `audit/` 负责审计语义和审计持久化边界。
  - `trigger/` 负责 trigger 接入。
- `infrastructure/`
  - 只放技术实现细节，例如 PostgreSQL schema、mount path 约定。
  - 不能反向依赖 `channel/`。

## Runtime Shape

当前默认行为：

- session metadata / recent-session projection / audit 走 PostgreSQL durable store
- transcript 通过 `piSessionFile` 从 `${MANAGED_AGENT_MOUNT_ROOT}/transcripts` 读取
- 运行时 transcript 只能落在 `${MANAGED_AGENT_MOUNT_ROOT}/transcripts`
  下；服务目录中的 `transcripts/` 仅允许作为历史残留被清理，不应再被新代码写入
- worker 默认使用 mock runtime
- 设置 `MANAGED_AGENT_RUNTIME=pi` 时切到 `pi` runtime
- `web-ui` 通过 cookie auth + JSON/SSE 访问本服务

## Tests

- `test/channel/web-api/`
  - Fastify inject transport tests，覆盖 auth、cookie、validation、SSE 和 HTTP contract
- `test/identity/`
  - account/login session、current-user resolve、cookie policy、ownership guard
- `test/control-plane/`
  - session orchestration、transcript readers、durable repositories
- `test/harness-worker/`
  - API 侧 worker client、runtime selector、scheduler、executor adapters
- `test/test-support/`
  - 共享 PGlite、worker fetch、transcript fixture helpers
- `npm run test:unit`
  - 递归执行整个 `test/` 目录下的 `.test.ts` 文件
- repository / service tests 使用 `PGlite`
- 当前不再保留 file/in-memory repository 作为运行时 fallback

后续如果新增 Feishu / Telegram / WhatsApp adapters，应优先在 `channel/`
层扩展，而不是把 channel-specific 逻辑混进 `control-plane/`。

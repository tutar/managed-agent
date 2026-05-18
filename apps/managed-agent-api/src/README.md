# managed-agent-api src

源码分层遵循 `apps/managed-agent-api/README.md` 中的目录规则：

- `app/` 负责 Fastify 容器
- `channel/` 负责协议与 adapter
- `identity/` 负责 login session 和授权边界
- `control-plane/` 负责 agent session orchestration
- `infrastructure/` 负责 PostgreSQL 和 storage 技术实现

# control-plane

`Managed Agent API` 内部的 orchestration 层。

当前按对象归属拆成：

- `session/`
  - `ManagedSessionService`
  - `ActiveSessionRegistry`
  - `EventPublisher`
  - transcript read model
- `audit/`
  - `AuditService`
  - audit persistence boundary
- `trigger/`
  - `TriggerService`

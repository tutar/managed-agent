# Contributing

This repository is organized around a managed-agent deployment topology, not around a shared-packages monorepo. Read this file before adding new runtime modules, docs, or tests.

## Repository Layout

- `apps/web-ui`
  - Web client that consumes the public HTTP/SSE API
- `apps/managed-agent-api`
  - `Managed Agent API`
  - owns the API/channel layer and the control-plane layer
- `apps/harness-worker`
  - `Harness Worker`
  - owns runtime execution, transcript writing, and later sandbox integration
- `infra/`
  - ingress, Kubernetes, Firecracker, rclone, storage, and local environment support
- `docs/`
- proposals, architecture/design docs, API/storage docs, and delivery status

## Service Boundaries

### `apps/managed-agent-api`

Keep these responsibilities here:

- public HTTP API
- SSE response lifecycle
- identity, authorization, and request shaping
- session orchestration
- trigger orchestration
- recent-session projection
- audit entry points

Logical sublayers:

- `src/api-channel`
- `src/control-plane`

### `apps/harness-worker`

Keep these responsibilities here:

- runtime execution
- `pi` session create/open flows
- transcript emission
- tool/runtime integration
- later Firecracker and execution-plane integration

Do not move durable control-plane logic into the worker unless there is a clear architectural reason.

## Storage And Mount Conventions

The repository uses a shared mount-root contract instead of hardcoding `/mnt` in code paths.

- production logical root: `/mnt`
- local development root: `${repo}/.managed-agent/mnt`
- configuration entry: `MANAGED_AGENT_MOUNT_ROOT`

Derived paths:

- `${root}/transcripts`
- `${root}/user-data/uploads`
- `${root}/user-data/outputs`
- `${root}/user-data/tool_results`
- `${root}/skills`
- `${root}/extensions`

Keep subpath names stable. Only the mount root should vary by environment.

## Where New Code Should Go

- new public API handlers: `apps/managed-agent-api/src/api-channel`
- new control-plane orchestration: `apps/managed-agent-api/src/control-plane`
- new worker runtime integration: `apps/harness-worker/src/runtime`
- new worker transport or internal HTTP handlers: `apps/harness-worker/src/http`
- new infrastructure guidance or local runtime support: `infra/`

Do not introduce a new top-level `packages/` directory unless there is a demonstrated shared contract that cannot stay inside the existing service boundaries.

## Where New Docs Should Go

- product/feature proposals: `docs/proposals/NN-*.zh-CN.md`
- architecture and technical design: `docs/design/*.zh-CN.md`
- API and storage contracts: `docs/interfaces/*.md`
- status/progress: `docs/status/implementation-status.md`

Keep `docs/README.md` updated whenever you add, rename, move, or remove a design document.

## Where New Tests Should Go

- API tests: `apps/managed-agent-api/test`
- worker tests: `apps/harness-worker/test`
- web UI tests: `apps/web-ui/test`

Prefer tests close to the owning service. Avoid introducing repository-wide test helpers unless multiple apps genuinely share them.

## Runtime Principles

- use published `pi` packages rather than coupling to local upstream source paths
- keep transcript durable truth in transcript files
- keep metadata/projection/audit durable truth in PostgreSQL
- treat `managed-agent-api` as the orchestration owner
- treat `harness-worker` as the execution service

## Document Entry Points

- overview and quick start: [README.md](./README.md)
- full document index: [docs/README.md](./docs/README.md)
- current delivery state: [docs/status/implementation-status.md](./docs/status/implementation-status.md)

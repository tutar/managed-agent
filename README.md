# managed-agent

Managed agent platform built on top of `pi`, with durable session orchestration, shared transcript storage, and a separated API/control-plane/runtime.

[中文说明 / Chinese README](./README.zh-CN.md)

## Why Managed Matters

The main value of this project is `managed`, not "another local agent demo":

- durable session / transcript: session metadata, recent-session projections, audit records, and transcripts all have explicit durable truth
- separated control plane: `managed-agent-api` schedules execution, `apps/harness` provides the agent runtime
- shared mount contract: runtime storage is organized around `/mnt/*` semantics for transcripts, uploads, outputs, tool results, skills, and extensions
- hosted runtime direction: the long-term expansion path is sandboxing, storage, audit, identity, and multi-tenant controls

## Architecture At A Glance

- `apps/web-ui`: standalone web client that consumes the public HTTP/SSE API
- `apps/managed-agent-api`: `Managed Agent API`, owning the API/channel layer, control-plane layer, and `harness-worker/` scheduler module
- `apps/harness`: pure agent runtime package (pi executor, container entrypoint, CLI adapter). Can run in-process, in a K8s Pod, or as a standalone CLI
- `infra/`: ingress, Kubernetes, Firecracker, rclone, storage conventions, and local infrastructure support
- `docs/`: proposals, architecture/design docs, API/storage docs, and implementation status

Repository structure and contribution conventions: [CONTRIBUTING.md](./CONTRIBUTING.md)  
Full document index: [docs/README.md](./docs/README.md)

## Quick Start

### Prerequisites

- PostgreSQL via local `docker compose`
- mount root at repository-local `.managed-agent/mnt`
- Node.js >= 20.18

### pi mode (in-process, no K8s)

```bash
npm run db:up
export DEEPSEEK_API_KEY=your-deepseek-api-key
export MANAGED_AGENT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/managed_agent
export MANAGED_AGENT_MOUNT_ROOT="$(pwd)/.managed-agent/mnt"
npm run dev:all:pi
```

### sandbox mode (K8s Pod isolation)

Requires Docker and a local K8s cluster. One-time setup:

```bash
# Build harness image, create kind cluster, load image
./scripts/sandbox-setup.sh
```

Then start:

```bash
npm run db:up
export DEEPSEEK_API_KEY=your-deepseek-api-key
export MANAGED_AGENT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/managed_agent
export MANAGED_AGENT_MOUNT_ROOT="$(pwd)/.managed-agent/mnt"
npm run dev:all:sandbox
```

### mock mode (no external dependencies)

```bash
npm run db:up
export MANAGED_AGENT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/managed_agent
export MANAGED_AGENT_MOUNT_ROOT="$(pwd)/.managed-agent/mnt"
npm run dev:all
```

## Ports

- `web-ui`: `3000`
- `managed-agent-api`: `4173`

## Default local database

- host: `127.0.0.1`
- port: `5432`
- db: `managed_agent`
- user: `postgres`
- password: `postgres`

Reset transcripts, local metadata, and PostgreSQL session-related state:

```bash
npm run reset:local-state
```

## Current Scope

Currently covered:

- `web-ui -> managed-agent-api` minimal browser flow (no standalone worker)
- `mock / pi / sandbox` three runtime modes, selectable via `MANAGED_AGENT_RUNTIME`
- `apps/harness` independent agent runtime package
- Sandbox Pod scheduling: K8s API Pod lifecycle, log polling, event streaming
- Sandbox Pod runs pi agent with real DeepSeek calls
- PostgreSQL durable metadata / projection / audit
- Transcript persistence: sandbox JSONL disk cache + refresh recovery
- rename, archive, cursor pagination, and explicit SSE lifecycle
- User registration, login, logout, session auth

Not covered yet:

- Kata / Firecracker and real `cwd` lifecycle (local validation uses containerd runc)
- remote object-storage sync and automated `/mnt/*` durable mounts
- full trigger scheduling and external-event recovery
- multi-tenant controls, budgets, and policy enforcement
- NetworkPolicy + HTTP Proxy sandbox security

## Read Next

- Full document index: [docs/README.md](./docs/README.md)
- Current implementation status: [docs/status/implementation-status.md](./docs/status/implementation-status.md)
- Minimal architecture: [docs/design/minimal-architecture.zh-CN.md](./docs/design/minimal-architecture.zh-CN.md)
- Technical design: [docs/design/technical-design.zh-CN.md](./docs/design/technical-design.zh-CN.md)
- API draft: [docs/interfaces/api-interface-draft.zh-CN.md](./docs/interfaces/api-interface-draft.zh-CN.md)

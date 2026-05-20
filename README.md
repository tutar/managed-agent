# managed-agent

Managed agent platform built on top of `pi`, with durable session orchestration, shared transcript storage, and a separated API/control-plane/runtime.

[中文说明 / Chinese README](./README.zh-CN.md)

## Why Managed Agent

**Your personal AI agent, anywhere. No PC required.**

Most AI agents today run as desktop apps. They need a powerful machine, an
always-on connection, and you sitting in front of them. Walk away and
everything stops.

Managed Agent is different. Your agent runs on a server. You connect through
a browser — from your laptop, your phone, a tablet, anywhere. Start a task
on your desktop, check progress from your phone during lunch, come back when
it's done. The agent keeps working whether you're connected or not. Code
review, document drafting, research, creative writing, data analysis —
whatever you need.

- **Any device, anywhere**: browser-based. No installation, no GPU, no desktop required.
- **Persistent sessions**: disconnect and come back hours later. Everything is saved.
- **Isolated execution**: each session runs in its own sandbox. Safe by default.
- **Extensible**: bring your own skills, tools, and MCP clients. The agent adapts to your workflow.
- **Always improving**: designed for multi-tenant, quotas, budgets, and policy controls from day one.

Inspired by Anthropic's [Claude managed-agents](https://www.anthropic.com/engineering/managed-agents).

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
export MANAGED_AGENT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/managed_agent
export MANAGED_AGENT_MOUNT_ROOT="$(pwd)/.managed-agent/mnt"
export MANAGED_AGENT_SECRETS_KEY=managed-agent-local-dev-key
npm run dev:all:pi
```

Then open the Settings dialog, create one provider config such as DeepSeek or
OpenAI, and start chatting. Provider credentials are now stored per user in
PostgreSQL instead of process environment variables.

### sandbox mode (K8s Pod isolation)

Requires Docker and a local K8s cluster. One-time setup:

```bash
# Build harness image, create kind cluster, load image
./scripts/sandbox-setup.sh
```

Then start:

```bash
npm run db:up
export MANAGED_AGENT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/managed_agent
export MANAGED_AGENT_MOUNT_ROOT="$(pwd)/.managed-agent/mnt"
export MANAGED_AGENT_SECRETS_KEY=managed-agent-local-dev-key
npm run dev:all:sandbox
```

### mock mode (no external dependencies)

```bash
npm run db:up
export MANAGED_AGENT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/managed_agent
export MANAGED_AGENT_MOUNT_ROOT="$(pwd)/.managed-agent/mnt"
export MANAGED_AGENT_SECRETS_KEY=managed-agent-local-dev-key
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
- Per-user LLM provider registry in Settings, persisted in PostgreSQL and used by chat/runtime selection

Not covered yet:

- Kata / Firecracker and real `cwd` lifecycle (local validation uses containerd runc)
- remote object-storage sync and automated `/mnt/*` durable mounts
- full trigger scheduling and external-event recovery
- multi-tenant controls, budgets, and policy enforcement
- NetworkPolicy + HTTP Proxy sandbox security
- first-class OAuth browser flows for providers such as OpenAI Codex and GitHub Copilot

## Read Next

- Full document index: [docs/README.md](./docs/README.md)
- Current implementation status: [docs/status/implementation-status.md](./docs/status/implementation-status.md)
- Minimal architecture: [docs/design/minimal-architecture.zh-CN.md](./docs/design/minimal-architecture.zh-CN.md)
- Technical design: [docs/design/technical-design.zh-CN.md](./docs/design/technical-design.zh-CN.md)
- API draft: [docs/interfaces/api-interface-draft.zh-CN.md](./docs/interfaces/api-interface-draft.zh-CN.md)

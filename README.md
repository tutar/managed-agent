# managed-agent

Managed agent platform built on top of `pi`, with durable session orchestration, shared transcript storage, and a separated API/control-plane/worker runtime.

[中文说明 / Chinese README](./README.zh-CN.md)

## Why Managed Matters

The main value of this project is `managed`, not "another local agent demo":

- durable session / transcript: session metadata, recent-session projections, audit records, and transcripts all have explicit durable truth
- separated control plane: `managed-agent-api` and `harness-worker` are split so scheduling, recovery, and runtime execution can evolve independently
- shared mount contract: runtime storage is organized around `/mnt/*` semantics for transcripts, uploads, outputs, tool results, skills, and extensions
- hosted runtime direction: the long-term expansion path is sandboxing, storage, audit, identity, and multi-tenant controls instead of pushing everything back into a local agent loop

## Architecture At A Glance

- `apps/web-ui`: standalone web client that consumes the public HTTP/SSE API
- `apps/managed-agent-api`: `Managed Agent API`, owning the API/channel layer and control-plane layer
- `apps/harness-worker`: `Harness Worker`, owning `pi` runtime execution, tools, skills, extensions, and later sandbox integration
- `infra/`: ingress, Kubernetes, Firecracker, rclone, storage conventions, and local infrastructure support
- `docs/`: proposals, architecture/design docs, API/storage docs, and implementation status

Repository structure and contribution conventions: [CONTRIBUTING.md](./CONTRIBUTING.md)  
Full document index: [docs/README.md](./docs/README.md)

## Quick Start

Local requirements:

- PostgreSQL via local `docker compose`
- mount root at repository-local `.managed-agent/mnt`
- optional real LLM integration; current baseline is `DeepSeek via pi`

Start local PostgreSQL:

```bash
npm run db:up
```

Start the three-process local stack:

```bash
export DEEPSEEK_API_KEY=your-deepseek-api-key
export MANAGED_AGENT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/managed_agent
export MANAGED_AGENT_MOUNT_ROOT="$(pwd)/.managed-agent/mnt"
npm run dev:all:pi
```

Fixed local ports:

- `web-ui`: `3000`
- `harness-worker`: `4000`
- `managed-agent-api`: `4173`

Fixed local state root:

- use repository-root `.managed-agent/mnt`
- do not use `apps/managed-agent-api/.managed-agent`
- do not use `apps/harness-worker/.managed-agent`

Default local database parameters:

- host: `127.0.0.1`
- port: `5432`
- db: `managed_agent`
- user: `postgres`
- password: `postgres`

Reset transcripts, local metadata, and PostgreSQL session-related state:

```bash
npm run reset:local-state
```

Example request:

```bash
curl -N -X POST 'http://127.0.0.1:4173/sessions?userId=demo-user' \
  -H 'Content-Type: application/json' \
  --data '{"model":"deepseek/deepseek-v4-pro","thinkingLevel":"medium","input":{"content":[{"type":"text","text":"Analyze the current project structure"}]}}'
```

## Current Scope

Currently covered:

- `web-ui -> managed-agent-api -> harness-worker` minimal browser flow
- `managed-agent-api -> harness-worker` service-to-service runtime flow
- PostgreSQL durable metadata / projection / audit
- `piSessionFile` and managed transcript JSONL read path
- rename, archive, cursor pagination, and explicit SSE lifecycle

Not covered yet:

- Firecracker and real `cwd` lifecycle
- remote object-storage sync and automated `/mnt/*` durable mounts
- full trigger scheduling and external-event recovery
- auth, multi-tenant controls, budgets, and policy enforcement

## Read Next

- Full document index: [docs/README.md](./docs/README.md)
- Current implementation status: [docs/status/implementation-status.md](./docs/status/implementation-status.md)
- Minimal architecture: [docs/design/minimal-architecture.zh-CN.md](./docs/design/minimal-architecture.zh-CN.md)
- Technical design: [docs/design/technical-design.zh-CN.md](./docs/design/technical-design.zh-CN.md)
- API draft: [docs/interfaces/api-interface-draft.zh-CN.md](./docs/interfaces/api-interface-draft.zh-CN.md)
